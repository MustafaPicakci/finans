import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/* import.meta.dirname yerine process.cwd() kullanılmıyor: server hangi dizinden
   başlatılırsa başlatılsın (pnpm --filter, Docker, doğrudan tsx) hep aynı
   repo-kökü data/ klasörünü bulsun — DATA_DIR ortam değişkeni (Docker'da /data) önceliklidir. */
const dir = process.env.DATA_DIR || path.join(import.meta.dirname, "../../data");
fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, "finans.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  from_month TEXT,   -- 'YYYY-MM' dahil, NULL = başlangıçsız
  to_month TEXT      -- 'YYYY-MM' dahil, NULL = süresiz
);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  first_date TEXT NOT NULL,
  total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oneoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('BIST','FON','ALTIN','DOVIZ','KRIPTO','ETF')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('ALIŞ','SATIŞ')),
  qty REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY'   -- işlemin doğal para birimi (TRY/USD)
);
CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  price REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',   -- saklanan fiyatın birimi (native)
  PRIMARY KEY (symbol, asset_type)
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  limit_amount REAL NOT NULL DEFAULT 0,
  statement_day INTEGER NOT NULL CHECK (statement_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
);
CREATE TABLE IF NOT EXISTS card_txs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  installments INTEGER NOT NULL DEFAULT 1 CHECK (installments >= 1)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  color TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  date TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',   -- o günkü fiyatın birimi (native)
  PRIMARY KEY (symbol, asset_type, date)
);
`);

/* ---- migrasyonlar (var olan db'ye kolon ekle) ---- */
const recCols = (db.prepare("PRAGMA table_info(recurring)").all() as { name: string }[]).map((c) => c.name);
if (!recCols.includes("from_month")) db.exec("ALTER TABLE recurring ADD COLUMN from_month TEXT;");
if (!recCols.includes("to_month")) db.exec("ALTER TABLE recurring ADD COLUMN to_month TEXT;");

/* trades.asset_type CHECK kısıtına 'ETF' eklendi (yeni varlık türü: yurt dışı borsa ETF'i).
   SQLite CHECK kısıtını ALTER ile değiştiremez; eski kısıt hâlâ 'ETF' içermiyorsa tabloyu
   yeniden oluşturup veriyi taşı (id'ler ve AUTOINCREMENT sırası korunur). */
const tradesSchema = (
  db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'").get() as { sql: string } | undefined
)?.sql;
if (tradesSchema && !tradesSchema.includes("ETF")) {
  db.exec(`
    ALTER TABLE trades RENAME TO trades_old_pre_etf;
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      asset_type TEXT NOT NULL CHECK (asset_type IN ('BIST','FON','ALTIN','DOVIZ','KRIPTO','ETF')),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('ALIŞ','SATIŞ')),
      qty REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0
    );
    INSERT INTO trades SELECT id, date, asset_type, symbol, side, qty, price, fee FROM trades_old_pre_etf;
    DROP TABLE trades_old_pre_etf;
  `);
}

/* Çok para birimi (TRY + USD): trades/prices/price_history'ye currency kolonu.
   DEFAULT 'TRY' → mevcut satırlar TRY olur, davranış birebir korunur (portföyde USD varlık yoktu).
   NOT: ETF tablo-yeniden-kurmasından SONRA çalışır ki yeniden kurulan trades da kolonu alsın. */
const tradeCols = (db.prepare("PRAGMA table_info(trades)").all() as { name: string }[]).map((c) => c.name);
if (!tradeCols.includes("currency")) db.exec("ALTER TABLE trades ADD COLUMN currency TEXT NOT NULL DEFAULT 'TRY';");
const priceCols = (db.prepare("PRAGMA table_info(prices)").all() as { name: string }[]).map((c) => c.name);
if (!priceCols.includes("currency")) db.exec("ALTER TABLE prices ADD COLUMN currency TEXT NOT NULL DEFAULT 'TRY';");
const phCols = (db.prepare("PRAGMA table_info(price_history)").all() as { name: string }[]).map((c) => c.name);
if (!phCols.includes("currency")) db.exec("ALTER TABLE price_history ADD COLUMN currency TEXT NOT NULL DEFAULT 'TRY';");
