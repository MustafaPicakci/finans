/* Mobil görünüm denetimi için sahte API + statik sunucu.
   Veritabanı GEREKMEZ: apps/web/dist'i sunar ve /api uçlarına gerçekçi sabit veri döner.
   Amaç yalnız YERLEŞİMİ görmek (dar ekranda taşma/kayma), veri doğruluğu değil. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const today = new Date();
const d = (offset) => {
  const x = new Date(today); x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};

const accounts = [
  { id: 1, name: "Garanti Vadesiz", balance: 48250.75, kind: "banka", last_recon_date: null, last_recon_balance: null },
  { id: 2, name: "İş Bankası Maaş", balance: 12980.4, kind: "banka", last_recon_date: d(-40), last_recon_balance: 12000 },
  { id: 3, name: "Nakit Cüzdan", balance: 1750, kind: "nakit", last_recon_date: d(-3), last_recon_balance: 1750 },
  { id: 4, name: "Midas Yatırım", balance: 8400.2, kind: "araci", last_recon_date: null, last_recon_balance: null },
];
const categories = [
  { id: 1, name: "Market", kind: "expense", color: null },
  { id: 2, name: "Ulaşım", kind: "expense", color: null },
  { id: 3, name: "Maaş", kind: "income", color: null },
  { id: 4, name: "Faturalar", kind: "expense", color: null },
];
const cards = [
  { id: 1, name: "Akbank Axess", limit_amount: 60000, statement_day: 25, due_day: 10, pay_account_id: 1 },
  { id: 2, name: "Garanti Bonus", limit_amount: 35000, statement_day: 15, due_day: 3, pay_account_id: null },
];
const card_txs = [
  { id: 1, card_id: 1, date: d(-12), name: "Teknoloji mağazası", amount: 18400, installments: 6 },
  { id: 2, card_id: 1, date: d(-5), name: "Market alışverişi", amount: 1240.5, installments: 1 },
  { id: 3, card_id: 2, date: d(-20), name: "Uçak bileti", amount: 7850, installments: 3 },
];
const trades = [
  { id: 1, date: d(-120), asset_type: "BIST", symbol: "ASELS", side: "ALIŞ", qty: 200, price: 62.4, fee: 12, currency: "TRY", account_id: 4, portfolio_id: 1 },
  { id: 2, date: d(-90), asset_type: "FON", symbol: "TP2", side: "ALIŞ", qty: 30000, price: 1.82, fee: 0, currency: "TRY", account_id: 1, portfolio_id: null },
  { id: 3, date: d(-45), asset_type: "KRIPTO", symbol: "BTC", side: "ALIŞ", qty: 0.05, price: 93500, fee: 8, currency: "USD", account_id: null, portfolio_id: 2 },
  { id: 4, date: d(-30), asset_type: "ETF", symbol: "VOO", side: "ALIŞ", qty: 3, price: 545.2, fee: 1, currency: "USD", account_id: null, portfolio_id: 2 },
  { id: 5, date: d(-10), asset_type: "BIST", symbol: "ASELS", side: "SATIŞ", qty: 50, price: 78.9, fee: 6, currency: "TRY", account_id: 4, portfolio_id: 1 },
];
const prices = [
  { symbol: "ASELS", asset_type: "BIST", price: 81.25, source: "auto", updated_at: `${d(0)} 10:15:00`, currency: "TRY" },
  { symbol: "TP2", asset_type: "FON", price: 2.04, source: "auto", updated_at: `${d(0)} 09:00:00`, currency: "TRY" },
  { symbol: "BTC", asset_type: "KRIPTO", price: 98750, source: "auto", updated_at: `${d(0)} 10:15:00`, currency: "USD" },
  { symbol: "VOO", asset_type: "ETF", price: 561.8, source: "manual", updated_at: `${d(0)} 10:15:00`, currency: "USD" },
];
const price_history = [];
for (let i = 120; i >= 0; i -= 2) {
  price_history.push({ symbol: "ASELS", asset_type: "BIST", date: d(-i), price: 62 + (120 - i) * 0.16, currency: "TRY" });
  price_history.push({ symbol: "TP2", asset_type: "FON", date: d(-i), price: 1.82 + (120 - i) * 0.0018, currency: "TRY" });
}
const transactions = [
  { id: 1, date: d(-1), name: "Migros market alışverişi", amount: -1247.9, category_id: 1, account_id: 1 },
  { id: 2, date: d(-2), name: "Metro ulaşım", amount: -180, category_id: 2, account_id: 3 },
  { id: 3, date: d(-5), name: "Ağustos maaşı", amount: 68500, category_id: 3, account_id: 2 },
  { id: 4, date: d(-8), name: "Elektrik faturası", amount: -1890.25, category_id: 4, account_id: 1 },
  { id: 5, date: d(-15), name: "Akbank Axess ekstresi", amount: -12480, category_id: null, account_id: 1 },
];
const recurring = [
  { id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null, account_id: 2, card_id: null, category_id: 3, auto: true },
  { id: 2, kind: "expense", name: "Kira", day: 5, from_month: null, to_month: null, account_id: 1, card_id: null, category_id: null, auto: false },
  { id: 3, kind: "expense", name: "Netflix aboneliği", day: 20, from_month: null, to_month: null, account_id: null, card_id: 1, category_id: null, auto: true },
];
const all = {
  accounts, categories, cards, card_txs, trades, prices, price_history, transactions, recurring,
  recurring_amounts: [
    { recurring_id: 1, from_month: "0000-01", amount: 68500 },
    { recurring_id: 2, from_month: "0000-01", amount: 24000 },
    { recurring_id: 3, from_month: "0000-01", amount: 229.99 },
  ],
  loans: [{ id: 1, name: "Taşıt kredisi", amount: 9450.3, first_date: d(-200), total: 36 }],
  oneoffs: [{ id: 1, date: d(12), name: "Vergi ödemesi", amount: -8400 }],
  portfolios: [{ id: 1, name: "Alfa Portföy", note: null }, { id: 2, name: "Emeklilik", note: null }],
  deposits: [{ id: 1, name: "32 gün vadeli", principal: 50000, rate: 42.5, open_date: d(-20), term_days: 32, withholding: 15, account_id: 1 }],
  recurring_realized: [], statement_payments: [],
  account_entries: [
    { id: 1, account_id: 1, date: d(-1), amount: -1247.9, kind: "islem", source_table: "transactions", source_id: 1, note: "Migros market alışverişi", created_at: `${d(-1)} 19:00:00` },
    { id: 2, account_id: 1, date: d(-8), amount: -1890.25, kind: "islem", source_table: "transactions", source_id: 4, note: "Elektrik faturası", created_at: `${d(-8)} 12:00:00` },
    { id: 3, account_id: 1, date: d(-200), amount: 60000, kind: "acilis", source_table: null, source_id: null, note: "Açılış bakiyesi", created_at: `${d(-200)} 09:00:00` },
  ],
  transfers: [{ id: 1, date: d(-6), from_account_id: 1, to_account_id: 3, amount: 2000, note: "ATM çekimi" }],
  settings: { fx_usd_try: "41.85", horizon: "6", cash_funds: "" },
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/auth/me") return json({ user: { id: 1, email: "demo@finans.local" } });
  if (url.pathname === "/api/all") return json(all);
  if (url.pathname === "/api/ai/status") return json({ enabled: true, model: "gemini/gemini-3.6-flash (2 anahtar)" });
  if (url.pathname === "/api/ai/history") return json({ plans: [] });
  if (url.pathname.startsWith("/api/")) return json({ ok: true });
  try {
    const p = url.pathname === "/" ? "/index.html" : url.pathname;
    const buf = await readFile(join(DIST, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    const buf = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "content-type": "text/html" });
    res.end(buf);
  }
}).listen(8791, () => console.log("stub → http://localhost:8791"));
