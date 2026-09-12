/**
 * Prod (Neon) → yerel Postgres veri kopyası.
 *
 * Neden pg_dump değil: Neon PG18, yerel Docker container PG15 — pg_dump ancak kendinden ESKİ
 * sunucuyu dökebilir, yani 18'lik bir dump için 18'lik istemci gerekirdi (yeni imaj/kurulum).
 * `pg` sürücüsü protokol seviyesinde konuşur, sürüm farkını umursamaz.
 *
 * Şema hedefte initDb() ile kurulur (prod'un şeması kopyalanmaz — kod neyi bekliyorsa o).
 * Veri tek transaction içinde taşınır: hata olursa yerel veritabanı olduğu gibi kalır.
 *
 * Çalıştırma (apps/server dizininden):
 *   read -rs "PROD_URL?Neon URL: "; export PROD_URL
 *   pnpm exec tsx scripts/prod-to-local.mjs
 *   unset PROD_URL
 *
 * Hedef = .env'deki DATABASE_URL. Güvenlik kilidi: localhost değilse çalışmaz (prod'un üstüne
 * yazmak tek bir yanlış env ile mümkün olurdu). Zorlamak için: ALLOW_REMOTE_TARGET=1.
 */
import "dotenv/config";
import pg from "pg";

const SOURCE_URL = process.env.PROD_URL || process.env.SOURCE_URL;
const TARGET_URL = process.env.DATABASE_URL;

if (!SOURCE_URL) { console.error("PROD_URL gerekli (kaynak: Neon bağlantı dizesi)"); process.exit(1); }
if (!TARGET_URL) { console.error("DATABASE_URL gerekli (hedef: yerel Postgres — apps/server/.env)"); process.exit(1); }
if (SOURCE_URL === TARGET_URL) { console.error("Kaynak ve hedef aynı; iptal."); process.exit(1); }

const targetIsLocal = /@(localhost|127\.0\.0\.1|db)[:/]/.test(TARGET_URL);
if (!targetIsLocal && process.env.ALLOW_REMOTE_TARGET !== "1") {
  console.error("Hedef DATABASE_URL yerel görünmüyor — iptal (prod'un üstüne yazmayı engelliyorum).");
  console.error("Gerçekten uzak hedefe yazacaksan: ALLOW_REMOTE_TARGET=1");
  process.exit(1);
}

const ssl = (url) => (/@(localhost|127\.0\.0\.1|db)[:/]/.test(url) ? undefined : { rejectUnauthorized: false });
const source = new pg.Pool({ connectionString: SOURCE_URL, ssl: ssl(SOURCE_URL) });

const BATCH = 500; // tek INSERT'te taşınan satır (61k satırlık price_history tek tek gitmesin)

const tablesOf = async (client) =>
  (await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  )).rows.map((r) => r.table_name);

const COLS_SQL = `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`;

const srcColumns = async (table) =>
  (await source.query(COLS_SQL, [table])).rows.map((r) => r.column_name);
const tgtColumns = async (t, table) =>
  (await t.all(COLS_SQL, table)).map((r) => r.column_name);

/* Tablo adları her zaman public ile nitelenir: iki uçta search_path farklı olabilir
   (yönetilen Postgres'te varsayılan olmayabiliyor) ve o zaman tablo "yok" görünür. */
const q = (table) => `public."${table}"`;

/** Hata mesajına hangi taraf/adım olduğunu yazar — "relation X does not exist" tek başına hangi uçta olduğunu söylemiyor. */
const step = async (label, fn) => {
  try { return await fn(); } catch (e) { e.message = `[${label}] ${e.message}`; throw e; }
};

async function main() {
  const srcInfo = (await source.query(
    "select version() as v, current_database() as db, current_schemas(true) as sp")).rows[0];
  console.log(`kaynak : ${srcInfo.v.split(",")[0]}`);
  console.log(`         db=${srcInfo.db} search_path=${srcInfo.sp}`);

  // Hedef şemayı kodun kendi initDb'si kurar (eksik tablo/kolon kalmasın).
  const { initDb, db } = await import("../db.ts");
  await initDb();
  const tgtInfo = await db.get(
    "select version() as v, current_database() as db, current_schemas(true) as sp");
  console.log(`hedef  : ${tgtInfo.v.split(",")[0]}`);
  console.log(`         db=${tgtInfo.db} search_path=${tgtInfo.sp}\n`);

  const srcTables = await tablesOf(source);
  const report = [];
  const skipped = [];

  await db.tx(async (t) => {
    const tgtTables = (await t.all(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`,
    )).map((r) => r.table_name);

    const copy = srcTables.filter((x) => tgtTables.includes(x));
    for (const x of srcTables) if (!tgtTables.includes(x)) skipped.push(`${x} (hedefte yok)`);
    console.log(`tablo: kaynak ${srcTables.length}, hedef ${tgtTables.length}, kopyalanacak ${copy.length}`);
    if (!copy.length) throw new Error("Ortak tablo yok — kaynakta public şeması boş olabilir.");

    // FK sırasıyla uğraşmamak için tetikleyiciler bu oturumda kapatılır (yerel kullanıcı superuser).
    await step("hedef: session_replication_role", () => t.run("SET session_replication_role = replica"));
    await step("hedef: TRUNCATE", () => t.run(`TRUNCATE ${copy.map(q).join(", ")} RESTART IDENTITY CASCADE`));

    for (const table of copy) {
      const srcCols = await step(`kaynak: ${table} kolonları`, () => srcColumns(table));
      const tgtCols = await step(`hedef: ${table} kolonları`, () => tgtColumns(t, table));
      const cols = srcCols.filter((c) => tgtCols.includes(c));
      for (const c of srcCols) if (!tgtCols.includes(c)) skipped.push(`${table}.${c} (kolon hedefte yok)`);
      if (!cols.length) continue;

      const colList = cols.map((c) => `"${c}"`).join(",");
      const rows = await step(`kaynak: ${table} SELECT`, async () =>
        (await source.query(`SELECT ${colList} FROM ${q(table)}`)).rows);

      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const params = [];
        const values = chunk
          .map((row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(",")})`)
          .join(",");
        await step(`hedef: ${table} INSERT (satır ${i + 1}…)`, () =>
          t.run(`INSERT INTO ${q(table)} (${colList}) VALUES ${values}`, ...params));
      }

      // Identity sequence'ı max(id)'ye çek — yoksa ilk yeni kayıt "duplicate key" alır.
      if (cols.includes("id")) {
        await step(`hedef: ${table} sequence`, () => t.run(
          `SELECT setval(pg_get_serial_sequence('public.${table}','id'),
                         GREATEST((SELECT COALESCE(MAX(id),0) FROM ${q(table)}), 1))`,
        ));
      }

      const n = (await t.get(`SELECT count(*)::int AS n FROM ${q(table)}`)).n;
      report.push({ tablo: table, kaynak: rows.length, hedef: n });
    }
  });

  console.table(report.filter((r) => r.kaynak || r.hedef));
  const bozuk = report.filter((r) => r.kaynak !== r.hedef);
  if (skipped.length) console.log("\nAtlananlar:\n  " + skipped.join("\n  "));
  if (bozuk.length) { console.error("\nSATIR SAYISI TUTMADI:", bozuk); process.exit(1); }
  console.log("\nTamam — yerel veritabanı prod'un kopyası.");
}

main()
  .catch((e) => { console.error("\nHATA:", e.message); process.exit(1); })
  .finally(async () => { await source.end(); process.exit(0); });
