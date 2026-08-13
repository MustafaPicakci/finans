import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { logger } from "hono/logger";
import cron from "node-cron";
import { txShares, keyOf, cashDelta, statementAmount, REC_AMOUNT_BEGIN, type Card, type CardTx, type TradeSide } from "@finans/engine";
import { db, initDb, nowLocal, todayLocal, TENANT_TABLES, GLOBAL_SETTING_KEYS, type TxClient } from "./db.js";
import { refreshAll } from "./prices.js";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession, revokeUserSessions, createEmailToken, consumeEmailToken, SESSION_COOKIE, type SessionUser } from "./auth.js";
import { sendMail, resetEmail, verifyEmail, mailConfigured, verifyMailConfig, mailFromWarning } from "./mail.js";
import { mountAi, type Invoke } from "./ai/index.js";
import { getProvider } from "./ai/provider.js";

const app = new Hono();
app.use("*", logger());
const api = new Hono<{ Variables: { user: SessionUser } }>();

const isProd = process.env.NODE_ENV === "production";

/* ---- güvenlik başlıkları — tüm yanıtlara (Faz 5.5 sertleştirme) ----
   CSP: script yalnız kendi origin'imizden (inline script yok); stiller inline (React style'ları +
   tema <style>); görsel data: (ikonlar); connect kendi origin (API same-origin). */
const CSP = [
  "default-src 'self'", "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // tema fontları (Space Grotesk / IBM Plex Mono)
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'",
  "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
].join("; ");
app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Content-Security-Policy", CSP);
  if (isProd) h.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
});

/* ---- istek gövdesi boyutu sınırı (basit DoS koruması; JSON API için 256KB fazlasıyla yeter) ---- */
app.use("/api/*", async (c, next) => {
  if (Number(c.req.header("content-length") || 0) > 256 * 1024) return c.json({ error: "İstek çok büyük" }, 413);
  await next();
});

/* ---- global hata yakalayıcı: stack sızdırma yok, temiz 500 ---- */
app.onError((err, c) => {
  console.error("[api] hata:", err);
  return c.json({ error: "Sunucu hatası" }, 500);
});

/* ================= in-memory rate-limit ================= */
const rlHits = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlHits.get(key);
  if (!e || e.reset <= now) { rlHits.set(key, { n: 1, reset: now + windowMs }); return false; }
  if (e.n >= max) return true;
  e.n++; return false;
}
/* başarısız giriş sayacı — e-posta başına (IP spoof'tan bağımsız hesap brute-force koruması) */
const loginFails = new Map<string, { n: number; reset: number }>();
const tooManyLoginFails = (email: string) => { const e = loginFails.get(email); return !!e && e.reset > Date.now() && e.n >= 5; };
function recordLoginFail(email: string): void {
  const now = Date.now();
  const e = loginFails.get(email);
  if (!e || e.reset <= now) loginFails.set(email, { n: 1, reset: now + 15 * 60_000 });
  else e.n++;
}
/* süresi dolan sayaçları periyodik temizle (bellek sızmasın) */
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rlHits) if (e.reset <= now) rlHits.delete(k);
  for (const [k, e] of loginFails) if (e.reset <= now) loginFails.delete(k);
}, 5 * 60_000).unref();
const clientIp = (c: any) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";
/* zamanlama saldırısı/e-posta enumerasyonu: kullanıcı yoksa da scrypt maliyeti ödensin */
const DUMMY_HASH = "0".repeat(32) + ":" + "0".repeat(128);

/* genel API rate-limit — tüm /api isteklerine (IP başına) */
api.use("*", async (c, next) => {
  if (rateLimited(`api:${clientIp(c)}`, 300, 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
  await next();
});

/* ================= AUTH (Faz 5.1) =================
   Guard'tan ÖNCE tanımlanır → bu rotalar (genel rate-limit hariç) korunmaz. Kayıt yalnız ilk owner'a açık. */
const setSessionCookie = (c: any, token: string, expires: Date) =>
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: isProd, path: "/", expires });

api.post("/auth/register", async (c) => {
  if (rateLimited(`reg:${clientIp(c)}`, 10, 5 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !email.includes("@")) return c.json({ error: "Geçerli e-posta gir" }, 400);
  if (!password || typeof password !== "string" || password.length < 8) return c.json({ error: "Parola en az 8 karakter olmalı" }, 400);
  const email2 = email.trim().toLowerCase();
  if (await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email2)) {
    return c.json({ error: "Bu e-posta zaten kayıtlı" }, 409);
  }
  const { count } = (await db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"))!;
  const isOwner = count === 0; // ilk kullanıcı = owner: doğrulanmış gelir, sahipsiz veriyi devralır, otomatik giriş yapar
  const info = await db.run(
    "INSERT INTO users (email, password_hash, email_verified, created_at) VALUES (?,?,?,?) RETURNING id",
    email2, await hashPassword(password), isOwner, new Date().toISOString(),
  );

  if (isOwner) {
    /* owner bootstrap: Faz 5.2 öncesinden kalan sahipsiz (user_id NULL) veriyi bu ilk kullanıcıya devret;
       per-user ayarları (horizon/cash_funds) global settings'ten user_settings'e taşı. Yeni kurulumda 0 satır (zararsız).
       YALNIZ ilk kullanıcıda çalışmalı — sonraki kayıtlarda orphan devri olmamalı. */
    const gk = [...GLOBAL_SETTING_KEYS];
    const ph = gk.map(() => "?").join(",");
    await db.tx(async (t) => {
      for (const tbl of TENANT_TABLES) await t.run(`UPDATE ${tbl} SET user_id=? WHERE user_id IS NULL`, info.id);
      await t.run(
        `INSERT INTO user_settings (user_id, key, value) SELECT ?, key, value FROM settings WHERE key NOT IN (${ph}) ON CONFLICT (user_id, key) DO NOTHING`,
        info.id, ...gk,
      );
      await t.run(`DELETE FROM settings WHERE key NOT IN (${ph})`, ...gk);
      // elle girilmiş fiyatları (source='manual') owner'ın user_prices'ına taşı; global prices auto-only kalsın
      await t.run(
        `INSERT INTO user_prices (user_id, symbol, asset_type, price, updated_at, currency)
         SELECT ?, symbol, asset_type, price, updated_at, currency FROM prices WHERE source='manual'
         ON CONFLICT (user_id, symbol, asset_type) DO NOTHING`,
        info.id,
      );
      await t.run(`DELETE FROM prices WHERE source='manual'`);
    });
    const { token, expires } = await createSession(info.id!);
    setSessionCookie(c, token, expires);
    console.log(`[audit] Yeni kayıt (owner): ${email2} (id:${info.id})`);
    return c.json({ user: { id: info.id, email: email2 } });
  }

  /* Sonraki kullanıcılar: doğrulanmamış oluşturulur, aktivasyon e-postası gider, oturum AÇILMAZ
     (doğrulanmamış giriş login'de 403). Frontend "e-postanı doğrula" gösterir. */
  const vtoken = await createEmailToken(info.id!, "verify", 24 * 60 * 60_000); // 24 saat
  const link = `${appBaseUrl(c)}/?verify=${vtoken}`;
  const { subject, html, text } = verifyEmail(link);
  console.log(`[audit] Yeni kayıt (beklemede): ${email2} (id:${info.id})`);
  sendMail(email2, subject, html, text).catch(() => { /* mail.ts loglar; kayıt akışı bloklanmaz */ });
  return c.json({ pending: true });
});

api.post("/auth/login", async (c) => {
  if (rateLimited(`login:${clientIp(c)}`, 10, 5 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !password) return c.json({ error: "E-posta ve parola gerekli" }, 400);
  const email2 = String(email).trim().toLowerCase();
  if (tooManyLoginFails(email2)) return c.json({ error: "Çok fazla başarısız deneme, biraz sonra tekrar dene" }, 429);
  const user = await db.get<{ id: number; email: string; password_hash: string; email_verified: boolean }>(
    "SELECT id, email, password_hash, email_verified FROM users WHERE email = ?", email2,
  );
  const ok = await verifyPassword(String(password), user?.password_hash ?? DUMMY_HASH); // kullanıcı yoksa da scrypt ödenir
  if (!user || !ok) { recordLoginFail(email2); return c.json({ error: "E-posta veya parola hatalı" }, 401); }
  loginFails.delete(email2);
  // Aktivasyon kapısı (parola doğrulandıktan SONRA → enumerasyon sızmaz). Owner doğrulanmış geldiği için etkilenmez.
  if (!user.email_verified) return c.json({ error: "Hesabın henüz aktive edilmemiş. E-postana gönderilen bağlantıya tıkla." }, 403);
  const { token, expires } = await createSession(user.id);
  setSessionCookie(c, token, expires);
  console.log(`[audit] Kullanıcı giriş yaptı: ${user.email} (id:${user.id})`);
  return c.json({ user: { id: user.id, email: user.email } });
});

api.post("/auth/logout", async (c) => {
  await deleteSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  console.log(`[audit] Oturum kapatıldı (logout)`);
  return c.json({ ok: true });
});

api.get("/auth/me", async (c) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  return user ? c.json({ user }) : c.json({ user: null });
});

/* Uygulamanın herkese açık kök URL'i (e-posta bağlantıları için). Kaynak: APP_URL (env, güvenilir) →
   yoksa istek host'u. Tarayıcı Origin header'ı BİLİNÇLİ olarak KULLANILMAZ: saldırgan kontrolünde bir
   header olduğundan, reset/verify linkinin host'unu evil.com'a çevirip geçerli token'ı sızdırabilirdi
   (hesap ele geçirme). Prod'da APP_URL şart (aşağıda açılışta uyarılır). Sondaki eğik çizgi(ler) kırpılır. */
const appBaseUrl = (c: any) => (process.env.APP_URL || new URL(c.req.url).origin).replace(/\/+$/, "");

/* Şifre sıfırlama isteği — DAİMA 200 (e-posta enumerasyonu/varlık sızmasın). */
api.post("/auth/forgot", async (c) => {
  if (rateLimited(`forgot:${clientIp(c)}`, 5, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { email } = await c.req.json().catch(() => ({}));
  const email2 = String(email ?? "").trim().toLowerCase();
  if (email2.includes("@")) {
    const user = await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email2);
    if (user) {
      const token = await createEmailToken(user.id, "reset", 60 * 60_000); // 1 saat
      const link = `${appBaseUrl(c)}/?reset=${token}`;
      const { subject, html, text } = resetEmail(link);
      sendMail(email2, subject, html, text).catch(() => { /* mail.ts loglar */ });
    }
  }
  return c.json({ ok: true });
});

/* Şifre sıfırla (token ile) — tüketir, parolayı günceller, tüm oturumları düşürür. */
api.post("/auth/reset", async (c) => {
  if (rateLimited(`reset:${clientIp(c)}`, 10, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { token, password } = await c.req.json().catch(() => ({}));
  if (!token || typeof password !== "string" || password.length < 8) return c.json({ error: "Parola en az 8 karakter olmalı" }, 400);
  const userId = await consumeEmailToken(String(token), "reset");
  if (!userId) return c.json({ error: "Bağlantı geçersiz veya süresi dolmuş" }, 400);
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(password), userId);
  await revokeUserSessions(userId); // güvenlik: sıfırlama sonrası eski oturumlar düşer
  console.log(`[audit] Şifre sıfırlandı: (id:${userId})`);
  return c.json({ ok: true });
});

/* Hesap aktivasyonu (token ile). Kayıt owner-only iken dormant; çok-kullanıcı açılınca devreye girer. */
api.post("/auth/verify", async (c) => {
  if (rateLimited(`verify:${clientIp(c)}`, 20, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { token } = await c.req.json().catch(() => ({}));
  const userId = await consumeEmailToken(String(token ?? ""), "verify");
  if (!userId) return c.json({ error: "Bağlantı geçersiz veya süresi dolmuş" }, 400);
  await db.run("UPDATE users SET email_verified = true WHERE id = ?", userId);
  return c.json({ ok: true });
});

/* Aktivasyon e-postasını yeniden gönder — DAİMA 200 (enumerasyon sızmasın); yalnız doğrulanmamış
   kullanıcıya yeni token üretip mail atar. Token 24s'te dolduğu/teslim başarısız olabildiği için. */
api.post("/auth/resend-verify", async (c) => {
  if (rateLimited(`resend:${clientIp(c)}`, 5, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { email } = await c.req.json().catch(() => ({}));
  const email2 = String(email ?? "").trim().toLowerCase();
  if (email2.includes("@")) {
    const user = await db.get<{ id: number; email_verified: boolean }>("SELECT id, email_verified FROM users WHERE email = ?", email2);
    if (user && !user.email_verified) {
      const vtoken = await createEmailToken(user.id, "verify", 24 * 60 * 60_000);
      const link = `${appBaseUrl(c)}/?verify=${vtoken}`;
      const { subject, html, text } = verifyEmail(link);
      sendMail(email2, subject, html, text).catch(() => { /* mail.ts loglar */ });
    }
  }
  return c.json({ ok: true });
});

/* ---- sağlık ucu (Faz 23) — GUARD'TAN ÖNCE, bilinçli olarak herkese açık ----
   İki iş görür: (1) dış uptime monitörünün yokladığı adres, (2) uygulamanın kendini
   uyanık tutmak için attığı ping'in hedefi. Veri sızdırmaz: yalnız süreç ve DB canlı mı.
   DB'ye erişilemiyorsa 503 döner — monitör "ayakta ama kullanılamaz" durumunu da yakalasın
   (yaşandı: uygulama çalışıyordu, Postgres kapalıydı, hata 'Sunucu hatası' diye görünüyordu). */
api.get("/health", async (c) => {
  const t0 = Date.now();
  try { await db.get("SELECT 1 AS ok"); } catch { return c.json({ ok: false, db: false }, 503); }
  return c.json({ ok: true, db: true, ms: Date.now() - t0 });
});

/* ---- guard: bundan sonraki tüm /api rotaları geçerli oturum ister ---- */
api.use("*", async (c, next) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Giriş gerekli" }, 401);
  c.set("user", user);
  await next();
});

/* ---- tek seferde tüm veri (kullanıcıya scope'lu; prices/price_history GLOBAL) ---- */
api.get("/all", async (c) => {
  const uid = c.get("user").id;
  const [accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers, autoPrices, userPrices, price_history, globalSettings, userSettings] =
    await Promise.all([
      db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY day, id", uid),
      db.all("SELECT recurring_id, from_month, amount FROM recurring_amounts WHERE user_id=? ORDER BY recurring_id, from_month", uid),
      db.all("SELECT * FROM loans WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM oneoffs WHERE user_id=? ORDER BY date", uid),
      db.all("SELECT * FROM trades WHERE user_id=? ORDER BY date, id", uid),
      db.all("SELECT * FROM portfolios WHERE user_id=? ORDER BY name", uid),
      db.all("SELECT * FROM cards WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM card_txs WHERE user_id=? ORDER BY date, id", uid),
      db.all("SELECT * FROM categories WHERE user_id=? ORDER BY name", uid),
      db.all("SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC", uid),
      db.all("SELECT * FROM deposits WHERE user_id=? ORDER BY open_date, id", uid),
      db.all("SELECT recurring_id, ym FROM recurring_realized WHERE user_id=?", uid),
      db.all("SELECT card_id, due FROM statement_payments WHERE user_id=?", uid),
      // Faz 15 — hesap hareket defteri: yeniden eskiye (yürüyen bakiye istemcide bugünden geriye çözülür)
      db.all("SELECT * FROM account_entries WHERE user_id=? ORDER BY date DESC, id DESC", uid),
      db.all("SELECT * FROM transfers WHERE user_id=? ORDER BY date DESC, id DESC", uid),
      db.all<any>("SELECT symbol, asset_type, price, source, updated_at, currency FROM prices"),
      db.all<any>("SELECT symbol, asset_type, price, updated_at, currency FROM user_prices WHERE user_id=?", uid),
      db.all("SELECT * FROM price_history ORDER BY date"),
      db.all<{ key: string; value: string }>("SELECT key, value FROM settings"),
      db.all<{ key: string; value: string }>("SELECT key, value FROM user_settings WHERE user_id=?", uid),
    ]);
  // fiyatlar: global otomatik (piyasa) + kullanıcının elle override'ı (varsa o kazanır, source='manual')
  const pm = new Map<string, any>(autoPrices.map((p) => [`${p.asset_type}:${p.symbol}`, { ...p, source: "auto" }]));
  for (const up of userPrices) pm.set(`${up.asset_type}:${up.symbol}`, { ...up, source: "manual" });
  return c.json({
    accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers,
    prices: [...pm.values()], price_history,
    // global (fx/tefas) + kullanıcı ayarları (horizon/cash_funds); kullanıcı çakışmada kazanır
    settings: Object.fromEntries([...globalSettings, ...userSettings].map((s) => [s.key, s.value])),
  });
});

/* ---- generic CRUD ---- */
type Col = { name: string; required?: boolean; default?: unknown };
function crud(route: string, table: string, cols: Col[]) {
  api.post(`/${route}`, async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
    for (const col of cols) if (col.required && (b[col.name] === undefined || b[col.name] === "")) {
      return c.json({ error: `${col.name} zorunlu` }, 400);
    }
    const uid = c.get("user").id;
    /* Gövdede HİÇ GEÇMEYEN (undefined) ve kod tarafında varsayılanı olmayan kolon INSERT'e
       yazılmaz — böylece tablonun kendi DEFAULT'u devreye girer. Eskiden açıkça NULL
       yazılıyordu; `installments integer NOT NULL DEFAULT 1` gibi bir kolonda bu, DEFAULT'u
       ezip NOT NULL ihlali (500) demekti. Arayüz formları alanı hep gönderdiği için gizli
       kalmıştı, asistan opsiyonel alanı atlayınca ortaya çıktı.
       Not: istemcinin AÇIKÇA gönderdiği null hâlâ NULL yazar (anlamlı bir "boşalt" isteği). */
    const used = cols.filter((col) => b[col.name] !== undefined || col.default !== undefined);
    const names = [...used.map((x) => x.name), "user_id"]; // Faz 5.2: her kayıt sahibine bağlı
    const values = [...used.map((col) => b[col.name] ?? col.default ?? null), uid];
    const info = await db.run(
      `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")}) RETURNING id`,
      ...values,
    );
    return c.json({ id: info.id });
  });
  api.put(`/${route}/:id`, async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
    const names = cols.map((x) => x.name).filter((n) => b[n] !== undefined);
    if (!names.length) return c.json({ error: "boş" }, 400);
    /* Faz 18 — etkilenen satır sayısı kontrol edilir. `WHERE ... AND user_id=?` başkasının (ya da
       silinmiş bir) kaydını zaten değiştirmiyordu, ama uç yine de {ok:true} dönüyordu: arayüz
       "kaydedildi" der, hiçbir şey değişmezdi. Tanım kayıtları Faz 18'de düzenlenebilir olduğundan
       bu sessiz yalan artık kullanıcının gördüğü bir hataya dönüşürdü. */
    const upd = await db.run(
      `UPDATE ${table} SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=? AND user_id=?`,
      ...names.map((n) => b[n]), c.req.param("id"), c.get("user").id,
    );
    if (!upd.changes) return c.json({ error: "kayıt yok" }, 404);
    return c.json({ ok: true });
  });
  api.delete(`/${route}/:id`, async (c) => {
    const del = await db.run(`DELETE FROM ${table} WHERE id=? AND user_id=?`, c.req.param("id"), c.get("user").id);
    if (!del.changes) return c.json({ error: "kayıt yok" }, 404);
    return c.json({ ok: true });
  });
}

/* ---- hesap hareket defteri (Faz 15) ----
   Bakiyeyi değiştirmenin TEK yolu bu iki yardımcıdır; hiçbir uç doğrudan `UPDATE accounts SET balance`
   yazmaz. Değişmez kural: **balance = Σ account_entries.amount** (açılış bakiyesi de bir satırdır).
   `applyEntry` bakiyeyi oynatır + hareketi yazar; `revertEntries` kaynağın YAZILMIŞ hareketlerini
   okuyup tersini uygular ve satırları siler — eski tutarı yeniden hesaplamaz, bu yüzden kaynak kaydı
   düzenlenmiş/silinmiş olsa da geri alma her zaman tutar. Düzenleme = revert + apply. */
type EntryMeta = { date: string; kind: "islem" | "portfoy" | "mevduat" | "duzeltme" | "acilis" | "virman"; note: string; source_table?: string; source_id?: number };
async function applyEntry(t: TxClient, uid: number, accountId: number | null, amount: number, m: EntryMeta): Promise<void> {
  if (accountId == null || !amount) return; // hesapsız kayıt bakiyeye dokunmaz; 0 tutar defteri kirletmez
  await t.run("UPDATE accounts SET balance = balance + ? WHERE id=? AND user_id=?", amount, accountId, uid);
  await t.run(
    "INSERT INTO account_entries (account_id,date,amount,kind,source_table,source_id,note,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?)",
    accountId, m.date, amount, m.kind, m.source_table ?? null, m.source_id ?? null, m.note, nowLocal(), uid,
  );
}
async function revertEntries(t: TxClient, uid: number, sourceTable: string, sourceId: number | string): Promise<void> {
  const rows = await t.all<{ id: number; account_id: number; amount: number }>(
    "SELECT id, account_id, amount FROM account_entries WHERE source_table=? AND source_id=? AND user_id=?",
    sourceTable, sourceId, uid,
  );
  for (const r of rows) {
    await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", r.amount, r.account_id, uid);
    await t.run("DELETE FROM account_entries WHERE id=? AND user_id=?", r.id, uid);
  }
}

/* accounts: jenerik crud yerine elle — bakiye defterle birlikte yaşıyor. POST'ta açılış bakiyesi bir
   'acilis' hareketi olur; PUT'ta elle bakiye düzeltmesi FARK kadar 'duzeltme' hareketi yazar (eskiden
   izsiz bir sayı değişimiydi — "bakiyem neden tutmuyor" sorusunun cevabı buradaydı). */
const ACCOUNT_KINDS = ["banka", "nakit", "araci", "fon"];
api.post("/accounts", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  if (!b.name) return c.json({ error: "name zorunlu" }, 400);
  const uid = c.get("user").id;
  const balance = Number(b.balance ?? 0);
  if (!Number.isFinite(balance)) return c.json({ error: "geçersiz bakiye" }, 400);
  const kind = ACCOUNT_KINDS.includes(b.kind) ? b.kind : "banka";
  const id = await db.tx(async (t) => {
    const info = await t.run("INSERT INTO accounts (name,balance,kind,user_id) VALUES (?,?,?,?) RETURNING id", b.name, 0, kind, uid);
    await applyEntry(t, uid, info.id ?? null, balance, { date: todayLocal(), kind: "acilis", note: "Açılış bakiyesi" });
    return info.id;
  });
  return c.json({ id });
});
api.put("/accounts/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const uid = c.get("user").id, id = c.req.param("id");
  const found = await db.tx(async (t) => {
    const old = await t.get<{ balance: number }>("SELECT balance FROM accounts WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    if (b.name !== undefined) await t.run("UPDATE accounts SET name=? WHERE id=? AND user_id=?", b.name, id, uid);
    if (b.kind !== undefined && ACCOUNT_KINDS.includes(b.kind)) await t.run("UPDATE accounts SET kind=? WHERE id=? AND user_id=?", b.kind, id, uid);
    if (b.balance !== undefined) {
      const next = Number(b.balance);
      if (!Number.isFinite(next)) return false;
      await applyEntry(t, uid, Number(id), next - old.balance, { date: todayLocal(), kind: "duzeltme", note: "Elle bakiye düzeltmesi" });
    }
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok veya geçersiz değer" }, 404);
  return c.json({ ok: true });
});
api.delete("/accounts/:id", async (c) => {
  // account_entries FK'si ON DELETE CASCADE — hesabın hareketleri onunla gider
  await db.run("DELETE FROM accounts WHERE id=? AND user_id=?", c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

/* ---- mutabakat (Faz 16) ----
   Defteri dış dünyaya sabitler: kullanıcı "bu hesapta gerçekte şu kadar var" der; fark varsa
   'duzeltme' hareketi olarak YAZILIR (gizlenmez — tarihi, tutarı ve notu defterde durur), sonra
   damga atılır. Fark 0 ise hareket yazılmaz (applyEntry zaten 0'ı eler), yalnız damga güncellenir:
   "doğruladım, tutuyor" bilgisi de değerlidir. Bundan sonra soru "bakiyem tutuyor mu" değil,
   "en son ne zaman doğruladım" olur. */
api.post("/accounts/:id/reconcile", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const real = Number(b.balance);
  if (!Number.isFinite(real)) return c.json({ error: "geçersiz bakiye" }, 400);
  const uid = c.get("user").id, id = Number(c.req.param("id"));
  const date = typeof b.date === "string" && b.date ? b.date : todayLocal();
  const res = await db.tx(async (t) => {
    const acc = await t.get<{ balance: number }>("SELECT balance FROM accounts WHERE id=? AND user_id=?", id, uid);
    if (!acc) return null;
    const diff = real - acc.balance;
    await applyEntry(t, uid, id, diff, {
      date, kind: "duzeltme",
      note: b.note ? `Mutabakat: ${String(b.note).slice(0, 120)}` : "Mutabakat farkı",
    });
    await t.run("UPDATE accounts SET last_recon_date=?, last_recon_balance=? WHERE id=? AND user_id=?", date, real, id, uid);
    return { diff };
  });
  if (!res) return c.json({ error: "kayıt yok" }, 404);
  return c.json({ ok: true, diff: res.diff });
});

/* ---- virman (Faz 16) ----
   Kendi hesapların arasındaki para hareketi: TEK kayıt + İKİ hareket satırı (kaynak −, hedef +),
   hepsi aynı db.tx içinde. Rapor'a girmez, net varlığı değiştirmez. Düzenleme/silme deseni diğer
   yan etkili uçlarla aynı: revertEntries ile YAZILMIŞ bacaklar geri alınır, yenisi uygulanır —
   böylece hesaplar değişse bile geri alma doğru satırları hedefler.
   NOT: başkasına gönderilen para virman değildir (net varlıktan çıkar) — o `transactions`'ta gider. */
async function validTransfer(c: any): Promise<{ err: string } | { date: string; from: number; to: number; amount: number; note: string | null }> {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return { err: "geçersiz gövde" };
  const from = Number(b.from_account_id), to = Number(b.to_account_id), amount = Number(b.amount);
  if (!b.date) return { err: "date zorunlu" };
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { err: "hesaplar zorunlu" };
  if (from === to) return { err: "kaynak ve hedef hesap aynı olamaz" };
  if (!Number.isFinite(amount) || amount <= 0) return { err: "tutar 0'dan büyük olmalı" };
  return { date: String(b.date), from, to, amount, note: b.note ? String(b.note).slice(0, 200) : null };
}
/** İki hesabın da bu kullanıcıya ait olduğunu doğrular — aksi halde başkasının hesabına para yazılabilirdi */
async function ownsAccounts(t: TxClient, uid: number, ids: number[]): Promise<boolean> {
  const rows = await t.all<{ id: number }>(
    `SELECT id FROM accounts WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`, uid, ...ids,
  );
  return rows.length === ids.length;
}
/** Virmanın iki bacağını yazar (kaynak −, hedef +); ikisi de aynı transfer'e bağlı olduğundan
    revertEntries tek çağrıda ikisini birden geri alır. */
async function applyTransfer(
  t: TxClient, uid: number, id: number,
  v: { date: string; from: number; to: number; amount: number; note: string | null },
  fromName: string, toName: string,
): Promise<void> {
  const meta = { date: v.date, kind: "virman" as const, source_table: "transfers", source_id: id };
  await applyEntry(t, uid, v.from, -v.amount, { ...meta, note: v.note ?? `→ ${toName}` });
  await applyEntry(t, uid, v.to, v.amount, { ...meta, note: v.note ?? `← ${fromName}` });
}
/** Bacak notlarında kullanılan hesap adları ("→ Nakit cüzdan") */
async function accountNames(t: TxClient, uid: number, ids: number[]): Promise<Map<number, string>> {
  const rows = await t.all<{ id: number; name: string }>(
    `SELECT id, name FROM accounts WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`, uid, ...ids,
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}
api.post("/transfers", async (c) => {
  const v = await validTransfer(c);
  if ("err" in v) return c.json({ error: v.err }, 400);
  const uid = c.get("user").id;
  const res = await db.tx(async (t) => {
    if (!(await ownsAccounts(t, uid, [v.from, v.to]))) return null;
    const names = await accountNames(t, uid, [v.from, v.to]);
    const info = await t.run(
      "INSERT INTO transfers (date,from_account_id,to_account_id,amount,note,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      v.date, v.from, v.to, v.amount, v.note, uid,
    );
    await applyTransfer(t, uid, info.id!, v, names.get(v.from) ?? "", names.get(v.to) ?? "");
    return info.id;
  });
  if (res == null) return c.json({ error: "hesap bulunamadı" }, 400);
  return c.json({ id: res });
});
api.put("/transfers/:id", async (c) => {
  const v = await validTransfer(c);
  if ("err" in v) return c.json({ error: v.err }, 400);
  const uid = c.get("user").id, id = Number(c.req.param("id"));
  const ok = await db.tx(async (t) => {
    const row = await t.get<{ id: number }>("SELECT id FROM transfers WHERE id=? AND user_id=?", id, uid);
    if (!row || !(await ownsAccounts(t, uid, [v.from, v.to]))) return false;
    await revertEntries(t, uid, "transfers", id); // eski iki bacak birden geri alınır
    const names = await accountNames(t, uid, [v.from, v.to]);
    await t.run(
      "UPDATE transfers SET date=?, from_account_id=?, to_account_id=?, amount=?, note=? WHERE id=? AND user_id=?",
      v.date, v.from, v.to, v.amount, v.note, id, uid,
    );
    await applyTransfer(t, uid, id, v, names.get(v.from) ?? "", names.get(v.to) ?? "");
    return true;
  });
  if (!ok) return c.json({ error: "kayıt yok veya hesap bulunamadı" }, 404);
  return c.json({ ok: true });
});
api.delete("/transfers/:id", async (c) => {
  const uid = c.get("user").id, id = c.req.param("id");
  await db.tx(async (t) => {
    await revertEntries(t, uid, "transfers", id);
    await t.run("DELETE FROM transfers WHERE id=? AND user_id=?", id, uid);
  });
  return c.json({ ok: true });
});

/* ---- recurring: elle yazılmış CRUD (Faz 9) ----
   Kimlik (recurring) ile tutar (recurring_amounts zaman çizelgesi) ayrı tablolarda yaşadığından
   jenerik crud yetmez: POST iki tabloya atomik yazar (gövde eski şekliyle amount taşır — form
   değişmedi), PUT yalnız kimlik kolonlarını günceller, tutar değişikliği /recurring/:id/amount'tan. */
const REC_ID_COLS = ["kind", "name", "day", "from_month", "to_month", "account_id", "card_id", "category_id", "auto"] as const;
api.post("/recurring", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const n of ["kind", "name", "day"]) if (b[n] === undefined || b[n] === "") return c.json({ error: `${n} zorunlu` }, 400);
  if (!(Number(b.amount) > 0)) return c.json({ error: "amount zorunlu" }, 400);
  const uid = c.get("user").id;
  const id = await db.tx(async (t) => {
    const info = await t.run(
      `INSERT INTO recurring (${REC_ID_COLS.join(",")},user_id) VALUES (${REC_ID_COLS.map(() => "?").join(",")},?) RETURNING id`,
      b.kind, b.name, b.day, b.from_month ?? null, b.to_month ?? null,
      b.account_id ?? null, b.card_id ?? null, b.category_id ?? null, b.auto ?? false, uid,
    );
    await t.run(
      "INSERT INTO recurring_amounts (recurring_id, from_month, amount, user_id) VALUES (?,?,?,?)",
      info.id, REC_AMOUNT_BEGIN, Number(b.amount), uid,
    );
    return info.id;
  });
  return c.json({ id });
});
api.put("/recurring/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const names = REC_ID_COLS.filter((n) => b[n] !== undefined); // amount bilinçli listede yok → sessizce yok sayılır
  if (!names.length) return c.json({ error: "boş" }, 400);
  await db.run(
    `UPDATE recurring SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=? AND user_id=?`,
    ...names.map((n) => b[n]), c.req.param("id"), c.get("user").id,
  );
  return c.json({ ok: true });
});
api.delete("/recurring/:id", async (c) => {
  await db.run("DELETE FROM recurring WHERE id=? AND user_id=?", c.req.param("id"), c.get("user").id); // cascade: amounts + realized
  return c.json({ ok: true });
});

/* Tutar değişikliği — atomik "Değiştir": from_month'tan itibaren yeni tutar (aynı aya ikinci yazım = düzeltme) */
api.post("/recurring/:id/amount", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const amount = Number(b.amount);
  if (!(amount > 0)) return c.json({ error: "amount > 0 olmalı" }, 400);
  const fromMonth = b.from_month ? String(b.from_month) : REC_AMOUNT_BEGIN;
  if (fromMonth !== REC_AMOUNT_BEGIN && !YM_RE.test(fromMonth)) return c.json({ error: "from_month 'YYYY-MM' olmalı" }, 400);
  const r = await db.get("SELECT id FROM recurring WHERE id=? AND user_id=?", c.req.param("id"), uid);
  if (!r) return c.json({ error: "kalem yok" }, 404);
  await db.run(
    `INSERT INTO recurring_amounts (recurring_id, from_month, amount, user_id) VALUES (?,?,?,?)
     ON CONFLICT (recurring_id, from_month) DO UPDATE SET amount = excluded.amount`,
    r.id, fromMonth, amount, uid,
  );
  return c.json({ ok: true });
});
api.delete("/recurring/:id/amount/:from_month", async (c) => {
  const uid = c.get("user").id;
  const fromMonth = c.req.param("from_month");
  if (fromMonth !== REC_AMOUNT_BEGIN && !YM_RE.test(fromMonth)) return c.json({ error: "from_month 'YYYY-MM' olmalı" }, 400);
  const id = c.req.param("id");
  const res = await db.tx(async (t) => {
    const cnt = await t.get<{ total: number; hit: number }>(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE from_month=?)::int AS hit FROM recurring_amounts WHERE recurring_id=? AND user_id=?",
      fromMonth, id, uid,
    );
    if (!cnt?.hit) return "yok";
    if (cnt.total <= 1) return "son"; // her kalemin her an en az bir tutarı olmalı
    await t.run("DELETE FROM recurring_amounts WHERE recurring_id=? AND from_month=? AND user_id=?", id, fromMonth, uid);
    return "ok";
  });
  if (res === "yok") return c.json({ error: "tutar satırı yok" }, 404);
  if (res === "son") return c.json({ error: "son tutar satırı silinemez" }, 400);
  return c.json({ ok: true });
});

/* ---- düzenli kalemin (recurring) bir ayını (ym) gerçekleştirme ----
   Hedefe göre gerçek kayıt üretir: kart → card_txs (ilgili ekstreye düşer), hesap → transactions
   (bakiyeyi oynatır, Rapor'a girer). recurring_realized (recurring_id, ym) PK'si ile TAM-BİR-KEZ
   (idempotent); tahmin (project) o ayı artık göstermez → çift sayım önlenir. */
type RecurringRow = {
  id: number; kind: "income" | "expense"; name: string; day: number;
  from_month: string | null; to_month: string | null;
  account_id: number | null; card_id: number | null; category_id: number | null;
};
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const recActiveInYm = (r: RecurringRow, ym: string) =>
  (!r.from_month || ym >= r.from_month) && (!r.to_month || ym <= r.to_month);
/** ym ('YYYY-MM') ayında ödeme günü; kısa ayda ay sonuna kayar → 'YYYY-MM-DD' */
function occurrenceDate(ym: string, day: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate(); // m 1-indexli → o ayın gün sayısı
  return `${ym}-${String(Math.min(day, dim)).padStart(2, "0")}`;
}
/** Tek tx içinde, idempotent. Yeni işaretlendiyse true; zaten gerçekleşmişse false döner. */
async function realizeOccurrence(
  t: TxClient, uid: number, r: RecurringRow, ym: string, opts?: { account_id?: number | null; category_id?: number | null },
): Promise<boolean> {
  /* tutar hedef ayın zaman çizelgesinden çözülür — İŞARETLEMEDEN ÖNCE: tutarı olmayan kalem
     "gerçekleşti ama kayıt yok" durumuna düşmesin */
  const amt = await t.get<{ amount: number }>(
    "SELECT amount FROM recurring_amounts WHERE recurring_id=? AND from_month<=? ORDER BY from_month DESC LIMIT 1",
    r.id, ym,
  );
  if (!amt) return false;
  const mark = await t.run(
    "INSERT INTO recurring_realized (recurring_id, ym, created_at, user_id) VALUES (?,?,?,?) ON CONFLICT (recurring_id, ym) DO NOTHING",
    r.id, ym, nowLocal(), uid,
  );
  if (!mark.changes) return false; // zaten gerçekleşmiş
  const date = occurrenceDate(ym, r.day);
  if (r.card_id != null && r.kind === "expense") {
    const info = await t.run(
      "INSERT INTO card_txs (card_id,date,name,amount,installments,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      r.card_id, date, r.name, amt.amount, 1, uid,
    );
    await t.run("UPDATE recurring_realized SET card_tx_id=? WHERE recurring_id=? AND ym=?", info.id, r.id, ym);
  } else {
    const signed = (r.kind === "income" ? 1 : -1) * amt.amount;
    const accountId = opts?.account_id ?? r.account_id ?? null;
    const categoryId = opts?.category_id ?? r.category_id ?? null;
    const info = await t.run(
      "INSERT INTO transactions (date,name,amount,category_id,account_id,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      date, r.name, signed, categoryId, accountId, uid,
    );
    await applyEntry(t, uid, accountId, signed, { date, kind: "islem", note: r.name, source_table: "transactions", source_id: info.id });
    await t.run("UPDATE recurring_realized SET tx_id=? WHERE recurring_id=? AND ym=?", info.id, r.id, ym);
  }
  return true;
}

api.post("/recurring/:id/realize", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => ({}));
  const ym = String((b as any).ym ?? "");
  if (!YM_RE.test(ym)) return c.json({ error: "ym 'YYYY-MM' olmalı" }, 400);
  const r = await db.get<RecurringRow>("SELECT * FROM recurring WHERE id=? AND user_id=?", c.req.param("id"), uid);
  if (!r) return c.json({ error: "kalem yok" }, 404);
  if (!recActiveInYm(r, ym)) return c.json({ error: "kalem o ay aktif değil" }, 400);
  const acc = (b as any).account_id != null && (b as any).account_id !== "" ? Number((b as any).account_id) : undefined;
  const cat = (b as any).category_id != null && (b as any).category_id !== "" ? Number((b as any).category_id) : undefined;
  const created = await db.tx((t) => realizeOccurrence(t, uid, r, ym, { account_id: acc, category_id: cat }));
  if (created) console.log(`[audit] Düzenli işlem/ödeme gerçekleşti: ${r.name} (ay: ${ym}, id:${uid})`);
  return c.json({ ok: true, already: !created });
});

api.delete("/recurring/:id/realize/:ym", async (c) => {
  const uid = c.get("user").id;
  const id = c.req.param("id"), ym = c.req.param("ym");
  await db.tx(async (t) => {
    const row = await t.get<{ tx_id: number | null; card_tx_id: number | null }>(
      "SELECT tx_id, card_tx_id FROM recurring_realized WHERE recurring_id=? AND ym=? AND user_id=?", id, ym, uid,
    );
    if (!row) return;
    if (row.tx_id != null) {
      await revertEntries(t, uid, "transactions", row.tx_id);
      await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid);
    }
    if (row.card_tx_id != null) await t.run("DELETE FROM card_txs WHERE id=? AND user_id=?", row.card_tx_id, uid);
    await t.run("DELETE FROM recurring_realized WHERE recurring_id=? AND ym=? AND user_id=?", id, ym, uid);
  });
  return c.json({ ok: true });
});
crud("loans", "loans", [
  { name: "name", required: true }, { name: "amount", required: true },
  { name: "first_date", required: true }, { name: "total", required: true },
]);
crud("oneoffs", "oneoffs", [
  { name: "date", required: true }, { name: "name", required: true }, { name: "amount", required: true },
]);
/* trades: jenerik crud yerine elle — transactions gibi opsiyonel yan etkisi var.
   account_id verilmişse SATIŞ/TEMETTÜ hesabın bakiyesini artırır, ALIŞ azaltır, BEDELSİZ hiç
   dokunmaz; DELETE geri alır. İkisi de atomik (tx).
   Bakiye etkisi YALNIZ TRY işlemde: hesaplar TRY, USD çevrimi güncel FX'e bağlı olurdu ve
   DELETE'te FX değişirse geri-alım tutmaz (kayma) → USD portföy akışı bilinçli olarak elle kalır.
   qty/price/fee/side'dan deterministik türetildiği için ekle/geri-al her zaman eşitlenir.
   Faz 21: işaret mantığı engine'deki `cashDelta`'dan gelir — sunucuda ikinci bir kopya tutmak,
   yeni bir olay türü eklendiğinde ikisinin ayrışması demekti (eski hâli "SATIŞ değilse alış"
   varsaydığından TEMETTÜ'de parayı hesaptan DÜŞERDİ). */
const tradeBalanceDelta = (side: TradeSide, qty: number, price: number, fee: number) =>
  cashDelta({ side, qty, price, fee });

const TRADE_SIDES: readonly string[] = ["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"];
/** Türe özgü kurallar: BEDELSİZ bedelsizdir (fiyat 0 olmalı — aksi hâli sessizce ücretsiz hisse
    yaratıp maliyeti bozardı); diğerlerinde adet ve fiyat pozitif olmalı. */
function validateSide(side: string, qty: number, price: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "adet 0'dan büyük olmalı";
  if (!Number.isFinite(price) || price < 0) return "geçersiz fiyat";
  if (side === "BEDELSİZ") return price === 0 ? null : "bedelsizde birim fiyat 0 olmalı";
  return price > 0 ? null : "birim fiyat 0'dan büyük olmalı";
}

api.post("/trades", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["date", "asset_type", "symbol", "side", "qty", "price"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const uid = c.get("user").id;
  const currency = b.currency ?? "TRY";
  const qty = Number(b.qty), price = Number(b.price), fee = Number(b.fee ?? 0);
  if (!TRADE_SIDES.includes(b.side)) return c.json({ error: "geçersiz işlem türü" }, 400);
  const sideErr = validateSide(b.side, qty, price);
  if (sideErr) return c.json({ error: sideErr }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const portfolioId = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null; // null = "Gruplanmamış"
  const affects = currency === "TRY" && accountId != null; // bakiye etkisi yalnız TRY işlemde
  if (portfolioId != null && !(await db.get("SELECT id FROM portfolios WHERE id=? AND user_id=?", portfolioId, uid))) {
    return c.json({ error: "geçersiz portföy" }, 400);
  }
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO trades (date,asset_type,symbol,side,qty,price,fee,currency,account_id,portfolio_id,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
      b.date, b.asset_type, b.symbol, b.side, qty, price, fee, currency, accountId, portfolioId, uid,
    );
    if (affects) {
      await applyEntry(t, uid, accountId, tradeBalanceDelta(b.side, qty, price, fee),
        { date: b.date, kind: "portfoy", note: `${b.symbol} ${b.side}`, source_table: "trades", source_id: info.id });
    }
    return info.id;
  });
  console.log(`[audit] Borsa işlemi eklendi: ${b.symbol} ${b.side} (adet: ${qty}, fiyat: ${price}, id:${uid})`);
  return c.json({ id });
});

/* İşlemi bir portföy grubuna taşı (yalnız portfolio_id değişir — tutar/bakiye etkisi YOK).
   Mevcut işlemleri gruplara dağıtmanın yolu bu; "sil + yeniden ekle" modeli burada bakiyeyi
   iki kez oynatacağı için özel, dar bir uç. */
api.put("/trades/:id/portfolio", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const pid = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null;
  if (pid != null && !(await db.get("SELECT id FROM portfolios WHERE id=? AND user_id=?", pid, uid))) {
    return c.json({ error: "geçersiz portföy" }, 400);
  }
  await db.run("UPDATE trades SET portfolio_id=? WHERE id=? AND user_id=?", pid, c.req.param("id"), uid);
  return c.json({ ok: true });
});
/* Düzenleme (Faz 14): transactions'takiyle aynı "eskisini geri al, yenisini uygula" deseni.
   Bakiye etkisi burada da yalnız TRY + hesaba bağlı işlemde vardır; işlem TRY→USD çevrilirse
   eski TRY etkisi geri alınır ve yenisi uygulanmaz (kural POST/DELETE ile birebir aynı kalır).
   portfolio_id de bu uçtan düzenlenebilir; dar /trades/:id/portfolio ucu (liste içi hızlı taşıma) durur. */
api.put("/trades/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["date", "asset_type", "symbol", "side", "qty", "price"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const uid = c.get("user").id;
  const id = c.req.param("id");
  const currency = b.currency ?? "TRY";
  const qty = Number(b.qty), price = Number(b.price), fee = Number(b.fee ?? 0);
  if (![qty, price, fee].every(Number.isFinite)) return c.json({ error: "geçersiz sayı" }, 400);
  if (!TRADE_SIDES.includes(b.side)) return c.json({ error: "geçersiz işlem türü" }, 400);
  const sideErr = validateSide(b.side, qty, price);
  if (sideErr) return c.json({ error: sideErr }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const portfolioId = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null;
  if (portfolioId != null && !(await db.get("SELECT id FROM portfolios WHERE id=? AND user_id=?", portfolioId, uid))) {
    return c.json({ error: "geçersiz portföy" }, 400);
  }
  const found = await db.tx(async (t) => {
    const old = await t.get<{ side: string; qty: number; price: number; fee: number; currency: string; account_id: number | null }>(
      "SELECT side, qty, price, fee, currency, account_id FROM trades WHERE id=? AND user_id=?", id, uid,
    );
    if (!old) return false;
    await revertEntries(t, uid, "trades", id);
    await t.run(
      "UPDATE trades SET date=?, asset_type=?, symbol=?, side=?, qty=?, price=?, fee=?, currency=?, account_id=?, portfolio_id=? WHERE id=? AND user_id=?",
      b.date, b.asset_type, b.symbol, b.side, qty, price, fee, currency, accountId, portfolioId, id, uid,
    );
    if (currency === "TRY") {
      await applyEntry(t, uid, accountId, tradeBalanceDelta(b.side, qty, price, fee),
        { date: b.date, kind: "portfoy", note: `${b.symbol} ${b.side}`, source_table: "trades", source_id: Number(id) });
    }
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] Borsa işlemi düzenlendi: ${b.symbol} ${b.side} (adet: ${qty}, fiyat: ${price}, id:${uid})`);
  return c.json({ ok: true });
});
api.delete("/trades/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    await revertEntries(t, uid, "trades", c.req.param("id"));
    await t.run("DELETE FROM trades WHERE id=? AND user_id=?", c.req.param("id"), uid);
  });
  return c.json({ ok: true });
});
/* deposits (vadeli mevduat): jenerik crud yerine elle — trades gibi opsiyonel hesap yan etkisi var.
   account_id verilmişse açılış anaparayı hesaptan düşer; DELETE geri alır (anapara iadesi). İkisi atomik.
   Faiz/vade net varlığa engine'de (depositValueOn) accrue eder. PUT Faz 18'de eklendi (aşağıda). */
api.post("/deposits", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["name", "principal", "rate", "open_date", "term_days"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const uid = c.get("user").id;
  const principal = Number(b.principal), rate = Number(b.rate), termDays = Math.trunc(Number(b.term_days));
  const withholding = Number(b.withholding ?? 0);
  if (!(principal > 0) || !(termDays >= 1) || rate < 0 || withholding < 0 || withholding > 100)
    return c.json({ error: "geçersiz değer" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const portfolioId = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null; // null = "Gruplanmamış"
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO deposits (name,principal,rate,open_date,term_days,withholding,account_id,user_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      b.name, principal, rate, b.open_date, termDays, withholding, accountId, uid,
    );
    await applyEntry(t, uid, accountId, -principal,
      { date: b.open_date, kind: "mevduat", note: `${b.name} (vadeli açılış)`, source_table: "deposits", source_id: info.id });
    return info.id;
  });
  console.log(`[audit] Vadeli hesap (mevduat) açıldı: ${b.name} (anapara: ${principal}, id:${uid})`);
  return c.json({ id });
});

/* Faz 18 — vadeli mevduat düzenleme. trades/transactions ile aynı desen: tek db.tx içinde eski
   bakiye etkisi geri alınır (revertEntries YAZILMIŞ satırı okur, anaparayı yeniden hesaplamaz),
   sonra yenisi uygulanır. Hesap değişse bile doğru: iki adım da kendi satırının account_id'sini
   hedefler. Faiz/vade net varlığa engine'de accrue ettiğinden burada ek iş yok. */
api.put("/deposits/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["name", "principal", "rate", "open_date", "term_days"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const uid = c.get("user").id, id = Number(c.req.param("id"));
  const principal = Number(b.principal), rate = Number(b.rate), termDays = Math.trunc(Number(b.term_days));
  const withholding = Number(b.withholding ?? 0);
  if (!(principal > 0) || !(termDays >= 1) || rate < 0 || withholding < 0 || withholding > 100)
    return c.json({ error: "geçersiz değer" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const found = await db.tx(async (t) => {
    const old = await t.get<{ id: number }>("SELECT id FROM deposits WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    await revertEntries(t, uid, "deposits", id);
    await t.run(
      "UPDATE deposits SET name=?, principal=?, rate=?, open_date=?, term_days=?, withholding=?, account_id=? WHERE id=? AND user_id=?",
      b.name, principal, rate, b.open_date, termDays, withholding, accountId, id, uid,
    );
    await applyEntry(t, uid, accountId, -principal,
      { date: b.open_date, kind: "mevduat", note: `${b.name} (vadeli açılış)`, source_table: "deposits", source_id: id });
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] Vadeli hesap düzenlendi: ${b.name} (anapara: ${principal}, id:${uid})`);
  return c.json({ ok: true });
});

api.delete("/deposits/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    await revertEntries(t, uid, "deposits", c.req.param("id"));
    await t.run("DELETE FROM deposits WHERE id=? AND user_id=?", c.req.param("id"), uid);
  });
  return c.json({ ok: true });
});

crud("cards", "cards", [
  { name: "name", required: true }, { name: "limit_amount" },
  { name: "statement_day", required: true }, { name: "due_day", required: true },
  { name: "pay_account_id" }, // otomatik ödeme talimatı hesabı (ops.)
]);
crud("cardtxs", "card_txs", [
  { name: "card_id", required: true }, { name: "date", required: true },
  { name: "name", required: true }, { name: "amount", required: true }, { name: "installments" },
]);

/* ---- kart ekstresi ödeme (Faz 8.2) ----
   Ekstre olayı projeksiyonda sanaldı; "Ödedim" onu gerçek kayda çevirir: transactions'a −tutar yazılır
   (hesap seçildiyse bakiye düşer, Rapor'a girer), (card_id, due) statement_payments ile işaretlenir →
   borç ve projeksiyon o ekstreyi artık saymaz (çift sayım yok). Tutar SUNUCUDA hesaplanır (engine
   txShares — istemciden gelen tutara güvenilmez). Geçmiş vadeli ekstre de ödenebilir (kayıt altına almak
   için); o zaten borçta/projeksiyonda olmadığından yalnız defter kaydı üretir. */
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tek tx içinde idempotent ekstre ödemesi (elle "Ödedim" + otomatik talimat ortak yazıcısı).
    Yeni ödendiyse true; (card, due) zaten işaretliyse false döner. */
async function payStatementTx(
  t: TxClient, uid: number, card: { id: number; name: string }, dueK: string, amount: number,
  accountId: number | null, categoryId: number | null,
): Promise<boolean> {
  const mark = await t.run(
    "INSERT INTO statement_payments (card_id, due, created_at, user_id) VALUES (?,?,?,?) ON CONFLICT (card_id, due) DO NOTHING",
    card.id, dueK, nowLocal(), uid,
  );
  if (!mark.changes) return false;
  const info = await t.run(
    "INSERT INTO transactions (date,name,amount,category_id,account_id,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
    todayLocal(), `${card.name} ekstresi`, -amount, categoryId, accountId, uid,
  );
  await applyEntry(t, uid, accountId, -amount,
    { date: todayLocal(), kind: "islem", note: `${card.name} ekstresi`, source_table: "transactions", source_id: info.id });
  await t.run("UPDATE statement_payments SET tx_id=? WHERE card_id=? AND due=?", info.id, card.id, dueK);
  return true;
}

api.post("/cards/:id/pay-statement", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => ({}));
  const due = String((b as any).due ?? "");
  if (!DUE_RE.test(due)) return c.json({ error: "due 'YYYY-MM-DD' olmalı" }, 400);
  const card = await db.get<Card>("SELECT * FROM cards WHERE id=? AND user_id=?", c.req.param("id"), uid);
  if (!card) return c.json({ error: "kart yok" }, 404);
  const txs = await db.all<CardTx>("SELECT * FROM card_txs WHERE card_id=? AND user_id=?", card.id, uid);
  const amount = statementAmount(card, txs, due);
  if (!(amount > 0)) return c.json({ error: "bu tarihte ekstre yok" }, 400);
  const accountId = (b as any).account_id != null && (b as any).account_id !== "" ? Number((b as any).account_id) : null;
  const categoryId = (b as any).category_id != null && (b as any).category_id !== "" ? Number((b as any).category_id) : null;
  const created = await db.tx((t) => payStatementTx(t, uid, card, due, amount, accountId, categoryId));
  if (created) console.log(`[audit] Kredi kartı ekstresi ödendi: ${card.name} (vade: ${due}, tutar: ${amount}, id:${uid})`);
  return c.json({ ok: true, already: !created, amount });
});

api.delete("/cards/:id/pay-statement/:due", async (c) => {
  const uid = c.get("user").id;
  const cardId = c.req.param("id"), due = c.req.param("due");
  await db.tx(async (t) => {
    const row = await t.get<{ tx_id: number | null }>(
      "SELECT tx_id FROM statement_payments WHERE card_id=? AND due=? AND user_id=?", cardId, due, uid,
    );
    if (!row) return;
    if (row.tx_id != null) {
      await revertEntries(t, uid, "transactions", row.tx_id);
      await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid);
    }
    await t.run("DELETE FROM statement_payments WHERE card_id=? AND due=? AND user_id=?", cardId, due, uid);
  });
  return c.json({ ok: true });
});
/* Faz 11 — portföy grupları (tanım tablosu; jenerik crud yeterli, yan etkisi yok).
   Silinince trades.portfolio_id ON DELETE SET NULL ile "Gruplanmamış"a düşer, işlem kaybolmaz. */
crud("portfolios", "portfolios", [{ name: "name", required: true }, { name: "note" }]);

crud("categories", "categories", [
  { name: "name", required: true }, { name: "kind", required: true }, { name: "color" },
]);

/* ---- gerçekleşen işlemler (transactions): hesaba bağlıysa bakiyeyi de oynatır ----
   Jenerik crud() yerine özel rotalar: amount işaretlidir (gider −, gelir +);
   account_id verilmişse INSERT bakiyeye ekler, DELETE geri alır — BEGIN/COMMIT ile atomik.
   PUT yok: kayıt düzenleme modeli sil + yeniden ekle'dir (bakiye tersinirliği böyle basit kalır). */
api.post("/transactions", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["date", "name", "amount"]) if (b[f] === undefined || b[f] === "") {
    return c.json({ error: `${f} zorunlu` }, 400);
  }
  const uid = c.get("user").id;
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO transactions (date,name,amount,category_id,account_id,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      b.date, b.name, b.amount, b.category_id ?? null, b.account_id ?? null, uid,
    );
    await applyEntry(t, uid, b.account_id ?? null, Number(b.amount),
      { date: b.date, kind: "islem", note: b.name, source_table: "transactions", source_id: info.id });
    return info.id;
  });
  console.log(`[audit] İşlem/Transfer eklendi: ${b.name} (tutar: ${b.amount}, id:${uid})`);
  return c.json({ id });
});
/* Toplu içe aktarma (ekstre yapıştırma): tek istekte N gerçekleşen kayıt, tek transaction içinde.
   Ya hepsi yazılır ya hiçbiri — yarım kalmış import bakiyeyi tutarsız bırakmasın. Hesap/kategori
   id'leri kullanıcıya ait mi diye önden doğrulanır (crud'un tenant-scope garantisinin eşdeğeri). */
const IMPORT_MAX = 500;
api.post("/transactions/bulk", async (c) => {
  const b = await c.req.json().catch(() => null);
  const rows = b && Array.isArray(b.rows) ? b.rows : null;
  if (!rows) return c.json({ error: "geçersiz gövde" }, 400);
  if (rows.length === 0) return c.json({ error: "kayıt yok" }, 400);
  if (rows.length > IMPORT_MAX) return c.json({ error: `Tek seferde en fazla ${IMPORT_MAX} kayıt` }, 400);
  const uid = c.get("user").id;
  for (const r of rows) {
    if (!r || typeof r !== "object") return c.json({ error: "geçersiz satır" }, 400);
    if (!r.date || !r.name || typeof r.amount !== "number" || !Number.isFinite(r.amount)) {
      return c.json({ error: "her satırda tarih, ad ve sayısal tutar zorunlu" }, 400);
    }
  }
  const own = async (table: string, ids: number[]) => {
    if (ids.length === 0) return true;
    const rows2 = await db.all<{ id: number }>(`SELECT id FROM ${table} WHERE user_id=?`, uid);
    const set = new Set(rows2.map((x) => x.id));
    return ids.every((i) => set.has(i));
  };
  const accIds = [...new Set(rows.map((r: any) => r.account_id).filter((x: any) => x != null))] as number[];
  const catIds = [...new Set(rows.map((r: any) => r.category_id).filter((x: any) => x != null))] as number[];
  if (!(await own("accounts", accIds)) || !(await own("categories", catIds))) {
    return c.json({ error: "geçersiz hesap veya kategori" }, 400);
  }
  await db.tx(async (t) => {
    for (const r of rows) {
      const info = await t.run(
        "INSERT INTO transactions (date,name,amount,category_id,account_id,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
        r.date, r.name, r.amount, r.category_id ?? null, r.account_id ?? null, uid,
      );
      await applyEntry(t, uid, r.account_id ?? null, r.amount,
        { date: r.date, kind: "islem", note: r.name, source_table: "transactions", source_id: info.id });
    }
  });
  console.log(`[audit] Toplu içe aktarma: ${rows.length} kayıt (id:${uid})`);
  return c.json({ inserted: rows.length });
});
/* Düzenleme (Faz 14): sil+ekle yerine tek atomik güncelleme. Bakiye etkisi "eskisini geri al,
   yenisini uygula" ile düzeltilir — hesap değiştirilse bile (eski hesaptan düş, yeniye ekle),
   çünkü iki UPDATE de eski/yeni satırın kendi account_id'sini hedefler. Sil+ekle bunu iki ayrı
   istekte yapardı: arada hata olursa bakiye tutarsız kalırdı. */
api.put("/transactions/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["date", "name", "amount"]) if (b[f] === undefined || b[f] === "") {
    return c.json({ error: `${f} zorunlu` }, 400);
  }
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return c.json({ error: "geçersiz tutar" }, 400);
  const uid = c.get("user").id;
  const id = c.req.param("id");
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const categoryId = b.category_id != null && b.category_id !== "" ? Number(b.category_id) : null;
  const found = await db.tx(async (t) => {
    const old = await t.get<{ amount: number; account_id: number | null }>(
      "SELECT amount, account_id FROM transactions WHERE id=? AND user_id=?", id, uid,
    );
    if (!old) return false;
    await revertEntries(t, uid, "transactions", id);
    await t.run(
      "UPDATE transactions SET date=?, name=?, amount=?, category_id=?, account_id=? WHERE id=? AND user_id=?",
      b.date, b.name, amount, categoryId, accountId, id, uid,
    );
    await applyEntry(t, uid, accountId, amount,
      { date: b.date, kind: "islem", note: b.name, source_table: "transactions", source_id: Number(id) });
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] İşlem düzenlendi: ${b.name} (tutar: ${amount}, id:${uid})`);
  return c.json({ ok: true });
});
api.delete("/transactions/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    await revertEntries(t, uid, "transactions", c.req.param("id"));
    await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", c.req.param("id"), uid);
  });
  return c.json({ ok: true });
});

/* ---- fiyatlar ---- */
api.post("/prices/refresh", async (c) => {
  if (rateLimited(`refresh:${c.get("user").id}`, 6, 60_000)) return c.json({ error: "Çok sık yenileme, biraz bekle" }, 429);
  return c.json(await refreshAll());
});
/* elle fiyat KULLANICIYA ÖZEL (user_prices) — global otomatik fiyatı etkilemez, başka kullanıcıya sızmaz.
   Global price_history'e yazılmaz (bir kullanıcının eli global geçmişi kirletmesin). */
api.put("/prices", async (c) => {
  const uid = c.get("user").id;
  const { symbol, asset_type, price, currency } = (await c.req.json().catch(() => ({}))) as any;
  if (!symbol || !asset_type || typeof price !== "number") return c.json({ error: "eksik alan" }, 400);
  const ccy = currency === "USD" ? "USD" : "TRY"; // elle girilen fiyat sembolün biriminde
  await db.run(
    `INSERT INTO user_prices (user_id, symbol, asset_type, price, updated_at, currency) VALUES (?,?,?,?,?,?)
     ON CONFLICT (user_id, symbol, asset_type) DO UPDATE SET price=excluded.price, updated_at=excluded.updated_at, currency=excluded.currency`,
    uid, symbol, asset_type, price, nowLocal(), ccy,
  );
  return c.json({ ok: true });
});
/* elle override'ı sil: değerleme yine global otomatik fiyata döner */
api.delete("/prices/:asset_type/:symbol", async (c) => {
  await db.run(
    "DELETE FROM user_prices WHERE user_id=? AND asset_type=? AND symbol=?",
    c.get("user").id,
    c.req.param("asset_type"),
    decodeURIComponent(c.req.param("symbol")),
  );
  return c.json({ ok: true });
});

/* ---- ayarlar: yalnız KULLANICIYA ÖZEL ayarlar (horizon/cash_funds → user_settings) yazılabilir ----
   GLOBAL anahtarlar (fx_usd_try/tefas_* → paylaşımlı settings) SİSTEME AİTTİR: yalnız refreshAll()
   doğrudan db.run ile yazar. İstemciden global anahtar yazımı REDDEDİLİR — aksi halde herhangi bir
   kullanıcı fx kurunu bozar (herkesin değerlemesi) veya tefas_last_fetch'i ileri atıp global fiyat
   tazelemeyi durdurabilirdi. Frontend bu anahtarları zaten hiç yazmaz → UX etkisi yok. Kısmi yazımı
   önlemek için önce hepsini doğrula, sonra yaz. (Faz 5.2.1'in per-user fiyat izolasyonuyla aynı ilke.) */
api.put("/settings", async (c) => {
  const uid = c.get("user").id;
  const b = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  if (Object.keys(b).some((k) => GLOBAL_SETTING_KEYS.has(k))) return c.json({ error: "bu ayar değiştirilemez" }, 403);
  for (const [k, v] of Object.entries(b)) {
    await db.run(
      "INSERT INTO user_settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT (user_id,key) DO UPDATE SET value=excluded.value",
      uid, k, String(v),
    );
  }
  return c.json({ ok: true });
});

/* ---- KVKK: kullanıcının tüm verisini JSON indir ---- */
api.get("/export", async (c) => {
  const uid = c.get("user").id;
  const [accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers, userSettings] =
    await Promise.all([
      db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT recurring_id, from_month, amount FROM recurring_amounts WHERE user_id=? ORDER BY recurring_id, from_month", uid),
      db.all("SELECT * FROM loans WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM oneoffs WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM trades WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM portfolios WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM cards WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM card_txs WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM categories WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM transactions WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM deposits WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring_realized WHERE user_id=? ORDER BY recurring_id, ym", uid),
      db.all("SELECT * FROM statement_payments WHERE user_id=? ORDER BY card_id, due", uid),
      db.all("SELECT * FROM account_entries WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM transfers WHERE user_id=? ORDER BY id", uid),
      db.all<{ key: string; value: string }>("SELECT key, value FROM user_settings WHERE user_id=?", uid),
    ]);
  c.header("Content-Disposition", `attachment; filename="finans-export-${todayLocal()}.json"`);
  console.log(`[audit] Veri dışa aktarma (KVKK Export): (id:${uid})`);
  return c.json({
    exported_at: nowLocal(), user: c.get("user"),
    accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers,
    settings: Object.fromEntries(userSettings.map((s) => [s.key, s.value])),
  });
});

/* ---- KVKK: hesabı ve tüm verisini sil (parola onaylı; ON DELETE CASCADE ile tenant verisi + oturumlar) ---- */
api.post("/account/delete", async (c) => {
  const uid = c.get("user").id;
  const { password } = await c.req.json().catch(() => ({}));
  const u = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", uid);
  if (!u || !(await verifyPassword(password ?? "", u.password_hash))) return c.json({ error: "Parola hatalı" }, 401);
  await db.run("DELETE FROM users WHERE id=?", uid); // cascade: tüm veri + sessions + user_settings
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  console.log(`[audit] Hesap kalıcı olarak silindi (KVKK Delete): (id:${uid})`);
  return c.json({ ok: true });
});

/* ---- AI asistan (Faz 22) ----
   Asistanın onayladığın işlemleri "iç istek" olarak aynı uygulamaya gönderilir:
   kullanıcının kendi oturum çerezi taşınır (guard yeniden doğrular → tenant-scope,
   doğrulama ve bakiye/defter yan etkileri ucun kendi kodundan gelir; asistana özel
   bir yazma yolu YOKTUR). İstemcinin IP'si de taşınır ki iç istekler kullanıcının
   kendi rate-limit bütçesinden düşsün, ortak "local" kovasından değil. */
const invoke: Invoke = async (c, method, path, body) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: c.req.header("cookie") ?? "",
      "x-forwarded-for": clientIp(c),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
mountAi(api, { invoke, rateLimited });

app.route("/api", api);

/* prod: derlenmiş arayüzü sun (apps/web/dist) — pnpm bu paketi kendi dizininden
   çalıştırdığı için yol apps/server'a göre relatif */
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

/* ---- otonom gerçekleştirme: auto=true + hedefli düzenli kalemleri günü gelince gerçek kayda çevir ----
   Yalnız cari + (kaçmışsa) önceki ay, occurrence günü geçmiş ve son ~45 gün içindekiler
   (yeni açılan auto kaleme derin geçmiş doldurtma yok). recurring_realized PK'si ile idempotent. */
async function materializeDueRecurring(): Promise<void> {
  const today = todayLocal();
  const [ty, tm] = today.split("-").map(Number);
  const ymCur = `${ty}-${String(tm).padStart(2, "0")}`;
  const pd = new Date(ty, tm - 2, 1); // önceki ay
  const ymPrev = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
  const dateMs = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  const rows = await db.all<RecurringRow & { user_id: number }>(
    "SELECT * FROM recurring WHERE auto = true AND (account_id IS NOT NULL OR card_id IS NOT NULL)",
  );
  for (const r of rows) {
    for (const ym of [ymPrev, ymCur]) {
      if (!recActiveInYm(r, ym)) continue;
      const date = occurrenceDate(ym, r.day);
      if (date > today) continue; // günü gelmemiş
      if (dateMs(today) - dateMs(date) > 45 * 86_400_000) continue; // pencere
      await db.tx((t) => realizeOccurrence(t, r.user_id, r, ym)).catch((e) => console.error("[recurring] auto gerçekleştirme hatası:", e));
    }
  }
}

/* ---- otomatik ekstre ödeme talimatı: pay_account_id tanımlı kartların vadesi gelen ekstrelerini öde ----
   Banka talimatı gibi: son ödeme günü geldiğinde (son ~10 gün penceresi — sunucu kapalıysa kaçanı telafi
   eder, derin geçmişi doldurmaz) ödenmemiş ekstre kartın hesabından ödenir. statement_payments PK'si ile
   idempotent; hesap kullanıcıda yoksa (silinmiş vb.) atlanır. */
async function materializeDueStatements(): Promise<void> {
  const today = todayLocal();
  const dateMs = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  const cards = await db.all<Card & { user_id: number; pay_account_id: number }>(
    "SELECT * FROM cards WHERE pay_account_id IS NOT NULL",
  );
  for (const card of cards) {
    const account = await db.get("SELECT id FROM accounts WHERE id=? AND user_id=?", card.pay_account_id, card.user_id);
    if (!account) continue; // talimat hesabı yok/başkasının — otomatik ödeme yapma
    const txs = await db.all<CardTx>("SELECT * FROM card_txs WHERE card_id=? AND user_id=?", card.id, card.user_id);
    /* vadesi bugüne dek gelmiş (pencere içi) ekstre vadeleri ve tutarları */
    const dues = new Map<string, number>();
    for (const t of txs) for (const sh of txShares(t, card)) {
      const k = keyOf(sh.due);
      if (k <= today && dateMs(today) - dateMs(k) <= 10 * 86_400_000) dues.set(k, (dues.get(k) || 0) + sh.amount);
    }
    for (const [dueK, amount] of dues) {
      if (!(amount > 0)) continue;
      await db.tx((t) => payStatementTx(t, card.user_id, card, dueK, amount, card.pay_account_id, null))
        .catch((e) => console.error("[kart] otomatik ekstre ödeme hatası:", e));
    }
  }
}

/* saat başı + her 15 dk fiyat tazele (piyasa dışı saatlerde de zararsız) + otonom kalemleri/ekstreleri işle */
const runScheduledJobs = () => {
  refreshAll().catch(() => {});
  materializeDueRecurring().catch(() => {});
  materializeDueStatements().catch(() => {});
};
cron.schedule("*/15 * * * *", runScheduledJobs);

/* ---- uyanık tutma (Faz 23) ----
   Render ücretsiz katmanı 15 dk GELEN İSTEK olmazsa süreci uyutur; sonraki ilk istek 30-60 sn
   bekler. Telefondan "SMS paylaş → kaydet" akışı bu beklemeyle kullanılamaz hâle geliyordu.
   Kendi genel adresimize 10 dakikada bir istek atmak bunu önler (istek internetten döndüğü için
   Render'ın saydığı türden gelen trafiktir).
   DÜRÜST KISIT: bu yalnız UYANIK TUTAR, uyandırmaz — süreç bir kez uykuya dalarsa (deploy, çökme,
   kotanın bitmesi) kendi cron'u da durmuş olur ve onu ancak DIŞARIDAN bir istek uyandırır. Asıl
   güvence bu yüzden dış bir uptime monitörüdür (bkz. README); bu ping onun tamamlayıcısı.
   Yerelde ve KEEPALIVE_URL/APP_URL tanımlı değilken çalışmaz. */
const keepaliveUrl = (process.env.KEEPALIVE_URL || process.env.APP_URL || "").replace(/\/+$/, "");
if (isProd && keepaliveUrl) {
  cron.schedule("*/10 * * * *", () => {
    fetch(`${keepaliveUrl}/api/health`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => { if (!r.ok) console.warn(`[keepalive] sağlık ucu ${r.status} döndü`); })
      .catch((e: Error) => console.warn(`[keepalive] ping başarısız: ${e.message}`));
  });
  console.log(`[keepalive] 10 dk'da bir ${keepaliveUrl}/api/health yoklanacak`);
}

const port = Number(process.env.PORT || 8787);
/* şema hazır olsun, sonra sun */
await initDb();
/* E-posta yapılandırması açılışta kontrol edilir (Faz 19): bozuk SMTP ayarı ilk kayıt denemesinde
   değil, ilk saniyede belli olsun — "kimse aktivasyon alamıyor" sessizce keşfedilecek bir durum
   olmamalı. Hiçbiri bloklamaz, yalnız loglar. */
if (isProd && !mailConfigured) console.warn("[mail] UYARI: prod'da SMTP yapılandırılmadı — yeni kullanıcılar aktivasyon e-postası alamaz, kayıt olsalar da giriş yapamaz. SMTP_* env'lerini ayarla.");
if (mailConfigured) {
  const warn = mailFromWarning();
  if (warn) console.warn(`[mail] UYARI: ${warn}`);
  verifyMailConfig().catch(() => { /* verifyMailConfig kendi hatasını loglar */ });
}
if (!getProvider()) console.warn("[ai] Asistan kapalı — AI_API_KEY (ve gerekiyorsa AI_PROVIDER/AI_MODEL) ayarlanmadı.");
else console.log(`[ai] Asistan hazır: ${getProvider()!.label}`);
if (isProd && !process.env.APP_URL) console.warn("[auth] UYARI: prod'da APP_URL ayarlanmadı — aktivasyon/şifre-sıfırlama linkleri istek host'undan türetilir; güvenilir sabit URL için APP_URL env'ini ayarla.");
serve({ fetch: app.fetch, port }, () => console.log(`finans → http://localhost:${port}`));

/* Başlangıç catch-up'ı: Render free tier trafik yokken süreci uyutur; uyanışta node-cron ilk 15-dk
   tıkına dek beklerdi → kullanıcı bayat fiyat/işlenmemiş otonom kalem görürdü. Sunar sunmaz bir kez
   çalıştır — uykuda kaçan vadeler telafi pencereleriyle (45/10 gün) yakalanır. Sık uyanışlar zararsız:
   TEFAS günde-bir/geri-çekilme kapıları DB'de, otonom işler idempotent (PK'ler çift kaydı engeller). */
setTimeout(runScheduledJobs, 3_000).unref();
