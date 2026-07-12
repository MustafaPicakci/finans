import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import cron from "node-cron";
import { db, initDb, nowLocal, todayLocal } from "./db.js";
import { refreshAll } from "./prices.js";

const app = new Hono();
const api = new Hono();

/* ---- tek seferde tüm veri ---- */
api.get("/all", async (c) => {
  const [accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, prices, price_history, settingsRows] =
    await Promise.all([
      db.all("SELECT * FROM accounts ORDER BY id"),
      db.all("SELECT * FROM recurring ORDER BY day, id"),
      db.all("SELECT * FROM loans ORDER BY id"),
      db.all("SELECT * FROM oneoffs ORDER BY date"),
      db.all("SELECT * FROM trades ORDER BY date, id"),
      db.all("SELECT * FROM cards ORDER BY id"),
      db.all("SELECT * FROM card_txs ORDER BY date, id"),
      db.all("SELECT * FROM categories ORDER BY name"),
      db.all("SELECT * FROM transactions ORDER BY date DESC, id DESC"),
      db.all("SELECT * FROM prices"),
      db.all("SELECT * FROM price_history ORDER BY date"),
      db.all<{ key: string; value: string }>("SELECT key, value FROM settings"),
    ]);
  return c.json({
    accounts, recurring, loans, oneoffs, trades, cards, card_txs, categories, transactions, prices, price_history,
    settings: Object.fromEntries(settingsRows.map((s) => [s.key, s.value])),
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
    const names = cols.map((x) => x.name);
    const info = await db.run(
      `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")}) RETURNING id`,
      ...cols.map((col) => b[col.name] ?? col.default ?? null),
    );
    return c.json({ id: info.id });
  });
  api.put(`/${route}/:id`, async (c) => {
    const b = await c.req.json();
    const names = cols.map((x) => x.name).filter((n) => b[n] !== undefined);
    if (!names.length) return c.json({ error: "boş" }, 400);
    await db.run(
      `UPDATE ${table} SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=?`,
      ...names.map((n) => b[n]), c.req.param("id"),
    );
    return c.json({ ok: true });
  });
  api.delete(`/${route}/:id`, async (c) => {
    await db.run(`DELETE FROM ${table} WHERE id=?`, c.req.param("id"));
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
  const id = await db.tx(async (t) => {
    const info = await t.run(
      "INSERT INTO transactions (date,name,amount,category_id,account_id) VALUES (?,?,?,?,?) RETURNING id",
      b.date, b.name, b.amount, b.category_id ?? null, b.account_id ?? null,
    );
    if (b.account_id != null) {
      await t.run("UPDATE accounts SET balance = balance + ? WHERE id=?", b.amount, b.account_id);
    }
    return info.id;
  });
  return c.json({ id });
});
api.delete("/transactions/:id", async (c) => {
  await db.tx(async (t) => {
    const row = await t.get<{ amount: number; account_id: number | null }>(
      "SELECT amount, account_id FROM transactions WHERE id=?", c.req.param("id"),
    );
    await t.run("DELETE FROM transactions WHERE id=?", c.req.param("id"));
    if (row?.account_id != null) {
      await t.run("UPDATE accounts SET balance = balance - ? WHERE id=?", row.amount, row.account_id);
    }
  });
  return c.json({ ok: true });
});

/* ---- fiyatlar ---- */
api.post("/prices/refresh", async (c) => c.json(await refreshAll()));
api.put("/prices", async (c) => {
  const { symbol, asset_type, price, currency } = await c.req.json();
  if (!symbol || !asset_type || typeof price !== "number") return c.json({ error: "eksik alan" }, 400);
  const ccy = currency === "USD" ? "USD" : "TRY"; // elle girilen fiyat sembolün biriminde
  await db.run(
    `INSERT INTO prices (symbol, asset_type, price, source, updated_at, currency) VALUES (?,?,?,'manual',?,?)
     ON CONFLICT (symbol, asset_type) DO UPDATE SET price=excluded.price, source='manual', updated_at=excluded.updated_at, currency=excluded.currency`,
    symbol, asset_type, price, nowLocal(), ccy,
  );
  await db.run(
    `INSERT INTO price_history (symbol, asset_type, date, price, currency) VALUES (?,?,?,?,?)
     ON CONFLICT (symbol, asset_type, date) DO UPDATE SET price=excluded.price, currency=excluded.currency`,
    symbol, asset_type, todayLocal(), price, ccy,
  );
  return c.json({ ok: true });
});
/* elle girilen (veya eski) fiyatı sil: sonraki tazelemede otomatik yeniden dolar */
api.delete("/prices/:asset_type/:symbol", async (c) => {
  await db.run(
    "DELETE FROM prices WHERE asset_type=? AND symbol=?",
    c.req.param("asset_type"),
    decodeURIComponent(c.req.param("symbol")),
  );
  return c.json({ ok: true });
});

/* ---- ayarlar ---- */
api.put("/settings", async (c) => {
  const b = (await c.req.json()) as Record<string, string>;
  for (const [k, v] of Object.entries(b)) {
    await db.run("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value", k, String(v));
  }
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
