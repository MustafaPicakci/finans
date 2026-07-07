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
  asset_type TEXT NOT NULL CHECK (asset_type IN ('BIST','FON','ALTIN','DOVIZ','KRIPTO')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('ALIŞ','SATIŞ')),
  qty REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  price REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL,
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
`);

/* ---- migrasyonlar (var olan db'ye kolon ekle) ---- */
const recCols = (db.prepare("PRAGMA table_info(recurring)").all() as { name: string }[]).map((c) => c.name);
if (!recCols.includes("from_month")) db.exec("ALTER TABLE recurring ADD COLUMN from_month TEXT;");
if (!recCols.includes("to_month")) db.exec("ALTER TABLE recurring ADD COLUMN to_month TEXT;");
