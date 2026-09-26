import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { logger } from "hono/logger";
import cron from "node-cron";
import { REC_AMOUNT_BEGIN } from "@finans/engine";
import { db, initDb, nowLocal, todayLocal, zarfGecerli, TENANT_TABLES, GLOBAL_SETTING_KEYS, type TxClient } from "./db.js";
import { loadAllData } from "./data.js";
import { refreshAll, backfillPriceHistory, refreshCorporateActions, refreshCompanyEvents } from "./prices.js";
import { refreshBenchmarks, autoBackfill } from "./benchmarks.js";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession, revokeUserSessions, createEmailToken, consumeEmailToken, peekEmailToken, purgeStaleEmailTokens, SESSION_COOKIE, type SessionUser , sahteSalt, e2eeMalzemeDogrula, PAKET } from "./auth.js";
import { ZARF, ZARF_DUZ, type ZarfliTablo } from "@finans/crypto/map";
import { sendMail, resetEmail, verifyEmail, mailConfigured, verifyMailConfig, mailFromWarning } from "./mail.js";
import { mountAi } from "./ai/index.js";
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
  const b = await c.req.json().catch(() => ({}));
  const { email } = b;
  if (!email || typeof email !== "string" || !email.includes("@")) return c.json({ error: "Geçerli e-posta gir" }, 400);
  /* E2EE aşama 3b: kayıt YALNIZ sıfır bilgi yoluyla. Parola sunucuya gelmez; istemci onu
     türetip auth_token + sarılı DEK gönderir. Parola uzunluk/güç kuralı bu yüzden YALNIZ
     istemcide uygulanabilir — sunucu parolayı hiç görmüyor. Eski (parola gönderen) bir
     istemciye anlaşılır hata dönülür: sessizce legacy kullanıcı açmak göç penceresini uzatırdı. */
  if (typeof b.password === "string") return c.json({ error: "Uygulamanın yeni sürümü gerekli — sayfayı yenile" }, 400);
  const m = e2eeMalzemeDogrula(b);
  if (typeof m === "string") return c.json({ error: m }, 400);
  const email2 = email.trim().toLowerCase();
  if (await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email2)) {
    return c.json({ error: "Bu e-posta zaten kayıtlı" }, 409);
  }
  const { count } = (await db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"))!;
  const isOwner = count === 0; // ilk kullanıcı = owner: doğrulanmış gelir, sahipsiz veriyi devralır, otomatik giriş yapar
  const info = await db.run(
    `INSERT INTO users (email, password_hash, email_verified, created_at,
                        password_kdf, kdf_salt, kdf_params, dek_wrapped_pw, dek_wrapped_rk)
     VALUES (?,?,?,?, 'v2',?,?,?,?) RETURNING id`,
    email2, await hashPassword(m.auth_token), isOwner, new Date().toISOString(),
    m.kdf_salt, m.kdf_params, m.dek_wrapped_pw, m.dek_wrapped_rk,
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

/* ---- sıfır bilgi girişinin ilk adımı (E2EE aşama 3b) ----
   İstemci paroladan anahtar türetebilmek için ÖNCE bu e-postanın salt'ını bilmeli. Kayıtlı
   olmayan e-postaya da (gizli anahtarla türetilmiş, her seferinde aynı) sahte bir salt dönülür,
   yoksa bu uç "bu e-posta kayıtlı mı" sorusunu cevaplardı.
   Bilinen ve SINIRLI tek sızıntı: henüz v2'ye geçmemiş (legacy) bir hesap "legacy" döner,
   yani varlığı anlaşılır. Kaçınılmaz — sunucu o hesabın parolasını kontrol edebilmek için
   istemciye "parolayı gönder" demek zorunda. Küme yalnız KÜÇÜLÜR: yeni kayıt hep v2 doğar ve
   mevcut her hesap ilk girişinde v2'ye geçer. */
api.post("/auth/prelogin", async (c) => {
  if (rateLimited(`prelogin:${clientIp(c)}`, 20, 5 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { email } = await c.req.json().catch(() => ({}));
  const email2 = String(email ?? "").trim().toLowerCase();
  if (!email2.includes("@")) return c.json({ error: "Geçerli e-posta gir" }, 400);
  const u = await db.get<{ password_kdf: string; kdf_salt: string | null; kdf_params: string | null }>(
    "SELECT password_kdf, kdf_salt, kdf_params FROM users WHERE email = ?", email2,
  );
  if (u?.password_kdf === "legacy") return c.json({ kdf: "legacy" });
  if (u?.kdf_salt && u.kdf_params) return c.json({ kdf: "v2", salt: u.kdf_salt, params: JSON.parse(u.kdf_params) });
  return c.json({ kdf: "v2", salt: await sahteSalt(email2), params: { alg: "PBKDF2-SHA256", iter: 600_000 } });
});

api.post("/auth/login", async (c) => {
  if (rateLimited(`login:${clientIp(c)}`, 10, 5 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const b = await c.req.json().catch(() => ({}));
  const email2 = String(b.email ?? "").trim().toLowerCase();
  const v2 = typeof b.auth_token === "string", legacy = typeof b.password === "string";
  if (!email2 || (!v2 && !legacy)) return c.json({ error: "E-posta ve parola gerekli" }, 400);
  if (tooManyLoginFails(email2)) return c.json({ error: "Çok fazla başarısız deneme, biraz sonra tekrar dene" }, 429);
  const user = await db.get<{ id: number; email: string; password_hash: string; email_verified: boolean; password_kdf: string; dek_wrapped_pw: string | null; kurtarma: boolean }>(
    "SELECT id, email, password_hash, email_verified, password_kdf, dek_wrapped_pw, dek_wrapped_rk IS NOT NULL AS kurtarma FROM users WHERE email = ?", email2,
  );
  /* Yol ile hesabın türü EŞLEŞMEK ZORUNDA. v2 hesabın parolası sunucuya hiç gelmemeli (gelirse
     reddedilir, kabul edilseydi eski bir istemci sıfır bilgi garantisini sessizce delerdi);
     legacy hesap da token'la açılamaz (hash parolanın). Kullanıcı yoksa da scrypt ödenir. */
  const gizli = v2 ? String(b.auth_token) : String(b.password);
  const hashOk = await verifyPassword(gizli, user?.password_hash ?? DUMMY_HASH);
  const ok = !!user && hashOk && user.password_kdf === (v2 ? "v2" : "legacy");
  if (!user || !ok) { recordLoginFail(email2); return c.json({ error: "E-posta veya parola hatalı" }, 401); }
  loginFails.delete(email2);
  // Aktivasyon kapısı (parola doğrulandıktan SONRA → enumerasyon sızmaz). Owner doğrulanmış geldiği için etkilenmez.
  if (!user.email_verified) return c.json({ error: "Hesabın henüz aktive edilmemiş. E-postana gönderilen bağlantıya tıkla." }, 403);

  /* legacy → v2 YÜKSELTMESİ bu isteğin İÇİNDE ve bu bir güvenlik kararı: yükseltme fiilen bir
     PAROLA DEĞİŞİMİDİR (yeni hash yazılır). Ayrı bir oturumlu uç olsaydı çalınmış bir oturum ona
     kendi token'ını yazıp hesabı ele geçirebilirdi. Burada parola AYNI istekte az önce doğrulandı.
     Malzeme eksik/bozuksa giriş yine başarılı, hesap legacy kalır ve bir sonraki girişte tekrar
     denenir — kullanıcıyı kilitlemek, yükseltmeyi ertelemekten kötüdür. */
  let yukseltildi = false;
  let dekPaketi = user.dek_wrapped_pw;
  if (user.password_kdf === "legacy") {
    const m = e2eeMalzemeDogrula(b.upgrade);
    if (typeof m !== "string") {
      const r = await db.run(
        `UPDATE users SET password_hash=?, password_kdf='v2', kdf_salt=?, kdf_params=?, dek_wrapped_pw=?, dek_wrapped_rk=?
          WHERE id=? AND password_kdf='legacy'`,
        await hashPassword(m.auth_token), m.kdf_salt, m.kdf_params, m.dek_wrapped_pw, m.dek_wrapped_rk, user.id,
      );
      yukseltildi = !!r.changes; dekPaketi = m.dek_wrapped_pw;
      if (yukseltildi) console.log(`[audit] Hesap sıfır bilgi girişine geçti: ${user.email} (id:${user.id})`);
    } else if (b.upgrade !== undefined) {
      console.warn(`[auth] yükseltme reddedildi (${m}) — hesap legacy kaldı: (id:${user.id})`);
    }
  }
  const { token, expires } = await createSession(user.id);
  setSessionCookie(c, token, expires);
  console.log(`[audit] Kullanıcı giriş yaptı: ${user.email} (id:${user.id})`);
  /* `kurtarma`: DEK'in kurtarma koduyla sarılı kopyası var mı. Yoksa istemci uygulamayı
     açmadan ÖNCE kodu gösterip kaydettirir (aşama 6) — veri şifreli hâle geldiği an
     parola tek anahtar olmamalı. */
  return c.json({ user: { id: user.id, email: user.email }, yukseltildi, dek_wrapped_pw: dekPaketi ?? null, kurtarma: !!user.kurtarma });
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

/* ————— Şifre sıfırlama ve şifreli veri (E2EE aşama 6) —————
   Sunucu parolayı bilmediği gibi veri anahtarını da bilmiyor: yeni parolayla YENİ bir anahtar
   yazmak, şifreli veriyi sessizce okunamaz hâle getirirdi. Bu yüzden veri şifreliyse
   sıfırlamanın yalnız iki yolu var ve ikisi de AÇIKÇA seçilir:
     mod "kurtarma" — tarayıcı kurtarma koduyla ESKİ anahtarı açar ve yeni parolayla yeniden
                      sarar; veri aynen kalır, kurtarma paketi değişmez.
     mod "sil"      — kodu olmayan kullanıcı: tüm veri silinir, hesap boş başlar.
   Veri şifreli değilse (göç öncesi hesap) eski davranış sürer: yeni anahtar yazılır.
   E-posta erişimi olan biri kurtarma kodu olmadan VERİYİ OKUYAMAZ — en fazla silebilir; bu,
   e-postası ele geçmiş bir hesap için şifrelemenin sağlayabileceği en iyi sonuç. */
async function sifreliVeriVar(uid: number): Promise<boolean> {
  const u = await db.get<{ m: boolean }>("SELECT e2ee_migrated_at IS NOT NULL AS m FROM users WHERE id=?", uid);
  if (u?.m) return true;
  for (const t of Object.keys(ZARF))
    if (await db.get(`SELECT 1 FROM ${t} WHERE user_id=? AND enc LIKE 'v1:%' LIMIT 1`, uid)) return true;
  return false;
}

/* Bağlantı açılınca: hesabın durumu. Kurtarma paketi token sahibine verilir — 160 bitlik
   kodla sarılı olduğundan kodu bilmeyene bir şey söylemez; kodu bilen de onu tarayıcıda açar. */
api.post("/auth/reset-bilgi", async (c) => {
  if (rateLimited(`reset:${clientIp(c)}`, 10, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { token } = await c.req.json().catch(() => ({}));
  const uid = await peekEmailToken(String(token ?? ""), "reset");
  if (!uid) return c.json({ error: "Bağlantı geçersiz veya süresi dolmuş" }, 400);
  const u = await db.get<{ rk: string | null }>("SELECT dek_wrapped_rk AS rk FROM users WHERE id=?", uid);
  return c.json({ sifreli: await sifreliVeriVar(uid), kurtarma_paketi: u?.rk ?? null });
});

/** Kullanıcının SAHİP OLDUĞU her satır — şema kataloğundan: sonradan eklenen bir kiracı
    tablosu da kendiliğinden kapsanır ("verimi sil" dendiğinde bir tablo unutulamasın). */
async function kullaniciTablolari(): Promise<string[]> {
  const rows = await db.all<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema='public' AND column_name='user_id' AND table_name NOT IN ('users','sessions','email_tokens')`);
  return rows.map((r) => r.t);
}

api.post("/auth/reset", async (c) => {
  if (rateLimited(`reset:${clientIp(c)}`, 10, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const b = await c.req.json().catch(() => ({}));
  if (!b.token) return c.json({ error: "Bağlantı geçersiz" }, 400);
  if (typeof b.password === "string") return c.json({ error: "Uygulamanın yeni sürümü gerekli — sayfayı yenile" }, 400);
  const mod = b.mod === "kurtarma" || b.mod === "sil" ? b.mod : null;
  const m = e2eeMalzemeDogrula(b);
  if (typeof m === "string") return c.json({ error: m }, 400);
  /* Karar token TÜKETİLMEDEN verilir: reddedilen deneme bağlantıyı yakmasın, kullanıcı aynı
     bağlantıyla doğru yolu seçebilsin. */
  const peek = await peekEmailToken(String(b.token), "reset");
  if (!peek) return c.json({ error: "Bağlantı geçersiz veya süresi dolmuş" }, 400);
  const sifreli = await sifreliVeriVar(peek);
  if (sifreli && !mod) return c.json({ error: "Verin şifreli: kurtarma kodunla sıfırla ya da veriyi silmeyi onayla", kurtarmaGerekli: true }, 409);
  if (mod === "kurtarma" && !(await db.get("SELECT 1 FROM users WHERE id=? AND dek_wrapped_rk IS NOT NULL", peek)))
    return c.json({ error: "Bu hesapta kurtarma kodu yok" }, 409);
  const userId = await consumeEmailToken(String(b.token), "reset");
  if (!userId) return c.json({ error: "Bağlantı geçersiz veya süresi dolmuş" }, 400);
  const hash = await hashPassword(m.auth_token);
  await db.tx(async (t) => {
    if (mod === "kurtarma") {
      // aynı DEK, yeni parola: kurtarma paketi (aynı DEK'i saran) DEĞİŞMEZ, veri durur
      await t.run(`UPDATE users SET password_hash=?, password_kdf='v2', kdf_salt=?, kdf_params=?, dek_wrapped_pw=? WHERE id=?`,
        hash, m.kdf_salt, m.kdf_params, m.dek_wrapped_pw, userId);
      return;
    }
    if (mod === "sil") for (const tablo of await kullaniciTablolari()) await t.run(`DELETE FROM ${tablo} WHERE user_id=?`, userId);
    /* Yeni DEK: eski kurtarma paketi eski anahtarı sarıyor, artık geçersiz → silinir; ilk
       girişte kurtarma kodu adımı yeniden çıkar. Göç işareti de sıfırlanır (veri yok ya da düz). */
    await t.run(`UPDATE users SET password_hash=?, password_kdf='v2', kdf_salt=?, kdf_params=?, dek_wrapped_pw=?, dek_wrapped_rk=NULL, e2ee_migrated_at=NULL WHERE id=?`,
      hash, m.kdf_salt, m.kdf_params, m.dek_wrapped_pw, userId);
  });
  await revokeUserSessions(userId); // güvenlik: sıfırlama sonrası eski oturumlar düşer
  console.log(`[audit] Şifre sıfırlandı (${mod ?? "şifresiz veri"}): (id:${userId})`);
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
   DIŞ uptime monitörünün yokladığı adres. Veri sızdırmaz: yalnız süreç ve DB canlı mı.
   DB'ye erişilemiyorsa 503 döner — monitör "ayakta ama kullanılamaz" durumunu da yakalasın
   (yaşandı: uygulama çalışıyordu, Postgres kapalıydı, hata 'Sunucu hatası' diye görünüyordu). */
api.get("/health", async (c) => {
  const t0 = Date.now();
  try { await db.get("SELECT 1 AS ok"); } catch { return c.json({ ok: false, db: false }, 503); }
  return c.json({ ok: true, db: true, ms: Date.now() - t0 });
});

/* ---- uyanık tutma ucu — /health'in DB'ye DOKUNMAYAN kardeşi, guard'tan önce ----
   Kendi kendine attığımız keepalive ping'i (aşağıda) eskiden /health'i yokluyordu ve bu
   YANLIŞ HEDEFTİ: Render'ın süreci uyutmaması için gereken tek şey GELEN HTTP trafiğidir,
   DB'nin yoklanması değil. Ama /health'in `SELECT 1`'i Neon'un compute'unu uyandırıyordu ve
   Neon uyandığı her seferde en az 5 dk açık kalıyor (scale-to-zero eşiği) — yani 10 dakikada
   bir ping, ücretsiz planın aylık compute saatinin yarısını Render'ın uyku sorununa harcıyordu
   (ölçüldü: kota ayın ortasında bitti). Burada sorgu YOK, bu yüzden DB uyanmaz.
   /health olduğu gibi kaldı: onun işi zaten "DB canlı mı" demek ve onu DIŞ monitör yoklar
   (tetiklenme sıklığı bizim değil, monitörün kararı). */
api.get("/ping", (c) => c.json({ ok: true }));

/* ---- guard: bundan sonraki tüm /api rotaları geçerli oturum ister ---- */
api.use("*", async (c, next) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Giriş gerekli" }, 401);
  c.set("user", user);
  await next();
});

/* DÜZ ZARF KAPISI (E2EE aşama 6). Göçü bitmiş bir kullanıcıdan `p1:` (düz metin zarf)
   kabul edilmez: tarayıcı artık yalnız şifreli yazar, düz zarf gelmesi ya eski bir PWA
   paketi ya da boru hattını atlayan bir hata demektir — ikisinde de veriyi SESSİZCE düz
   yazmak, şifrelemenin tüm iddiasını geri alırdı. Tek tek uçlara serpiştirmek yerine
   burada, gövdenin METNİNDE aranır: hangi alanda gelirse gelsin yakalanır. */
api.use("*", async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && c.get("user").e2ee) {
    const govde = await c.req.text().catch(() => "");
    if (govde.includes(`"${ZARF_DUZ}{`)) return c.json({ error: "Şifrelenmemiş veri reddedildi — uygulamayı yenile" }, 400);
  }
  await next();
});

/* ---- tek seferde tüm veri (kullanıcıya scope'lu; prices/price_history/benchmark_history GLOBAL) ----
   Gövdesi data.ts'e taşındı: asistanın okuma araçları da (net varlık, nakit projeksiyonu) aynı
   `AllData`yı ister ve fiyat/ayar birleştirmesinin ikinci bir kopyası olmamalı — bkz. data.ts.

   Bu taşımada Faz 34'ten kalan bir kusur da düştü: `ai_conversations`/`ai_messages`/`ai_actions`
   buradaki `Promise.all`a eklenmiş ama SONUCU HİÇ KULLANILMIYORDU (22 değişken, 25 sorgu) —
   yorumu bile "KVKK indirmesine girmesi gerekir" diyor, yani satırlar `/api/export`a aitti ve
   orada zaten var. Yani her sayfa açılışı ve her mutasyon sonrası `reload()`, sohbet tablolarını
   (monoton büyüyen `ai_messages` dahil) `SELECT *` ile boşuna çekiyordu. */
api.get("/all", async (c) => c.json(await loadAllData(c.get("user").id, { gecmis: true })));

/* ---- generic CRUD ---- */
type Col = { name: string; required?: boolean; default?: unknown };
function crud(route: string, table: string, cols: Col[]) {
  api.post(`/${route}`, async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
    for (const col of cols) if (col.required && (b[col.name] === undefined || b[col.name] === "")) {
      return c.json({ error: `${col.name} zorunlu` }, 400);
    }
    if (b.enc !== undefined && !zarfGecerli(b.enc)) return c.json({ error: "geçersiz zarf" }, 400);
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
    if (b.enc !== undefined && !zarfGecerli(b.enc)) return c.json({ error: "geçersiz zarf" }, 400);
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
   Defteri değiştirmenin TEK yolu bu iki yardımcıdır. Değişmez kural DEĞİŞMEDİ — **bakiye =
   Σ account_entries.amount** (açılış bakiyesi de bir satırdır) — ama artık bir kolonla
   eşitlenmiyor, TÜRETİLİYOR (E2EE aşama 1a): sunucu şifreli tutarları toplayamayacağı için
   `UPDATE accounts SET balance = balance + ?` şifreli dünyada çalışmaz. Bakiye istemcide
   `accountBalance`/`totalCash` ile defterden çıkar. Yan kazanç: "defter ile bakiye ayrıştı"
   diye bir hata sınıfı artık yok, çünkü ikinci bir gerçek yok.
   `applyEntry` hareketi yazar; `revertEntries` kaynağın YAZILMIŞ hareketlerini
   okuyup tersini uygular ve satırları siler — eski tutarı yeniden hesaplamaz, bu yüzden kaynak kaydı
   düzenlenmiş/silinmiş olsa da geri alma her zaman tutar. Düzenleme = revert + apply. */
/* ————— TUTARI SUNUCU HESAPLAMAZ (E2EE aşama 1b → 5a) —————
   Türetilen tutarlar (portföy etkisi, mevduat açılışı, ekstre tutarı, düzenli kalemin o ayki
   tutarı, mutabakat farkı) İSTEMCİDEN gelir: `apps/web/src/yazim/tutar.ts` bunların tek
   kopyasıdır ve formlar, asistan, otomatik gerçekleştirme — her yazma oradan geçer.
   Aşama 1b'de sunucuda YEDEK hesaplar vardı (asistan tutar göndermiyordu); asistanın döngüsü
   tarayıcıya taşınıp aynı boru hattına bağlanınca (aşama 4–5a) yedekler SİLİNDİ. Şifreli
   dünyada zaten yapamayacaklardı: qty, price, card_txs.amount sunucuya opak olacak.
   Aşama 5c'de tutarlar ZARFA girdi: sunucu onları artık görmüyor bile — yalnız istemcinin kurduğu
   zarfları (kayıt + hareket) yazıyor. */

/* E2EE aşama 5c: hareketin TUTARI ve NOTU zarfta (`enc`) — istemci kurar (yazim/zarf.ts, notlar
   sunucunun eskiden ürettikleriyle birebir). Sunucu hareketin yalnız yönlendirmesini bilir:
   hangi hesap, hangi gün, hangi tür, hangi kaynak kayıt (geri alma bununla çalışır).
   Zarf yoksa hareket yazılmaz — istemci tutarı 0 olan hareketi zaten göndermez. */
type EntryMeta = { date: string; kind: "islem" | "portfoy" | "mevduat" | "duzeltme" | "acilis" | "virman"; source_table?: string; source_id?: number };
async function applyEntry(t: TxClient, uid: number, accountId: number | null, enc: string | null, m: EntryMeta): Promise<void> {
  if (accountId == null || !enc) return; // hesapsız kayıt deftere girmez
  await t.run(
    "INSERT INTO account_entries (account_id,date,kind,source_table,source_id,enc,created_at,user_id) VALUES (?,?,?,?,?,?,?,?)",
    accountId, m.date, m.kind, m.source_table ?? null, m.source_id ?? null, enc, nowLocal(), uid,
  );
}
/** İstemcinin gönderdiği zarf: yoksa null, biçimi bozuksa false (uç 400 döner). */
const zarfAl = (v: unknown): string | null | false => (v === undefined || v === null ? null : zarfGecerli(v) ? (v as string) : false);
async function revertEntries(t: TxClient, uid: number, sourceTable: string, sourceId: number | string): Promise<void> {
  const rows = await t.all<{ id: number }>(
    "SELECT id FROM account_entries WHERE source_table=? AND source_id=? AND user_id=?",
    sourceTable, sourceId, uid,
  );
  // Aritmetik kalmadı: satırı silmek bakiyeyi geri almanın kendisidir (bakiye = Σ satırlar).
  for (const r of rows) await t.run("DELETE FROM account_entries WHERE id=? AND user_id=?", r.id, uid);
}

/* accounts: jenerik crud yerine elle — bakiye defterle birlikte yaşıyor. POST'ta açılış bakiyesi bir
   'acilis' hareketi olur; PUT'ta elle bakiye düzeltmesi FARK kadar 'duzeltme' hareketi yazar (eskiden
   izsiz bir sayı değişimiydi — "bakiyem neden tutmuyor" sorusunun cevabı buradaydı). */
const ACCOUNT_KINDS = ["banka", "nakit", "araci", "fon"];
api.post("/accounts", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const enc = zarfAl(b.enc), acilis = zarfAl(b.entry_enc);
  if (!enc || acilis === false) return c.json({ error: "hesap zarfı gerekli (ad)" }, 400);
  const uid = c.get("user").id;
  const kind = ACCOUNT_KINDS.includes(b.kind) ? b.kind : "banka";
  const id = await db.tx(async (t) => {
    const info = await t.run("INSERT INTO accounts (kind,enc,user_id) VALUES (?,?,?) RETURNING id", kind, enc, uid);
    await applyEntry(t, uid, info.id ?? null, acilis, { date: todayLocal(), kind: "acilis" });
    return info.id;
  });
  return c.json({ id });
});
api.put("/accounts/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  const uid = c.get("user").id, id = c.req.param("id");
  /* `balance` dalı KALDIRILDI (E2EE aşama 1a): eski bakiyeyi kolondan okuyup fark
     hesaplıyordu, şifreli tutarla yapılamaz. Kayıp yok — arayüz bu uca hiç bakiye
     göndermiyordu (yalnız name/kind) ve elle düzeltmenin desteklenen yolu zaten
     mutabakat; asistanın SKIPPED gerekçesi de bunu söylüyor. */
  const found = await db.tx(async (t) => {
    const old = await t.get<{ id: number }>("SELECT id FROM accounts WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    if (b.enc !== undefined) {
      if (!zarfGecerli(b.enc)) return false;
      await t.run("UPDATE accounts SET enc=? WHERE id=? AND user_id=?", b.enc, id, uid); // ad zarfta
    }
    if (b.kind !== undefined && ACCOUNT_KINDS.includes(b.kind)) await t.run("UPDATE accounts SET kind=? WHERE id=? AND user_id=?", b.kind, id, uid);
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
  /* Gerçek bakiye hesabın zarfında (`last_recon_balance`), fark düzeltme hareketinin zarfında —
     ikisini de istemci kurar (gerçek − defterden türeyen bakiye). Sunucu yalnız günü damgalar.
     Fark 0 ise hareket gelmez ve yazılmaz; damga yine atılır ("doğruladım, tutuyor"). */
  const enc = zarfAl(b.enc), duzeltme = zarfAl(b.entry_enc);
  if (!enc || duzeltme === false) return c.json({ error: "mutabakat zarfı gerekli" }, 400);
  const uid = c.get("user").id, id = Number(c.req.param("id"));
  const date = typeof b.date === "string" && b.date ? b.date : todayLocal();
  const res = await db.tx(async (t) => {
    const acc = await t.get<{ id: number }>("SELECT id FROM accounts WHERE id=? AND user_id=?", id, uid);
    if (!acc) return null;
    await applyEntry(t, uid, id, duzeltme, { date, kind: "duzeltme" });
    await t.run("UPDATE accounts SET last_recon_date=?, enc=? WHERE id=? AND user_id=?", date, enc, id, uid);
    return true;
  });
  if (!res) return c.json({ error: "kayıt yok" }, 404);
  return c.json({ ok: true });
});

/* ---- virman (Faz 16) ----
   Kendi hesapların arasındaki para hareketi: TEK kayıt + İKİ hareket satırı (kaynak −, hedef +),
   hepsi aynı db.tx içinde. gelir/gider defterine girmez, net varlığı değiştirmez. Düzenleme/silme deseni diğer
   yan etkili uçlarla aynı: revertEntries ile YAZILMIŞ bacaklar geri alınır, yenisi uygulanır —
   böylece hesaplar değişse bile geri alma doğru satırları hedefler.
   NOT: başkasına gönderilen para virman değildir (net varlıktan çıkar) — o `transactions`'ta gider. */
async function validTransfer(c: any): Promise<{ err: string } | { date: string; from: number; to: number; enc: string; cikis: string; giris: string }> {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return { err: "geçersiz gövde" };
  const from = Number(b.from_account_id), to = Number(b.to_account_id);
  if (!b.date) return { err: "date zorunlu" };
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { err: "hesaplar zorunlu" };
  if (from === to) return { err: "kaynak ve hedef hesap aynı olamaz" };
  /* Tutar ve not zarfta; "tutar > 0" denetimi istemcide (yazim/zarf.ts). Sunucu iki bacağın
     İKİSİNİ de ister — yarım virman (tek bacak) bakiyeyi kaydırırdı. */
  const enc = zarfAl(b.enc), cikis = zarfAl(b.entry_from_enc), giris = zarfAl(b.entry_to_enc);
  if (!enc || !cikis || !giris) return { err: "virman zarfları gerekli (kayıt + iki bacak)" };
  return { date: String(b.date), from, to, enc, cikis, giris };
}
/** Virmanın iki hesabı da bu kullanıcının mı (başkasının hesabına bacak yazılmasın). */
async function ownsAccounts(t: TxClient, uid: number, ids: number[]): Promise<boolean> {
  const rows = await t.all<{ id: number }>(
    `SELECT id FROM accounts WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`, uid, ...ids,
  );
  return rows.length === ids.length;
}
/* Virman: TEK kayıt, İKİ hareket (kaynak −, hedef +). Bacakların tutar ve notunu istemci kurar. */
async function applyTransfer(
  t: TxClient, uid: number, id: number,
  v: { date: string; from: number; to: number; cikis: string; giris: string },
): Promise<void> {
  const meta = { date: v.date, kind: "virman" as const, source_table: "transfers", source_id: id };
  await applyEntry(t, uid, v.from, v.cikis, meta);
  await applyEntry(t, uid, v.to, v.giris, meta);
}
api.post("/transfers", async (c) => {
  const v = await validTransfer(c);
  if ("err" in v) return c.json({ error: v.err }, 400);
  const uid = c.get("user").id;
  const res = await db.tx(async (t) => {
    if (!(await ownsAccounts(t, uid, [v.from, v.to]))) return null;
    const info = await t.run(
      "INSERT INTO transfers (date,from_account_id,to_account_id,enc,user_id) VALUES (?,?,?,?,?) RETURNING id",
      v.date, v.from, v.to, v.enc, uid,
    );
    await applyTransfer(t, uid, info.id!, v);
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
    await t.run(
      "UPDATE transfers SET date=?, from_account_id=?, to_account_id=?, enc=? WHERE id=? AND user_id=?",
      v.date, v.from, v.to, v.enc, id, uid,
    );
    await applyTransfer(t, uid, id, v);
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
/* E2EE aşama 5c: ad zarfta (`enc`); tür, gün, yaşam penceresi ve hedefler düz — takvim onlara bakıyor. */
const REC_ID_COLS = ["kind", "enc", "day", "from_month", "to_month", "account_id", "card_id", "category_id", "auto"] as const;
api.post("/recurring", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  for (const n of ["kind", "day"]) if (b[n] === undefined || b[n] === "") return c.json({ error: `${n} zorunlu` }, 400);
  // ad kalemin zarfında, ilk tutar zaman çizelgesinin zarfında ("tutar > 0" istemcide denetlenir)
  if (!zarfGecerli(b.enc) || !zarfGecerli(b.amount_enc)) return c.json({ error: "kalem ve tutar zarfları gerekli" }, 400);
  const uid = c.get("user").id;
  const id = await db.tx(async (t) => {
    const info = await t.run(
      `INSERT INTO recurring (${REC_ID_COLS.join(",")},user_id) VALUES (${REC_ID_COLS.map(() => "?").join(",")},?) RETURNING id`,
      b.kind, b.enc, b.day, b.from_month ?? null, b.to_month ?? null,
      b.account_id ?? null, b.card_id ?? null, b.category_id ?? null, b.auto ?? false, uid,
    );
    await t.run(
      "INSERT INTO recurring_amounts (recurring_id, from_month, enc, user_id) VALUES (?,?,?,?)",
      info.id, REC_AMOUNT_BEGIN, b.amount_enc, uid,
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
  if (b.enc !== undefined && !zarfGecerli(b.enc)) return c.json({ error: "geçersiz zarf" }, 400);
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
  if (!zarfGecerli(b.enc)) return c.json({ error: "tutar zarfı gerekli" }, 400); // "> 0" istemcide
  const fromMonth = b.from_month ? String(b.from_month) : REC_AMOUNT_BEGIN;
  if (fromMonth !== REC_AMOUNT_BEGIN && !YM_RE.test(fromMonth)) return c.json({ error: "from_month 'YYYY-MM' olmalı" }, 400);
  const r = await db.get("SELECT id FROM recurring WHERE id=? AND user_id=?", c.req.param("id"), uid);
  if (!r) return c.json({ error: "kalem yok" }, 404);
  await db.run(
    `INSERT INTO recurring_amounts (recurring_id, from_month, enc, user_id) VALUES (?,?,?,?)
     ON CONFLICT (recurring_id, from_month) DO UPDATE SET enc = excluded.enc`,
    r.id, fromMonth, b.enc, uid,
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
   (bakiyeyi oynatır, gelir/gider defterine girer). recurring_realized (recurring_id, ym) PK'si ile TAM-BİR-KEZ
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
  t: TxClient, uid: number, r: RecurringRow, ym: string,
  opts: { account_id?: number | null; category_id?: number | null; kayit_enc: string; entry_enc: string | null },
): Promise<boolean> {
  /* Kaydın kendisini (ad + o ayın işaretli tutarı) İSTEMCİ kurar (yazim/zarf.ts): sunucu eskiden
     adı kalemden, tutarı zaman çizelgesinden okuyordu — ikisi de artık zarfta. Dal ayrımı
     (kart mı hesap mı) iki tarafta aynı kuraldır; sunucu yalnız hangi tabloya yazacağını seçer. */
  const mark = await t.run(
    "INSERT INTO recurring_realized (recurring_id, ym, created_at, user_id) VALUES (?,?,?,?) ON CONFLICT (recurring_id, ym) DO NOTHING",
    r.id, ym, nowLocal(), uid,
  );
  if (!mark.changes) return false; // zaten gerçekleşmiş
  const date = occurrenceDate(ym, r.day);
  if (r.card_id != null && r.kind === "expense") {
    /* Faz 39 — kalemin kategorisi kart harcamasına da taşınır. Öncesinde kolon yoktu, yani
       kategorisi tanımlı bir düzenli gider karta düştüğünde kategorisi SESSİZCE kayboluyordu
       (hesaba düşen aynı kalem kategoriyi koruyordu); aynı kalemin iki hedefi farklı davranıyordu. */
    const info = await t.run(
      "INSERT INTO card_txs (card_id,date,enc,category_id,user_id) VALUES (?,?,?,?,?) RETURNING id",
      r.card_id, date, opts.kayit_enc, opts.category_id ?? r.category_id ?? null, uid,
    );
    await t.run("UPDATE recurring_realized SET card_tx_id=? WHERE recurring_id=? AND ym=?", info.id, r.id, ym);
  } else {
    const accountId = opts.account_id ?? r.account_id ?? null;
    const categoryId = opts.category_id ?? r.category_id ?? null;
    const info = await t.run(
      "INSERT INTO transactions (date,enc,category_id,account_id,user_id) VALUES (?,?,?,?,?) RETURNING id",
      date, opts.kayit_enc, categoryId, accountId, uid,
    );
    await applyEntry(t, uid, accountId, opts.entry_enc, { date, kind: "islem", source_table: "transactions", source_id: info.id });
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
  const kayit = zarfAl((b as any).kayit_enc), hareketZarfi = zarfAl((b as any).entry_enc);
  if (!kayit || hareketZarfi === false) return c.json({ error: "tutar gerekli (o ay için tanımlı tutar yoksa gerçekleştirilemez)" }, 400);
  const created = await db.tx((t) => realizeOccurrence(t, uid, r, ym, { account_id: acc, category_id: cat, kayit_enc: kayit, entry_enc: hareketZarfi }));
  // denetim logu ad/tutar BASMAZ (zarfta; basılsaydı log sızıntı olurdu)
  if (created) console.log(`[audit] Düzenli kalem gerçekleşti: #${r.id} (ay: ${ym}, id:${uid})`);
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
/* E2EE aşama 5: ad, tutar ve taksit sayısı ZARFTA (`enc`); sunucu yalnız tarihi görür. */
crud("loans", "loans", [{ name: "enc", required: true }, { name: "first_date", required: true }]);
crud("oneoffs", "oneoffs", [{ name: "date", required: true }, { name: "enc", required: true }]); // ad + tutar zarfta
/* trades: jenerik crud yerine elle — transactions gibi opsiyonel yan etkisi var.
   account_id verilmişse SATIŞ/TEMETTÜ hesabın bakiyesini artırır, ALIŞ azaltır, BEDELSİZ hiç
   dokunmaz; DELETE geri alır. İkisi de atomik (tx).
   Bakiye etkisi YALNIZ TRY işlemde: hesaplar TRY, USD çevrimi güncel FX'e bağlı olurdu ve
   DELETE'te FX değişirse geri-alım tutmaz (kayma) → USD portföy akışı bilinçli olarak elle kalır.
   Hesap etkisinin tutarı (`entry_amount`) İSTEMCİDEN gelir — engine'in `cashDelta`'sı ile
   yazim/tutar.ts'te hesaplanır (E2EE aşama 5a). Sunucudaki `tradeBalanceDelta` kopyası silindi;
   Faz 21'in "iki kopya ayrışır" dersinin son uygulaması. */

const TRADE_SIDES: readonly string[] = ["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"];
/* `validateSide` (adet > 0, bedelsizde fiyat 0) istemciye taşındı: yazim/zarf.ts — adet ve fiyat
   artık zarfta, sunucu onları göremez (E2EE aşama 5c). Kural silinmedi, yer değiştirdi. */

api.post("/trades", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  /* Adet, fiyat ve komisyon ZARFTA (E2EE aşama 5c); tür kuralları (adet > 0, bedelsizde fiyat 0)
     istemcinin boru hattında denetlenir (yazim/zarf.ts) — sunucu artık o sayıları göremez.
     Sembol, tür ve para birimi düz: fiyat cron'u ve hesap etkisi kuralı onlara bakıyor. */
  for (const f of ["date", "asset_type", "symbol", "side"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "işlem zarfı gerekli (adet/fiyat)" }, 400);
  const uid = c.get("user").id;
  const currency = b.currency ?? "TRY";
  if (!TRADE_SIDES.includes(b.side)) return c.json({ error: "geçersiz işlem türü" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const portfolioId = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null; // null = "Gruplanmamış"
  const affects = currency === "TRY" && accountId != null; // bakiye etkisi yalnız TRY işlemde
  if (affects && !hareketZarfi) return c.json({ error: "hesap hareketi gerekli (hesaba bağlı TRY işlem)" }, 400);
  if (portfolioId != null && !(await db.get("SELECT id FROM portfolios WHERE id=? AND user_id=?", portfolioId, uid))) {
    return c.json({ error: "geçersiz portföy" }, 400);
  }
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO trades (date,asset_type,symbol,side,currency,account_id,portfolio_id,enc,user_id) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
      b.date, b.asset_type, b.symbol, b.side, currency, accountId, portfolioId, enc, uid,
    );
    if (affects) await applyEntry(t, uid, accountId, hareketZarfi, { date: b.date, kind: "portfoy", source_table: "trades", source_id: info.id });
    return info.id;
  });
  console.log(`[audit] Borsa işlemi eklendi: ${b.symbol} ${b.side} (id:${uid})`); // adet/fiyat zarfta — loga basılmaz
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
  for (const f of ["date", "asset_type", "symbol", "side"])
    if (b[f] === undefined || b[f] === "") return c.json({ error: `${f} zorunlu` }, 400);
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "işlem zarfı gerekli (adet/fiyat)" }, 400);
  const uid = c.get("user").id;
  const id = c.req.param("id");
  const currency = b.currency ?? "TRY";
  if (!TRADE_SIDES.includes(b.side)) return c.json({ error: "geçersiz işlem türü" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const portfolioId = b.portfolio_id != null && b.portfolio_id !== "" ? Number(b.portfolio_id) : null;
  if (portfolioId != null && !(await db.get("SELECT id FROM portfolios WHERE id=? AND user_id=?", portfolioId, uid))) {
    return c.json({ error: "geçersiz portföy" }, 400);
  }
  if (currency === "TRY" && accountId != null && !hareketZarfi) return c.json({ error: "hesap hareketi gerekli (hesaba bağlı TRY işlem)" }, 400);
  const found = await db.tx(async (t) => {
    const old = await t.get<{ id: number }>("SELECT id FROM trades WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    await revertEntries(t, uid, "trades", id);
    await t.run(
      "UPDATE trades SET date=?, asset_type=?, symbol=?, side=?, currency=?, account_id=?, portfolio_id=?, enc=? WHERE id=? AND user_id=?",
      b.date, b.asset_type, b.symbol, b.side, currency, accountId, portfolioId, enc, id, uid,
    );
    if (currency === "TRY") await applyEntry(t, uid, accountId, hareketZarfi, { date: b.date, kind: "portfoy", source_table: "trades", source_id: Number(id) });
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] Borsa işlemi düzenlendi: ${b.symbol} ${b.side} (id:${uid})`);
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
  if (!b.open_date) return c.json({ error: "open_date zorunlu" }, 400);
  const uid = c.get("user").id;
  /* Ad, anapara, faiz, vade günü ve stopaj ZARFTA; değer kuralları istemcide (yazim/zarf.ts). */
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "mevduat zarfı gerekli" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  if (accountId != null && !hareketZarfi) return c.json({ error: "hesap hareketi gerekli (hesaba bağlı mevduat)" }, 400);
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO deposits (open_date,account_id,enc,user_id) VALUES (?,?,?,?) RETURNING id",
      b.open_date, accountId, enc, uid,
    );
    await applyEntry(t, uid, accountId, hareketZarfi, { date: b.open_date, kind: "mevduat", source_table: "deposits", source_id: info.id });
    return info.id;
  });
  console.log(`[audit] Vadeli hesap (mevduat) açıldı (id:${uid})`); // ad/anapara zarfta — loga basılmaz
  return c.json({ id });
});

/* Faz 18 — vadeli mevduat düzenleme. trades/transactions ile aynı desen: tek db.tx içinde eski
   bakiye etkisi geri alınır (revertEntries YAZILMIŞ satırı okur, anaparayı yeniden hesaplamaz),
   sonra yenisi uygulanır. Hesap değişse bile doğru: iki adım da kendi satırının account_id'sini
   hedefler. Faiz/vade net varlığa engine'de accrue ettiğinden burada ek iş yok. */
api.put("/deposits/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  if (!b.open_date) return c.json({ error: "open_date zorunlu" }, 400);
  const uid = c.get("user").id, id = Number(c.req.param("id"));
  /* Ad, anapara, faiz, vade günü ve stopaj ZARFTA; değer kuralları istemcide (yazim/zarf.ts). */
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "mevduat zarfı gerekli" }, 400);
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  if (accountId != null && !hareketZarfi) return c.json({ error: "hesap hareketi gerekli (hesaba bağlı mevduat)" }, 400);
  const found = await db.tx(async (t) => {
    const old = await t.get<{ id: number }>("SELECT id FROM deposits WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    await revertEntries(t, uid, "deposits", id);
    await t.run(
      "UPDATE deposits SET open_date=?, account_id=?, enc=? WHERE id=? AND user_id=?",
      b.open_date, accountId, enc, id, uid,
    );
    await applyEntry(t, uid, accountId, hareketZarfi, { date: b.open_date, kind: "mevduat", source_table: "deposits", source_id: id });
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] Vadeli hesap düzenlendi (id:${uid})`);
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

/* Kart adı ve limiti ZARFTA; kesim/son ödeme günleri düz — ekstre takvimi onlara bakıyor. */
crud("cards", "cards", [
  { name: "enc", required: true }, { name: "statement_day", required: true }, { name: "due_day", required: true },
  { name: "pay_account_id" },
]);
/* Harcamanın adı, tutarı ve taksit sayısı ZARFTA. Kategori (FK) düz: toplu kategorilemede yalnız
   o değişir ve zarfa dokunmadan yazılabilir. */
crud("cardtxs", "card_txs", [
  { name: "card_id", required: true }, { name: "date", required: true }, { name: "enc", required: true },
  { name: "category_id" }, // Faz 39 (ops.) — kategorisiz kart harcaması hâlâ geçerli bir kayıt
]);

/* ---- kart ekstresi ödeme (Faz 8.2) ----
   Ekstre olayı projeksiyonda sanaldı; "Ödedim" onu gerçek kayda çevirir: transactions'a −tutar yazılır
   (hesap seçildiyse bakiye düşer, gider kaydı oluşur), (card_id, due) statement_payments ile işaretlenir →
   borç ve projeksiyon o ekstreyi artık saymaz (çift sayım yok). Tutar SUNUCUDA hesaplanır (engine
   txShares — istemciden gelen tutara güvenilmez). Geçmiş vadeli ekstre de ödenebilir (kayıt altına almak
   için); o zaten borçta/projeksiyonda olmadığından yalnız defter kaydı üretir. */
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tek tx içinde idempotent ekstre ödemesi (elle "Ödedim" + otomatik talimat ortak yazıcısı).
    Yeni ödendiyse true; (card, due) zaten işaretliyse false döner. */
async function payStatementTx(
  t: TxClient, uid: number, card: { id: number }, dueK: string, kayitEnc: string, hareketEnc: string | null,
  accountId: number | null, categoryId: number | null, date?: string,
): Promise<boolean> {
  /* "X ekstresi" adlı gider kaydını ve hareketini İSTEMCİ kurar (kart adı ve tutar zarfta). */
  /* Kayıt tarihi: elle ödemede BUGÜN (kullanıcı şimdi ödedi), ödeme talimatında VADE GÜNÜ.
     Ayrım E2EE aşama 2'de gerekti: otomatik ödeme artık uygulama açılışında yazılıyor, yani
     günler sonra da yazılabilir — todayLocal() kullansaydı talimatla ödenen bir ekstre
     bankanın çektiği günde değil, uygulamayı açtığın günde görünürdü. Vade günü zaten
     doğrusu: talimat o gün işler. */
  const tarih = date ?? todayLocal();
  const mark = await t.run(
    "INSERT INTO statement_payments (card_id, due, created_at, user_id) VALUES (?,?,?,?) ON CONFLICT (card_id, due) DO NOTHING",
    card.id, dueK, nowLocal(), uid,
  );
  if (!mark.changes) return false;
  const info = await t.run(
    "INSERT INTO transactions (date,enc,category_id,account_id,user_id) VALUES (?,?,?,?,?) RETURNING id",
    tarih, kayitEnc, categoryId, accountId, uid,
  );
  await applyEntry(t, uid, accountId, hareketEnc, { date: tarih, kind: "islem", source_table: "transactions", source_id: info.id });
  await t.run("UPDATE statement_payments SET tx_id=? WHERE card_id=? AND due=?", info.id, card.id, dueK);
  return true;
}

api.post("/cards/:id/pay-statement", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => ({}));
  const due = String((b as any).due ?? "");
  if (!DUE_RE.test(due)) return c.json({ error: "due 'YYYY-MM-DD' olmalı" }, 400);
  const card = await db.get<{ id: number }>("SELECT id FROM cards WHERE id=? AND user_id=?", c.req.param("id"), uid);
  if (!card) return c.json({ error: "kart yok" }, 404);
  /* Ekstre tutarı (statementAmount) ve "X ekstresi" kaydı İSTEMCİDE kurulur (yazim/tutar.ts +
     zarf.ts); "bu tarihte ekstre yok" denetimi de orada. Faz 8.2 tutarı bilerek sunucuya almıştı
     ("istemciden gelen tutara güvenilmez") — o gerekçe sıfır bilgi modelinde düşüyor. */
  const kayit = zarfAl((b as any).kayit_enc), hareketZarfi = zarfAl((b as any).entry_enc);
  if (!kayit || hareketZarfi === false) return c.json({ error: "ekstre kaydı zarfı gerekli" }, 400);
  const accountId = (b as any).account_id != null && (b as any).account_id !== "" ? Number((b as any).account_id) : null;
  const categoryId = (b as any).category_id != null && (b as any).category_id !== "" ? Number((b as any).category_id) : null;
  const tarih = typeof (b as any).date === "string" && DUE_RE.test((b as any).date) ? (b as any).date : undefined;
  const created = await db.tx((t) => payStatementTx(t, uid, card, due, kayit, hareketZarfi, accountId, categoryId, tarih));
  if (created) console.log(`[audit] Kredi kartı ekstresi ödendi: kart #${card.id} (vade: ${due}, id:${uid})`);
  return c.json({ ok: true, already: !created });
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
crud("portfolios", "portfolios", [{ name: "enc", required: true }]); // ad + not zarfta

/* Kategori ADI zarfta. Sonuç: aynı adlı iki kategoriyi sunucu artık AYIRT EDEMEZ (eski
   UNIQUE (user_id, name) kısıtı adla birlikte düştü) — denetim istemcide (Tanımlar,
   KategoriAlani). Tür ve renk düz: filtre ve seçici onlara bakıyor, kişisel bir şey söylemiyor. */
crud("categories", "categories", [{ name: "enc", required: true }, { name: "kind", required: true }, { name: "color" }]);

/* ---- gerçekleşen işlemler (transactions): hesaba bağlıysa bakiyeyi de oynatır ----
   Jenerik crud() yerine özel rotalar: amount işaretlidir (gider −, gelir +);
   account_id verilmişse INSERT bakiyeye ekler, DELETE geri alır — BEGIN/COMMIT ile atomik.
   PUT yok: kayıt düzenleme modeli sil + yeniden ekle'dir (bakiye tersinirliği böyle basit kalır). */
api.post("/transactions", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "geçersiz gövde" }, 400);
  if (!b.date) return c.json({ error: "date zorunlu" }, 400);
  /* Ad ve tutar ZARFTA; hesaba bağlıysa hareketi (not = işlemin adı) istemci kurar. */
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "işlem zarfı gerekli (ad + tutar)" }, 400);
  const uid = c.get("user").id;
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO transactions (date,enc,category_id,account_id,user_id) VALUES (?,?,?,?,?) RETURNING id",
      b.date, enc, b.category_id ?? null, b.account_id ?? null, uid,
    );
    await applyEntry(t, uid, b.account_id ?? null, hareketZarfi, { date: b.date, kind: "islem", source_table: "transactions", source_id: info.id });
    return info.id;
  });
  console.log(`[audit] İşlem eklendi (id:${uid})`); // ad/tutar zarfta — eskiden loga açık basılıyordu
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
    if (!r.date || !zarfGecerli(r.enc) || zarfAl(r.entry_enc) === false) {
      return c.json({ error: "her satırda tarih ve işlem zarfı zorunlu" }, 400);
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
        "INSERT INTO transactions (date,enc,category_id,account_id,user_id) VALUES (?,?,?,?,?) RETURNING id",
        r.date, r.enc, r.category_id ?? null, r.account_id ?? null, uid,
      );
      await applyEntry(t, uid, r.account_id ?? null, zarfAl(r.entry_enc) || null, { date: r.date, kind: "islem", source_table: "transactions", source_id: info.id });
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
  if (!b.date) return c.json({ error: "date zorunlu" }, 400);
  const enc = zarfAl(b.enc), hareketZarfi = zarfAl(b.entry_enc);
  if (!enc || hareketZarfi === false) return c.json({ error: "işlem zarfı gerekli (ad + tutar)" }, 400);
  const uid = c.get("user").id;
  const id = c.req.param("id");
  const accountId = b.account_id != null && b.account_id !== "" ? Number(b.account_id) : null;
  const categoryId = b.category_id != null && b.category_id !== "" ? Number(b.category_id) : null;
  const found = await db.tx(async (t) => {
    const old = await t.get<{ id: number }>("SELECT id FROM transactions WHERE id=? AND user_id=?", id, uid);
    if (!old) return false;
    await revertEntries(t, uid, "transactions", id);
    await t.run(
      "UPDATE transactions SET date=?, enc=?, category_id=?, account_id=? WHERE id=? AND user_id=?",
      b.date, enc, categoryId, accountId, id, uid,
    );
    await applyEntry(t, uid, accountId, hareketZarfi, { date: b.date, kind: "islem", source_table: "transactions", source_id: Number(id) });
    return true;
  });
  if (!found) return c.json({ error: "kayıt yok" }, 404);
  console.log(`[audit] İşlem düzenlendi (id:${uid})`);
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
/* Faz 27 — geriye doldurma: Yahoo'nun günlük geçmişinden `price_history` + referans endeksler.
   Sık çağrılacak bir uç DEĞİL (tek seferlik / yılda bir); N sembol × 1 istek yaptığından
   rate-limit dar tutuldu. Veri global olduğundan sonuç tüm kullanıcılara yarar. */
api.post("/prices/backfill", async (c) => {
  if (rateLimited(`backfill:${c.get("user").id}`, 2, 60 * 60_000)) return c.json({ error: "Geriye doldurma saatte 2 kez çalıştırılabilir" }, 429);
  const range = String((await c.req.json().catch(() => ({})) as any)?.range ?? "2y");
  if (!/^(1mo|3mo|6mo|1y|2y|5y|max)$/.test(range)) return c.json({ error: "geçersiz aralık" }, 400);
  const [symbols, benchmarks] = await Promise.all([backfillPriceHistory(range), refreshBenchmarks(range)]);
  return c.json({ ok: true, range, symbols, benchmarks });
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
  const [accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers, userSettings, ai_conversations, ai_messages, ai_actions] =
    await Promise.all([
      db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT recurring_id, from_month, enc FROM recurring_amounts WHERE user_id=? ORDER BY recurring_id, from_month", uid),
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
      /* Faz 34 — asistan sohbeti ve uyguladığı işlemler de kullanıcının verisidir: sohbet
         sunucuya taşındığından (eskiden localStorage'daydı, export'un görebileceği bir yer
         değildi) KVKK indirmesine de girmesi gerekir. */
      db.all("SELECT * FROM ai_conversations WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM ai_messages WHERE user_id=? ORDER BY id", uid),
      db.all("SELECT * FROM ai_actions WHERE user_id=? ORDER BY id", uid),
    ]);
  c.header("Content-Disposition", `attachment; filename="finans-export-${todayLocal()}.json"`);
  console.log(`[audit] Veri dışa aktarma (KVKK Export): (id:${uid})`);
  return c.json({
    exported_at: nowLocal(), user: c.get("user"),
    accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs, categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers,
    ai_conversations, ai_messages, ai_actions,
    settings: Object.fromEntries(userSettings.map((s) => [s.key, s.value])),
  });
});

/* ---- KVKK: hesabı ve tüm verisini sil (parola onaylı; ON DELETE CASCADE ile tenant verisi + oturumlar) ---- */
/* ================= E2EE aşama 6: tarayıcıda şifreleme göçü =================
   Aşama 5'in göçü veriyi SUNUCUDA düz metin zarflara (`p1:`) topladı; şifreli zarfa (`v1:`)
   çevirmeyi sunucu YAPAMAZ — anahtar yok. Kullanıcı giriş yapınca tarayıcı düz zarfları
   çeker, şifreler, geri yazar; hepsi bitince `tamam` der ve düz zarf kapısı kapanır.
   Uçların hiçbiri içerik görmez: sunucu yalnız "hangi satır hâlâ düz" sorusunu cevaplar ve
   şifreli paketi yerine koyar. */
const GOC_TABLOLARI = Object.keys(ZARF) as ZarfliTablo[];
const gocAnahtari = (t: ZarfliTablo): string[] =>
  t === "recurring_amounts" ? ["recurring_id", "from_month"] : t === "ai_plans" ? ["plan_id"] : ["id"];
const GOC_SAYFA = 400;

/* Kurtarma paketi YALNIZ YOKSA yazılır. Değiştirmek (kodu yenilemek) oturumu çalınmış
   birinin gerçek kodu geçersiz kılmasına izin verirdi — o ayrı, parola onaylı bir akış olur. */
api.post("/e2ee/kurtarma", async (c) => {
  const uid = c.get("user").id;
  const { dek_wrapped_rk } = await c.req.json().catch(() => ({}));
  if (typeof dek_wrapped_rk !== "string" || !PAKET.test(dek_wrapped_rk)) return c.json({ error: "geçersiz kurtarma paketi" }, 400);
  const r = await db.run("UPDATE users SET dek_wrapped_rk=? WHERE id=? AND dek_wrapped_rk IS NULL", dek_wrapped_rk, uid);
  if (!r.changes) return c.json({ error: "kurtarma kodu zaten kayıtlı" }, 409);
  console.log(`[audit] Kurtarma kodu kaydedildi: (id:${uid})`);
  return c.json({ ok: true });
});

api.get("/e2ee/bekleyen", async (c) => {
  const uid = c.get("user").id;
  const satirlar: { tablo: ZarfliTablo; anahtar: Record<string, unknown>; enc: string }[] = [];
  for (const t of GOC_TABLOLARI) {
    if (satirlar.length >= GOC_SAYFA) break;
    const k = gocAnahtari(t);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT ${k.join(", ")}, enc FROM ${t} WHERE user_id=? AND enc LIKE 'p1:%' LIMIT ?`, uid, GOC_SAYFA - satirlar.length);
    for (const r of rows) satirlar.push({ tablo: t, anahtar: Object.fromEntries(k.map((x) => [x, r[x]])), enc: String(r.enc) });
  }
  return c.json({ tamam: c.get("user").e2ee, satirlar });
});

/* Şifreli paketi yerine koyar. Koşul `enc LIKE 'p1:%'`: arada aynı satır (başka sekmeden)
   zaten şifreli yazıldıysa ÜZERİNE YAZILMAZ — o yazım daha yenidir. */
api.put("/e2ee/satirlar", async (c) => {
  const uid = c.get("user").id;
  const b = await c.req.json().catch(() => null);
  const satirlar = b?.satirlar;
  if (!Array.isArray(satirlar) || !satirlar.length || satirlar.length > GOC_SAYFA) return c.json({ error: "geçersiz istek" }, 400);
  for (const x of satirlar) {
    if (!GOC_TABLOLARI.includes(x?.tablo)) return c.json({ error: "bilinmeyen tablo" }, 400);
    if (typeof x.enc !== "string" || !x.enc.startsWith("v1:") || !zarfGecerli(x.enc, 64_000)) return c.json({ error: "şifreli zarf gerekli" }, 400);
    if (!x.anahtar || typeof x.anahtar !== "object" || gocAnahtari(x.tablo).some((k) => x.anahtar[k] == null)) return c.json({ error: "satır anahtarı eksik" }, 400);
  }
  let guncellenen = 0;
  await db.tx(async (t) => {
    for (const x of satirlar as { tablo: ZarfliTablo; anahtar: Record<string, unknown>; enc: string }[]) {
      const k = gocAnahtari(x.tablo);
      const r = await t.run(
        `UPDATE ${x.tablo} SET enc=? WHERE user_id=? AND enc LIKE 'p1:%' AND ${k.map((c) => `${c}=?`).join(" AND ")}`,
        x.enc, uid, ...k.map((c) => x.anahtar[c]));
      guncellenen += r.changes;
    }
  });
  return c.json({ guncellenen });
});

/* Göç bitti. Sunucu İSTEMCİYE GÜVENMEZ: düz zarf gerçekten kalmadığını kendisi sayar.
   Kurtarma paketi yoksa da bitmez — şifreli veri tek anahtara (parolaya) bağlı kalmamalı. */
api.post("/e2ee/tamam", async (c) => {
  const uid = c.get("user").id;
  const u = await db.get<{ rk: boolean }>("SELECT dek_wrapped_rk IS NOT NULL AS rk FROM users WHERE id=?", uid);
  if (!u?.rk) return c.json({ error: "önce kurtarma kodu kaydedilmeli" }, 409);
  let kalan = 0;
  for (const t of GOC_TABLOLARI)
    kalan += (await db.get<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE user_id=? AND enc LIKE 'p1:%'`, uid))!.n;
  if (kalan) return c.json({ error: `${kalan} satır hâlâ şifrelenmemiş`, kalan }, 409);
  await db.run("UPDATE users SET e2ee_migrated_at=? WHERE id=? AND e2ee_migrated_at IS NULL", nowLocal(), uid);
  console.log(`[audit] Veri tamamen şifreli (göç bitti): (id:${uid})`);
  return c.json({ ok: true });
});

/* ————— Parola değişimi (E2EE aşama 6) —————
   Veri YENİDEN ŞİFRELENMEZ: DEK aynı kalır, yalnız yeni parolanın KEK'iyle yeniden sarılır
   (anahtar zincirinin ucuz olduğu tek yer). İki adım, çünkü yeniden sarmayı tarayıcı yapar:
   (1) sarılı paketi al, (2) yeni malzemeyi yaz. Paket OTURUMA değil ESKİ PAROLANIN KANITINA
   verilir: çalınmış bir oturum onu alıp çevrimdışı parola denemesine başlayamasın. */
const eskiParolaDogru = async (uid: number, token: unknown): Promise<boolean> => {
  const u = await db.get<{ password_hash: string; password_kdf: string }>("SELECT password_hash, password_kdf FROM users WHERE id=?", uid);
  return !!u && u.password_kdf === "v2" && typeof token === "string" && (await verifyPassword(token, u.password_hash));
};
api.post("/account/parola-paket", async (c) => {
  const uid = c.get("user").id;
  if (rateLimited(`parola:${uid}`, 10, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const { auth_token } = await c.req.json().catch(() => ({}));
  if (!(await eskiParolaDogru(uid, auth_token))) return c.json({ error: "Mevcut parola hatalı" }, 401);
  const u = await db.get<{ p: string | null }>("SELECT dek_wrapped_pw AS p FROM users WHERE id=?", uid);
  return c.json({ dek_wrapped_pw: u?.p ?? null });
});
api.post("/account/parola", async (c) => {
  const uid = c.get("user").id;
  if (rateLimited(`parola:${uid}`, 10, 15 * 60_000)) return c.json({ error: "Çok fazla deneme, biraz sonra tekrar dene" }, 429);
  const b = await c.req.json().catch(() => ({}));
  if (!(await eskiParolaDogru(uid, b.eski_auth_token))) return c.json({ error: "Mevcut parola hatalı" }, 401);
  const m = e2eeMalzemeDogrula(b);
  if (typeof m === "string") return c.json({ error: m }, 400);
  // kurtarma paketi DEĞİŞMEZ (aynı DEK'i sarıyor, parolaya bağlı değil)
  await db.run("UPDATE users SET password_hash=?, kdf_salt=?, kdf_params=?, dek_wrapped_pw=? WHERE id=?",
    await hashPassword(m.auth_token), m.kdf_salt, m.kdf_params, m.dek_wrapped_pw, uid);
  /* Diğer cihazların oturumları düşer (eski parolayı bilen biri oturum açmış olabilir — parola
     değiştirmenin en yaygın sebebi bu); bu cihaz yeni bir oturumla devam eder. */
  await revokeUserSessions(uid);
  const { token, expires } = await createSession(uid);
  setSessionCookie(c, token, expires);
  console.log(`[audit] Parola değiştirildi: (id:${uid})`);
  return c.json({ ok: true });
});

api.post("/account/delete", async (c) => {
  const uid = c.get("user").id;
  const { password, auth_token } = await c.req.json().catch(() => ({}));
  const u = await db.get<{ password_hash: string; password_kdf: string }>("SELECT password_hash, password_kdf FROM users WHERE id=?", uid);
  // v2 hesapta parola yerine auth_token doğrulanır (parola sunucuya gelmez); yol hesap türüyle eşleşmeli.
  const gizli = u?.password_kdf === "v2" ? auth_token : password;
  if (!u || typeof gizli !== "string" || !(await verifyPassword(gizli, u.password_hash))) return c.json({ error: "Parola hatalı" }, 401);
  await db.run("DELETE FROM users WHERE id=?", uid); // cascade: tüm veri + sessions + user_settings
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  console.log(`[audit] Hesap kalıcı olarak silindi (KVKK Delete): (id:${uid})`);
  return c.json({ ok: true });
});

/* ---- AI asistan (Faz 22; E2EE aşama 4'te sunucu = röle + depo) ----
   Eskiden onaylanan işlemler burada "iç istek" olarak (`app.request`, kullanıcının çerezi
   taşınarak) aynı uygulamaya gönderiliyordu. O yol aşama 4e'de SİLİNDİ: ajan döngüsü artık
   tarayıcıda koşuyor ve yazma işlemleri normal API uçlarına kullanıcının kendi oturumuyla,
   doğrudan gidiyor. Asistana özel bir yazma yolu diye bir şey kalmadı. */
mountAi(api, { rateLimited });

app.route("/api", api);

/* Yasal sayfalar (Faz 28) — GUARD'IN DIŞINDA ve SPA'nın dışında bilinçli olarak duruyorlar:
   gizlilik politikası giriş yapmadan okunabilmeli (Google OAuth doğrulaması da anonim olarak
   çeker). Uzantısız temiz URL için açık rota şart: aşağıdaki `serveStatic({root})` "/gizlilik"
   diye bir dosya bulamaz ve istek catch-all'a düşüp index.html (SPA) döndürürdü. */
app.get("/gizlilik", serveStatic({ path: "../web/dist/gizlilik.html" }));
app.get("/kosullar", serveStatic({ path: "../web/dist/kosullar.html" }));

/* Tanıtım sayfası (Faz 30) — "/" OTURUMA GÖRE dallanır: anonim ziyaretçi landing'i,
   girişli kullanıcı doğrudan uygulamayı görür.

   Neden ayrı bir /landing adresi değil de "/"?  Ana sayfa SEO'nun en değerli URL'i;
   tanıtımı /hakkinda'ya koymak onu boşa harcardı.  Neden uygulamayı /app'e taşıyıp
   "/"yi tümden landing yapmadık?  Manifest'teki `start_url` "/" — telefonuna PWA'yı
   KURMUŞ kullanıcıların kısayolu oraya bakıyor; "/"yi koşulsuz landing yapmak onları
   her açılışta tanıtım sayfasına düşürürdü.  Oturum kontrolü ikisini de çözer:
   Googlebot (çerezsiz) landing'i çeker, kurulu PWA sahibi uygulamaya girer.

   Çerezsiz istekte `getSessionUser` DB'ye hiç gitmez (auth.ts: `if (!token) return null`),
   yani anonim trafiğin ek sorgu maliyeti yok.  `Vary: Cookie` şart: aksi hâlde araya
   giren bir önbellek landing'i girişli kullanıcıya (veya tersini) servis edebilirdi. */
const serveApp = serveStatic({ path: "../web/dist/index.html" });
const serveLanding = serveStatic({ path: "../web/dist/landing.html" });

app.get("/", async (c, next) => {
  c.header("Vary", "Cookie");
  c.header("Cache-Control", "no-store");
  /* Paylaşım hedefi de "/" adresine gelir (manifest'teki `share_target.action`).
     Kurulu PWA'da servis çalışanı bu gezinmeyi zaten index.html ile karşılar, ama
     çalışan henüz etkin değilse ya da kaldırılmışsa istek buraya düşer: landing
     döndürseydik paylaşılan SMS metni sessizce kaybolurdu. Parametre varsa
     koşulsuz uygulamaya ver — giriş yapılmamışsa uygulama zaten giriş ekranını
     gösterir ve metin `?ekle=` olarak URL'de durmaya devam eder. */
  if (c.req.query("ekle") !== undefined) return serveApp(c, next);
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  return user ? serveApp(c, next) : serveLanding(c, next);
});

/* Landing'in "Uygulamayı aç" düğmeleri buraya gider — "/" oturumsuzken landing
   döndürdüğü için uygulamaya HER ZAMAN açılan bir adres gerekiyor.  Aşağıdaki
   catch-all bunu zaten karşılardı; rota yine de açıkça yazıldı ki ileride
   dist/ altına "app" adlı bir dosya/dizin girerse sessizce gölgelenmesin. */
app.get("/app", serveApp);

/* prod: derlenmiş arayüzü sun (apps/web/dist) — pnpm bu paketi kendi dizininden
   çalıştırdığı için yol apps/server'a göre relatif */
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveApp);

/* Otomatik gerçekleştirme (auto düzenli kalemler + ekstre ödeme talimatı) BURADAN KALKTI
   (E2EE aşama 2). İkisi de tutarı OKUMAK zorundaydı (`recurring_amounts.amount`,
   `card_txs.amount`) ve şifreli dünyada yapamayacakları tek şey bu.

   Sunucuda tutmanın tek yolu, tutarın önceden şifrelenmiş İKİNCİ bir kopyasını kalem
   tanımının yanında taşımaktı; o kopya beş şekilde bayatlar (tutar/hedef/gün değişir,
   kalem silinir, bitiş ayı konur) ve bayatladığında cron sessizce YANLIŞ bir finansal
   kayıt yazardı. Geç yazmak yanlış yazmaktan iyidir — üstelik gecikme görünür.

   Karar artık engine'de (`otomatik.ts`: `bekleyenDuzenli` / `bekleyenEkstreler`, 22 testli),
   sürücüsü uygulama açılışında. Defter yalnız istemci üzerinden okunduğu için ekranda
   eksik rakam oluşmuyor; telafi pencereleri (45 gün / 10 gün) olduğu gibi devralındı. */

/* her 15 dk fiyat tazele (piyasa dışı saatlerde de zararsız) + tüketilmiş e-posta token'larını buda */
const runScheduledJobs = () => {
  refreshAll().catch(() => {});
  purgeStaleEmailTokens().catch(() => {}); // tüketilmiş/süresi geçmiş aktivasyon-sıfırlama token'ları
};

/* Piyasa geçmişi bakımı günde bir: referansları tazeler ve YENİ alınan sembollerin geçmişini
   doldurur (bkz. autoBackfill). Boşluk yoksa istek de yok. */
cron.schedule("20 3 * * *", () => {
  autoBackfill()
    .then((r) => { if (r.symbols.length) console.log(`[backfill] yeni sembol dolduruldu: ${r.symbols.join(", ")}`); })
    .catch((e) => console.warn("[backfill] günlük bakım hatası:", e));
  /* Faz 36 — kurumsal olaylar (bedelsiz/temettü) aynı günlük turda. Ayrı bir cron açılmadı:
     backfill ile AYNI Yahoo ucuna gidiyor, ikinci bir zamanlama iki kat istek demekti.
     Upsert olduğu için idempotent; hata tüm turu düşürmesin diye kendi catch'i var. */
  refreshCorporateActions()
    .then((r) => {
      const n = r.reduce((a, b) => a + b.events, 0);
      if (n) console.log(`[kurumsal] ${n} olay tazelendi (${r.filter((x) => x.events).map((x) => x.symbol).join(", ")})`);
    })
    .catch((e) => console.warn("[kurumsal] günlük tazeleme hatası:", e));
  /* Faz 37 — bilanço tarihleri aynı günlük turda ve aynı gerekçeyle (tek Yahoo boru hattı).
     Ayrı zamanlama açmak istekleri ikiye katlardı; tarih günde bir kez değişse bile fazlası
     bilgi getirmiyor. Kendi catch'i var: crumb el sıkışması bozulursa takvimin kalanı
     (defter + makro) çalışmaya devam etmeli. */
  refreshCompanyEvents()
    .then((r) => { if (r.length) console.log(`[bilanço] ${r.length} sembol tazelendi (${r.filter((x) => x.tahmini).length} tanesi tahmini tarih)`); })
    .catch((e) => console.warn("[bilanço] günlük tazeleme hatası:", e));
});
cron.schedule("*/15 * * * *", runScheduledJobs);

/* ---- uyanık tutma (Faz 23) ----
   Render ücretsiz katmanı 15 dk GELEN İSTEK olmazsa süreci uyutur; sonraki ilk istek 30-60 sn
   bekler. Telefondan "SMS paylaş → kaydet" akışı bu beklemeyle kullanılamaz hâle geliyordu.
   Kendi genel adresimize 10 dakikada bir istek atmak bunu önler (istek internetten döndüğü için
   Render'ın saydığı türden gelen trafiktir). Hedef `/api/ping` — DB'ye dokunmayan uç; gerekçesi
   orada yazılı (yanlış hedef seçmek Neon'un aylık compute kotasını yiyordu).
   DÜRÜST KISIT: bu yalnız UYANIK TUTAR, uyandırmaz — süreç bir kez uykuya dalarsa (deploy, çökme,
   kotanın bitmesi) kendi cron'u da durmuş olur ve onu ancak DIŞARIDAN bir istek uyandırır. Asıl
   güvence bu yüzden dış bir uptime monitörüdür (bkz. README); bu ping onun tamamlayıcısı.
   Yerelde ve KEEPALIVE_URL/APP_URL tanımlı değilken çalışmaz. */
const keepaliveUrl = (process.env.KEEPALIVE_URL || process.env.APP_URL || "").replace(/\/+$/, "");
if (isProd && keepaliveUrl) {
  cron.schedule("*/10 * * * *", () => {
    fetch(`${keepaliveUrl}/api/ping`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => { if (!r.ok) console.warn(`[keepalive] ping ucu ${r.status} döndü`); })
      .catch((e: Error) => console.warn(`[keepalive] ping başarısız: ${e.message}`));
  });
  console.log(`[keepalive] 10 dk'da bir ${keepaliveUrl}/api/ping yoklanacak`);
}

const port = Number(process.env.PORT || 8787);
/* şema hazır olsun, sonra sun */
await initDb();
/* Token'lar artık hash'li saklanıyor; açılıştaki bu temizlik hem tabloyu küçük tutar hem de
   hash'lemeden önce yazılmış eski DÜZ METİN satırları (artık eşleşmiyorlar) diskten siler. */
await purgeStaleEmailTokens()
  .then((n) => { if (n) console.log(`[auth] ${n} eski e-posta token'ı temizlendi`); })
  .catch((e) => console.warn("[auth] token temizliği başarısız:", e));
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

/* Açılışta bir kez, SUNUMU BLOKLAMADAN: yeni bir sunucuya kurulduğunda (boş Neon) fiyat geçmişi
   ve referanslar kendiliğinden 2 yıl geriye dolsun. Elle bir uç çağırmayı beklemek, özelliğin
   "gelmemiş" görünmesi demekti. İş bittiyse (bayrak + dolu tablo) ikinci çalıştırmada istek atmaz. */
autoBackfill()
  .then((r) => console.log(`[backfill] hazır — referans ${r.benchmarks} satır${r.symbols.length ? `, yeni sembol: ${r.symbols.join(", ")}` : ""}`))
  .catch((e) => console.warn("[backfill] açılış bakımı başarısız (grafik kısa kalır):", e));

/* Kurumsal olaylar da AÇILIŞTA bir kez — yukarıdakiyle aynı gerekçe. Yalnız günlük cron'a
   bağlı kalsaydı yeni bir kuruluma (ya da bu sürümün deploy'una) kadar tablo boş kalır ve
   kaçırılmış bedelsiz uyarısı bir güne kadar HİÇ çıkmazdı — özellik "gelmemiş" görünürdü.
   Upsert olduğu için tekrar çalışması zararsız. */
refreshCorporateActions()
  .then((r) => {
    const n = r.reduce((a, b) => a + b.events, 0);
    console.log(`[kurumsal] açılış taraması: ${r.length} sembol, ${n} olay`);
  })
  .catch((e) => console.warn("[kurumsal] açılış taraması başarısız (kaçan bedelsiz uyarısı gecikir):", e));

/* Bilanço tarihleri de AÇILIŞTA bir kez (autoBackfill/refreshCorporateActions'ın gerekçesi):
   yalnız günlük cron'a bağlı kalsaydı deploy sonrası takvimin piyasa bölümü bir güne kadar
   boş kalır ve özellik "gelmemiş" görünürdü. */
refreshCompanyEvents()
  .then((r) => console.log(`[bilanço] açılış taraması: ${r.length} sembolün tarihi alındı`))
  .catch((e) => console.warn("[bilanço] açılış taraması başarısız (takvimde bilanço satırı çıkmaz):", e));

/* Başlangıç catch-up'ı: Render free tier trafik yokken süreci uyutur; uyanışta node-cron ilk 15-dk
   tıkına dek beklerdi → kullanıcı bayat fiyat/işlenmemiş otonom kalem görürdü. Sunar sunmaz bir kez
   çalıştır — uykuda kaçan vadeler telafi pencereleriyle (45/10 gün) yakalanır. Sık uyanışlar zararsız:
   TEFAS günde-bir/geri-çekilme kapıları DB'de, otonom işler idempotent (PK'ler çift kaydı engeller). */
setTimeout(runScheduledJobs, 3_000).unref();
