import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import cron from "node-cron";
import { txShares, keyOf, type Card, type CardTx } from "@finans/engine";
import { db, initDb, nowLocal, todayLocal, TENANT_TABLES, GLOBAL_SETTING_KEYS, type TxClient } from "./db.js";
import { refreshAll } from "./prices.js";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession, revokeUserSessions, createEmailToken, consumeEmailToken, SESSION_COOKIE, type SessionUser } from "./auth.js";
import { sendMail, resetEmail, verifyEmail } from "./mail.js";

const app = new Hono();
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
  const { count } = (await db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"))!;
  if (count > 0) return c.json({ error: "Kayıt kapalı (çok kullanıcı Faz 5.2'de açılacak)" }, 403);
  const email2 = email.trim().toLowerCase();
  // Kayıt owner-only (yalnız users boşken çalışır) → oluşan kullanıcı owner, doğrulanmış sayılır.
  // Çok-kullanıcı açıldığında: email_verified=false + createEmailToken('verify') + sendMail(verifyEmail(...)).
  const info = await db.run(
    "INSERT INTO users (email, password_hash, email_verified, created_at) VALUES (?,?,?,?) RETURNING id",
    email2, await hashPassword(password), true, new Date().toISOString(),
  );
  /* owner bootstrap: Faz 5.2 öncesinden kalan sahipsiz (user_id NULL) veriyi bu ilk kullanıcıya devret;
     per-user ayarları (horizon/cash_funds) global settings'ten user_settings'e taşı. Yeni kurulumda 0 satır (zararsız). */
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
  return c.json({ user: { id: info.id, email: email2 } });
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
  return c.json({ user: { id: user.id, email: user.email } });
});

api.post("/auth/logout", async (c) => {
  await deleteSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.get("/auth/me", async (c) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  return user ? c.json({ user }) : c.json({ user: null });
});

/* Uygulamanın herkese açık kök URL'i (e-posta bağlantıları için). Env > tarayıcı Origin > istek host'u. */
const appBaseUrl = (c: any) => process.env.APP_URL || c.req.header("origin") || new URL(c.req.url).origin;

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
      const { subject, html } = resetEmail(link);
      await sendMail(email2, subject, html).catch((e) => console.error("[mail] reset gönderilemedi:", e));
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
  const [accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, autoPrices, userPrices, price_history, globalSettings, userSettings] =
    await Promise.all([
      db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY day, id", uid),
      db.all("SELECT * FROM loans WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM oneoffs WHERE user_id=? ORDER BY date", uid),
      db.all("SELECT * FROM trades WHERE user_id=? ORDER BY date, id", uid),
      db.all("SELECT * FROM cards WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM card_txs WHERE user_id=? ORDER BY date, id", uid),
      db.all("SELECT * FROM categories WHERE user_id=? ORDER BY name", uid),
      db.all("SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC", uid),
      db.all("SELECT * FROM deposits WHERE user_id=? ORDER BY open_date, id", uid),
      db.all("SELECT recurring_id, ym FROM recurring_realized WHERE user_id=?", uid),
      db.all("SELECT card_id, due FROM statement_payments WHERE user_id=?", uid),
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
    accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments,
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
    const names = [...cols.map((x) => x.name), "user_id"]; // Faz 5.2: her kayıt sahibine bağlı
    const values = [...cols.map((col) => b[col.name] ?? col.default ?? null), uid];
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
    await db.run(
      `UPDATE ${table} SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=? AND user_id=?`,
      ...names.map((n) => b[n]), c.req.param("id"), c.get("user").id,
    );
    return c.json({ ok: true });
  });
  api.delete(`/${route}/:id`, async (c) => {
    await db.run(`DELETE FROM ${table} WHERE id=? AND user_id=?`, c.req.param("id"), c.get("user").id);
    return c.json({ ok: true });
  });
}

crud("accounts", "accounts", [{ name: "name", required: true }, { name: "balance" }]);
crud("recurring", "recurring", [
  { name: "kind", required: true }, { name: "name", required: true },
  { name: "amount", required: true }, { name: "day", required: true },
  { name: "from_month" }, { name: "to_month" },
  { name: "account_id" }, { name: "card_id" }, { name: "category_id" }, { name: "auto" },
]);

/* ---- düzenli kalemin (recurring) bir ayını (ym) gerçekleştirme ----
   Hedefe göre gerçek kayıt üretir: kart → card_txs (ilgili ekstreye düşer), hesap → transactions
   (bakiyeyi oynatır, Rapor'a girer). recurring_realized (recurring_id, ym) PK'si ile TAM-BİR-KEZ
   (idempotent); tahmin (project) o ayı artık göstermez → çift sayım önlenir. */
type RecurringRow = {
  id: number; kind: "income" | "expense"; name: string; amount: number; day: number;
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
  const mark = await t.run(
    "INSERT INTO recurring_realized (recurring_id, ym, created_at, user_id) VALUES (?,?,?,?) ON CONFLICT (recurring_id, ym) DO NOTHING",
    r.id, ym, nowLocal(), uid,
  );
  if (!mark.changes) return false; // zaten gerçekleşmiş
  const date = occurrenceDate(ym, r.day);
  if (r.card_id != null && r.kind === "expense") {
    const info = await t.run(
      "INSERT INTO card_txs (card_id,date,name,amount,installments,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      r.card_id, date, r.name, r.amount, 1, uid,
    );
    await t.run("UPDATE recurring_realized SET card_tx_id=? WHERE recurring_id=? AND ym=?", info.id, r.id, ym);
  } else {
    const signed = (r.kind === "income" ? 1 : -1) * r.amount;
    const accountId = opts?.account_id ?? r.account_id ?? null;
    const categoryId = opts?.category_id ?? r.category_id ?? null;
    const info = await t.run(
      "INSERT INTO transactions (date,name,amount,category_id,account_id,user_id) VALUES (?,?,?,?,?,?) RETURNING id",
      date, r.name, signed, categoryId, accountId, uid,
    );
    if (accountId != null) await t.run("UPDATE accounts SET balance = balance + ? WHERE id=? AND user_id=?", signed, accountId, uid);
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
      const tx = await t.get<{ amount: number; account_id: number | null }>(
        "SELECT amount, account_id FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid,
      );
      await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid);
      if (tx?.account_id != null) await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", tx.amount, tx.account_id, uid);
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
   account_id verilmişse SATIŞ hesabın bakiyesini artırır (proceeds = qty*price − fee),
   ALIŞ azaltır (cost = qty*price + fee); DELETE geri alır. İkisi de atomik (tx).
   Bakiye etkisi YALNIZ TRY işlemde: hesaplar TRY, USD çevrimi güncel FX'e bağlı olurdu ve
   DELETE'te FX değişirse geri-alım tutmaz (kayma) → USD portföy akışı bilinçli olarak elle kalır.
   qty/price/fee/side'dan deterministik türetildiği için ekle/geri-al her zaman eşitlenir. */
const tradeBalanceDelta = (side: string, qty: number, price: number, fee: number) =>
  side === "SATIŞ" ? qty * price - fee : -(qty * price + fee);

api.post("/trades", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const f of ["date", "asset_type", "symbol", "side", "qty", "price"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const uid = c.get("user").id;
  const currency = b.currency ?? "TRY";
  const qty = Number(b.qty), price = Number(b.price), fee = Number(b.fee ?? 0);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const affects = currency === "TRY" && accountId != null; // bakiye etkisi yalnız TRY işlemde
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO trades (date,asset_type,symbol,side,qty,price,fee,currency,account_id,user_id) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id",
      b.date, b.asset_type, b.symbol, b.side, qty, price, fee, currency, accountId, uid,
    );
    if (affects) await t.run("UPDATE accounts SET balance = balance + ? WHERE id=? AND user_id=?", tradeBalanceDelta(b.side, qty, price, fee), accountId, uid);
    return info.id;
  });
  return c.json({ id });
});

api.delete("/trades/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    const row = await t.get<{ side: string; qty: number; price: number; fee: number; currency: string; account_id: number | null }>(
      "SELECT side, qty, price, fee, currency, account_id FROM trades WHERE id=? AND user_id=?", c.req.param("id"), uid,
    );
    await t.run("DELETE FROM trades WHERE id=? AND user_id=?", c.req.param("id"), uid);
    if (row && row.currency === "TRY" && row.account_id != null) {
      await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", tradeBalanceDelta(row.side, row.qty, row.price, row.fee), row.account_id, uid);
    }
  });
  return c.json({ ok: true });
});
/* deposits (vadeli mevduat): jenerik crud yerine elle — trades gibi opsiyonel hesap yan etkisi var.
   account_id verilmişse açılış anaparayı hesaptan düşer; DELETE geri alır (anapara iadesi). İkisi atomik.
   Faiz/vade net varlığa engine'de (depositValueOn) accrue eder; PUT yok (sil + yeniden ekle). */
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
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO deposits (name,principal,rate,open_date,term_days,withholding,account_id,user_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      b.name, principal, rate, b.open_date, termDays, withholding, accountId, uid,
    );
    if (accountId != null) await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", principal, accountId, uid);
    return info.id;
  });
  return c.json({ id });
});

api.delete("/deposits/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    const row = await t.get<{ principal: number; account_id: number | null }>(
      "SELECT principal, account_id FROM deposits WHERE id=? AND user_id=?", c.req.param("id"), uid,
    );
    await t.run("DELETE FROM deposits WHERE id=? AND user_id=?", c.req.param("id"), uid);
    if (row && row.account_id != null) await t.run("UPDATE accounts SET balance = balance + ? WHERE id=? AND user_id=?", row.principal, row.account_id, uid);
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
const statementAmount = (card: Card, txs: CardTx[], dueK: string): number =>
  txs.reduce((s, t) => s + txShares(t, card).filter((sh) => keyOf(sh.due) === dueK).reduce((a, x) => a + x.amount, 0), 0);

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
  if (accountId != null) await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", amount, accountId, uid);
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
      const tx = await t.get<{ amount: number; account_id: number | null }>(
        "SELECT amount, account_id FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid,
      );
      await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", row.tx_id, uid);
      if (tx?.account_id != null) await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", tx.amount, tx.account_id, uid);
    }
    await t.run("DELETE FROM statement_payments WHERE card_id=? AND due=? AND user_id=?", cardId, due, uid);
  });
  return c.json({ ok: true });
});
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
    if (b.account_id != null) {
      await t.run("UPDATE accounts SET balance = balance + ? WHERE id=? AND user_id=?", b.amount, b.account_id, uid);
    }
    return info.id;
  });
  return c.json({ id });
});
api.delete("/transactions/:id", async (c) => {
  const uid = c.get("user").id;
  await db.tx(async (t) => {
    const row = await t.get<{ amount: number; account_id: number | null }>(
      "SELECT amount, account_id FROM transactions WHERE id=? AND user_id=?", c.req.param("id"), uid,
    );
    await t.run("DELETE FROM transactions WHERE id=? AND user_id=?", c.req.param("id"), uid);
    if (row?.account_id != null) {
      await t.run("UPDATE accounts SET balance = balance - ? WHERE id=? AND user_id=?", row.amount, row.account_id, uid);
    }
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

/* ---- ayarlar: global anahtarlar (fx/tefas) settings'te, gerisi kullanıcıya özel user_settings'te ---- */
api.put("/settings", async (c) => {
  const uid = c.get("user").id;
  const b = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  for (const [k, v] of Object.entries(b)) {
    if (GLOBAL_SETTING_KEYS.has(k)) {
      await db.run("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value", k, String(v));
    } else {
      await db.run(
        "INSERT INTO user_settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT (user_id,key) DO UPDATE SET value=excluded.value",
        uid, k, String(v),
      );
    }
  }
  return c.json({ ok: true });
});

/* ---- KVKK: kullanıcının tüm verisini JSON indir ---- */
api.get("/export", async (c) => {
  const uid = c.get("user").id;
  const [accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, userSettings] =
    await Promise.all([
      db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM loans WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM oneoffs WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM trades WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM cards WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM card_txs WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM categories WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM transactions WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM deposits WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring_realized WHERE user_id=? ORDER BY recurring_id, ym", uid),
      db.all("SELECT * FROM statement_payments WHERE user_id=? ORDER BY card_id, due", uid),
      db.all<{ key: string; value: string }>("SELECT key, value FROM user_settings WHERE user_id=?", uid),
    ]);
  c.header("Content-Disposition", `attachment; filename="finans-export-${todayLocal()}.json"`);
  return c.json({
    exported_at: nowLocal(), user: c.get("user"),
    accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments,
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
  return c.json({ ok: true });
});

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

const port = Number(process.env.PORT || 8787);
/* şema hazır olsun, sonra sun */
await initDb();
serve({ fetch: app.fetch, port }, () => console.log(`finans → http://localhost:${port}`));

/* Başlangıç catch-up'ı: Render free tier trafik yokken süreci uyutur; uyanışta node-cron ilk 15-dk
   tıkına dek beklerdi → kullanıcı bayat fiyat/işlenmemiş otonom kalem görürdü. Sunar sunmaz bir kez
   çalıştır — uykuda kaçan vadeler telafi pencereleriyle (45/10 gün) yakalanır. Sık uyanışlar zararsız:
   TEFAS günde-bir/geri-çekilme kapıları DB'de, otonom işler idempotent (PK'ler çift kaydı engeller). */
setTimeout(runScheduledJobs, 3_000).unref();
