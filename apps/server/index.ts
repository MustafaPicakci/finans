import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import cron from "node-cron";
import { db } from "./db.js";
import { refreshAll } from "./prices.js";

const app = new Hono();
const api = new Hono();

/* ---- tek seferde tüm veri ---- */
api.get("/all", (c) =>
  c.json({
    accounts: db.prepare("SELECT * FROM accounts ORDER BY id").all(),
    recurring: db.prepare("SELECT * FROM recurring ORDER BY day, id").all(),
    loans: db.prepare("SELECT * FROM loans ORDER BY id").all(),
    oneoffs: db.prepare("SELECT * FROM oneoffs ORDER BY date").all(),
    trades: db.prepare("SELECT * FROM trades ORDER BY date, id").all(),
    cards: db.prepare("SELECT * FROM cards ORDER BY id").all(),
    card_txs: db.prepare("SELECT * FROM card_txs ORDER BY date, id").all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY name").all(),
    transactions: db.prepare("SELECT * FROM transactions ORDER BY date DESC, id DESC").all(),
    prices: db.prepare("SELECT * FROM prices").all(),
    price_history: db.prepare("SELECT * FROM price_history ORDER BY date").all(),
    settings: Object.fromEntries(
      (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((s) => [s.key, s.value]),
    ),
  }),
);

/* ---- generic CRUD ---- */
type Col = { name: string; required?: boolean };
function crud(route: string, table: string, cols: Col[]) {
  api.post(`/${route}`, async (c) => {
    const b = await c.req.json();
    for (const col of cols) if (col.required && (b[col.name] === undefined || b[col.name] === "")) {
      return c.json({ error: `${col.name} zorunlu` }, 400);
    }
    const names = cols.map((x) => x.name);
    const info = db
      .prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
      .run(...names.map((n) => b[n] ?? null));
    return c.json({ id: info.lastInsertRowid });
  });
  api.put(`/${route}/:id`, async (c) => {
    const b = await c.req.json();
    const names = cols.map((x) => x.name).filter((n) => b[n] !== undefined);
    if (!names.length) return c.json({ error: "boş" }, 400);
    db.prepare(`UPDATE ${table} SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=?`)
      .run(...names.map((n) => b[n]), c.req.param("id"));
    return c.json({ ok: true });
  });
  api.delete(`/${route}/:id`, (c) => {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(c.req.param("id"));
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
crud("transactions", "transactions", [
  { name: "date", required: true }, { name: "name", required: true }, { name: "amount", required: true },
  { name: "category_id" }, { name: "account_id" },
]);

/* ---- fiyatlar ---- */
api.post("/prices/refresh", async (c) => c.json(await refreshAll()));
api.put("/prices", async (c) => {
  const { symbol, asset_type, price } = await c.req.json();
  if (!symbol || !asset_type || typeof price !== "number") return c.json({ error: "eksik alan" }, 400);
  db.prepare(
    `INSERT INTO prices (symbol, asset_type, price, source, updated_at) VALUES (?,?,?,'manual',datetime('now','localtime'))
     ON CONFLICT(symbol, asset_type) DO UPDATE SET price=excluded.price, source='manual', updated_at=excluded.updated_at`,
  ).run(symbol, asset_type, price);
  db.prepare(
    `INSERT INTO price_history (symbol, asset_type, date, price) VALUES (?,?,date('now','localtime'),?)
     ON CONFLICT(symbol, asset_type, date) DO UPDATE SET price=excluded.price`,
  ).run(symbol, asset_type, price);
  return c.json({ ok: true });
});
/* elle girilen (veya eski) fiyatı sil: sonraki tazelemede otomatik yeniden dolar */
api.delete("/prices/:asset_type/:symbol", (c) => {
  db.prepare("DELETE FROM prices WHERE asset_type=? AND symbol=?").run(
    c.req.param("asset_type"),
    decodeURIComponent(c.req.param("symbol")),
  );
  return c.json({ ok: true });
});

/* ---- ayarlar ---- */
api.put("/settings", async (c) => {
  const b = (await c.req.json()) as Record<string, string>;
  const up = db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const [k, v] of Object.entries(b)) up.run(k, String(v));
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
serve({ fetch: app.fetch, port }, () => console.log(`finans → http://localhost:${port}`));
