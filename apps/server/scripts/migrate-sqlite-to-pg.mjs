/**
 * Faz 5.0 — tek seferlik veri taşıma: SQLite (data/finans.db) → PostgreSQL (DATABASE_URL).
 * NOT (Faz 9): yeni şemayla uyumsuz — recurring.amount kolonu artık yok (tutar recurring_amounts
 * zaman çizelgesinde); eski SQLite verisiyle recurring kopyası başarısız olur. Script tarihsel
 * amaçla duruyor; ihtiyaç olursa amount'lar elle recurring_amounts'a taşınmalı.
 * Id'ler korunur, identity sequence'ları max(id)+1'e çekilir, satır sayıları karşılaştırılır.
 * Yeniden çalıştırılabilir: hedef tablolar TRUNCATE ... RESTART IDENTITY CASCADE ile temizlenir.
 *
 * Çalıştırma (apps/server dizininden):
 *   DATABASE_URL=postgresql://postgres:1@localhost:5432/finans \
 *   node --experimental-sqlite scripts/migrate-sqlite-to-pg.mjs [../../data/finans.db]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL gerekli"); process.exit(1); }
const sqlitePath = process.argv[2] || path.join(import.meta.dirname, "../../../data/finans.db");

/* FK-güvenli sıra: referans verilen tablolar önce. id taşıyanlar sequence reset alır. */
const TABLES = [
  { name: "accounts", id: true },
  { name: "categories", id: true },
  { name: "cards", id: true },
  { name: "recurring", id: true },
  { name: "loans", id: true },
  { name: "oneoffs", id: true },
  { name: "trades", id: true },
  { name: "card_txs", id: true },
  { name: "transactions", id: true },
  { name: "prices", id: false },
  { name: "price_history", id: false },
  { name: "settings", id: false },
];

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  // Şemanın var olduğundan emin ol (server initDb ile aynı yolu kullanır; burada da güvenli olsun)
  const { initDb } = await import("../db.ts").catch(() => ({ initDb: null }));
  if (initDb) await initDb();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ters sırayla değil; CASCADE ile tek seferde temizle
    await client.query(`TRUNCATE ${TABLES.map((t) => t.name).join(", ")} RESTART IDENTITY CASCADE`);

    const report = [];
    for (const { name } of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${name}`).all();
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const colList = cols.join(",");
        for (const row of rows) {
          const ph = cols.map((_, i) => `$${i + 1}`).join(",");
          await client.query(`INSERT INTO ${name} (${colList}) VALUES (${ph})`, cols.map((c) => row[c]));
        }
      }
      report.push({ table: name, sqlite: rows.length });
    }

    // identity sequence'larını max(id)+1'e çek (açık id yazdığımız için)
    for (const { name, id } of TABLES) {
      if (!id) continue;
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${name}','id'), COALESCE((SELECT MAX(id) FROM ${name}), 1), (SELECT COUNT(*) FROM ${name}) > 0)`,
      );
    }

    await client.query("COMMIT");

    // doğrulama: Postgres satır sayıları
    console.log("tablo".padEnd(16), "sqlite".padStart(8), "postgres".padStart(10), " durum");
    let allOk = true;
    for (const r of report) {
      const pgCount = Number((await pool.query(`SELECT COUNT(*)::int c FROM ${r.table}`)).rows[0].c);
      const ok = pgCount === r.sqlite;
      if (!ok) allOk = false;
      console.log(r.table.padEnd(16), String(r.sqlite).padStart(8), String(pgCount).padStart(10), ok ? " ✓" : " ✗ UYUŞMUYOR");
    }
    console.log(allOk ? "\nTüm satır sayıları eşleşti ✓" : "\nBAZI TABLOLAR UYUŞMUYOR ✗");
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Taşıma hatası, geri alındı:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main();
