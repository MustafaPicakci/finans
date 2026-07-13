import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import cron from "node-cron";
import { db, initDb, nowLocal, todayLocal, TENANT_TABLES, GLOBAL_SETTING_KEYS } from "./db.js";
import { refreshAll } from "./prices.js";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession, SESSION_COOKIE, type SessionUser } from "./auth.js";

const app = new Hono();
const api = new Hono<{ Variables: { user: SessionUser } }>();

/* ---- güvenlik başlıkları (Faz 5.4) — tüm yanıtlara ---- */
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
});

/* ---- basit in-memory rate-limit (Faz 5.4) — auth uçları için brute-force koruması ---- */
const rlHits = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlHits.get(key);
  if (!e || e.reset <= now) { rlHits.set(key, { n: 1, reset: now + windowMs }); return false; }
  if (e.n >= max) return true;
  e.n++; return false;
}
const clientIp = (c: any) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";

/* ================= AUTH (Faz 5.1) =================
   Guard'tan ÖNCE tanımlanır → bu rotalar korunmaz. Çok-kiracılık (user_id scoping) Faz 5.2'de;
   şimdilik veri paylaşımlı, kayıt yalnız ilk kullanıcıya (owner) açık. */
const isProd = process.env.NODE_ENV === "production";
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
  const info = await db.run(
    "INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?) RETURNING id",
    email2, await hashPassword(password), new Date().toISOString(),
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
  const user = await db.get<{ id: number; email: string; password_hash: string }>(
    "SELECT id, email, password_hash FROM users WHERE email = ?", String(email).trim().toLowerCase(),
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) return c.json({ error: "E-posta veya parola hatalı" }, 401);
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
  const [accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, autoPrices, userPrices, price_history, globalSettings, userSettings] =
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
    accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions,
    prices: [...pm.values()], price_history,
    // global (fx/tefas) + kullanıcı ayarları (horizon/cash_funds); kullanıcı çakışmada kazanır
    settings: Object.fromEntries([...globalSettings, ...userSettings].map((s) => [s.key, s.value])),
  });
});

/* ---- generic CRUD ---- */
type Col = { name: string; required?: boolean; default?: unknown };
function crud(route: string, table: string, cols: Col[]) {
  api.post(`/${route}`, async (c) => {
    const b = await c.req.json();
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
    const b = await c.req.json();
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
]);
crud("loans", "loans", [
  { name: "name", required: true }, { name: "amount", required: true },
  { name: "first_date", required: true }, { name: "total", required: true },
]);
crud("oneoffs", "oneoffs", [
  { name: "date", required: true }, { name: "name", required: true }, { name: "amount", required: true },
]);
crud("trades", "trades", [
  { name: "date", required: true }, { name: "asset_type", required: true }, { name: "symbol", required: true },
  { name: "side", required: true }, { name: "qty", required: true }, { name: "price", required: true }, { name: "fee" },
  { name: "currency", default: "TRY" },
]);
crud("cards", "cards", [
  { name: "name", required: true }, { name: "limit_amount" },
  { name: "statement_day", required: true }, { name: "due_day", required: true },
]);
crud("cardtxs", "card_txs", [
  { name: "card_id", required: true }, { name: "date", required: true },
  { name: "name", required: true }, { name: "amount", required: true }, { name: "installments" },
]);
crud("categories", "categories", [
  { name: "name", required: true }, { name: "kind", required: true }, { name: "color" },
]);

/* ---- gerçekleşen işlemler (transactions): hesaba bağlıysa bakiyeyi de oynatır ----
   Jenerik crud() yerine özel rotalar: amount işaretlidir (gider −, gelir +);
   account_id verilmişse INSERT bakiyeye ekler, DELETE geri alır — BEGIN/COMMIT ile atomik.
   PUT yok: kayıt düzenleme modeli sil + yeniden ekle'dir (bakiye tersinirliği böyle basit kalır). */
api.post("/transactions", async (c) => {
  const b = await c.req.json();
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
api.post("/prices/refresh", async (c) => c.json(await refreshAll()));
/* elle fiyat KULLANICIYA ÖZEL (user_prices) — global otomatik fiyatı etkilemez, başka kullanıcıya sızmaz.
   Global price_history'e yazılmaz (bir kullanıcının eli global geçmişi kirletmesin). */
api.put("/prices", async (c) => {
  const uid = c.get("user").id;
  const { symbol, asset_type, price, currency } = await c.req.json();
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
  const b = (await c.req.json()) as Record<string, string>;
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
  const [accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, userSettings] =
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
      db.all<{ key: string; value: string }>("SELECT key, value FROM user_settings WHERE user_id=?", uid),
    ]);
  c.header("Content-Disposition", `attachment; filename="finans-export-${todayLocal()}.json"`);
  return c.json({
    exported_at: nowLocal(), user: c.get("user"),
    accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions,
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

/* saat başı + her 15 dk fiyat tazele (piyasa dışı saatlerde de zararsız) */
cron.schedule("*/15 * * * *", () => {
  refreshAll().catch(() => {});
});

const port = Number(process.env.PORT || 8787);
/* şema hazır olsun, sonra sun */
await initDb();
serve({ fetch: app.fetch, port }, () => console.log(`finans → http://localhost:${port}`));
