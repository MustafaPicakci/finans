/**
 * `pnpm prod-kopya` — prod (Neon) verisini başka bir Postgres'e kopyalar: Docker'daki yerel
 * container'a (yeni veritabanı) ya da uzak bir adrese (Supabase'e taşıma). İşi prod-to-local.mjs
 * yapar; bu dosya onun etrafındaki soruları, şema seçimini ve güvenlik kilitlerini yönetir.
 *
 * Sorar: hedef türü → yerelde veritabanı adı (boş = finans_prod_YYYYMMDD) / uzakta adres →
 * Neon adresi. Adresler ekrana basılmaz. Hedef tablo içeriyorsa üzerine yazmak için onay ister
 * (ortak tablolar BOŞALTILIR — yerel `finans` senin şifreli verindir). Uzak hedefte veritabanı
 * oluşturulmaz; Supabase'in `anon`/`authenticated` yetkileri kopya sonrası geri alınır.
 *
 * ŞEMA SEÇİMİ — neden gerekli: prod-to-local hedef şemayı `initDb()` ile kurar ve yalnız iki
 * uçta da bulunan kolonları taşır. Şu anki kodun initDb'si E2EE şemasını kurar (tutar/ad
 * kolonları yok, `enc` var); prod henüz düz şemadaysa tutarlar ve adlar "kolon hedefte yok"
 * diye atlanırdı. Bu yüzden prod'un şemasına bakılır ve ona uyan commit'in db.ts'i kullanılır:
 *   accounts.enc var      → çalışma ağacındaki kod (prod E2EE'ye geçmiş)
 *   accounts.balance var  → b2c5f39 (Faz 41.6 — bakiye kolonu, düz şema)
 *   ikisi de yok          → 948fdbf (Faz 42.1 = pre-e2ee — bakiye defterden, düz şema)
 * Eski db.ts'ler `git show` ile apps/server altına geçici bir klasöre çıkarılır (node_modules
 * oradan çözülsün) ve iş bitince silinir.
 *
 * Yerel bağlantı: YEREL_PG_URL (ör. postgres://postgres:parola@localhost:5432) verilmezse
 * Docker'daki `postgres` container'ının parolası `docker inspect` ile okunur.
 * Ev ağı giden 5432'yi engelliyor → Neon'a bağlanmak için hotspot gerekir.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import pg from "pg";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SERVER, "..", "..");
const GECICI = join(SERVER, ".prod-kopya");
const CONTAINER = "postgres";

const soru = (metin, { gizli = false } = {}) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    // Gizli girdide yalnız sorunun kendisi basılır, yazılan karakterler değil.
    if (gizli) rl._writeToOutput = (s) => { if (s.includes(metin)) rl.output.write(metin); };
    rl.question(metin, (cevap) => {
      rl.close();
      if (gizli) process.stdout.write("\n");
      res(cevap.trim());
    });
  });

const yerelTaban = () => {
  if (process.env.YEREL_PG_URL) return process.env.YEREL_PG_URL.replace(/\/+$/, "");
  const env = execFileSync("docker", ["inspect", CONTAINER, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], { encoding: "utf8" });
  const pw = env.split("\n").find((l) => l.startsWith("POSTGRES_PASSWORD="))?.slice("POSTGRES_PASSWORD=".length);
  if (!pw) throw new Error(`'${CONTAINER}' container'ında POSTGRES_PASSWORD bulunamadı — YEREL_PG_URL ver`);
  return `postgres://postgres:${encodeURIComponent(pw)}@localhost:5432`;
};

const yerelMi = (url) => /@(localhost|127\.0\.0\.1|db)[:/]/.test(url); // prod-to-local'ın SSL kuralı
const istemci = (url) =>
  new pg.Client({ connectionString: url, ssl: yerelMi(url) ? undefined : { rejectUnauthorized: false } });

const tekSorgu = async (url, sql, params = []) => {
  const c = istemci(url);
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

const tabloSayisi = async (url) => (await tekSorgu(url,
  "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"))[0].n;

const host = (url) => { try { return new URL(url).hostname; } catch { return "?"; } };

/** Prod'un şemasına uyan db.ts'in kaynağı: null = çalışma ağacı, aksi hâlde commit. */
async function semaKaynagi(prodUrl) {
  const c = istemci(prodUrl);
  await c.connect();
  try {
    const kolonlar = new Set((await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts'`,
    )).rows.map((r) => r.column_name));
    if (kolonlar.has("enc") || !kolonlar.size) return { commit: null, ad: "çalışma ağacı (E2EE şeması)" };
    if (kolonlar.has("balance")) return { commit: "b2c5f39", ad: "b2c5f39 — Faz 41.6, düz şema + accounts.balance" };
    return { commit: "948fdbf", ad: "948fdbf — Faz 42.1 (pre-e2ee), düz şema" };
  } finally { await c.end(); }
}

/** Yerel Docker: adı sorar (boş = finans_prod_YYYYMMDD), yoksa oluşturulacak diye işaretler. */
async function yerelHedef() {
  const tarih = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const varsayilan = `finans_prod_${tarih}`;
  const db = (await soru(`Hedef veritabanı adı [${varsayilan}]: `)) || varsayilan;
  if (!/^[a-z_][a-z0-9_]*$/.test(db)) throw new Error(`Geçersiz ad: '${db}' (küçük harf, rakam, alt çizgi)`);

  const taban = yerelTaban();
  const var_ = (await tekSorgu(`${taban}/postgres`, "SELECT 1 FROM pg_database WHERE datname=$1", [db])).length > 0;
  if (var_) {
    const n = await tabloSayisi(`${taban}/${db}`);
    if (n > 0) {
      console.log(`'${db}' zaten var ve ${n} tablo içeriyor — kopyalama ortak tabloları BOŞALTIP üzerine yazar.`);
      if ((await soru("Devam etmek için adı yeniden yaz: ")) !== db) throw new Error("İptal.");
    }
  }
  return {
    url: `${taban}/${db}`,
    ad: db,
    hazirla: async () => {
      if (var_) return;
      await tekSorgu(`${taban}/postgres`, `CREATE DATABASE "${db}"`);
      console.log(`'${db}' oluşturuldu.`);
    },
    // Yeni açtığımız veritabanını yarım şemayla bırakma.
    geriAl: async () => {
      if (var_) return;
      await tekSorgu(`${taban}/postgres`, `DROP DATABASE "${db}"`);
      console.log(`'${db}' geri silindi.`);
    },
  };
}

/** Uzak Postgres (ör. Supabase): adres sorulur, veritabanı oluşturulmaz — verilen veritabanına yazılır. */
async function uzakHedef() {
  const url = await soru("Hedef Postgres URL: ", { gizli: true });
  if (!url) throw new Error("Hedef URL boş — iptal.");
  const n = await tabloSayisi(url);
  if (n > 0) {
    console.log(`${host(url)} zaten ${n} tablo içeriyor — kopyalama ortak tabloları BOŞALTIP üzerine yazar.`);
    if ((await soru("Devam etmek için 'üzerine yaz' yaz: ")) !== "üzerine yaz") throw new Error("İptal.");
  }
  return { url, ad: host(url), uzak: true, hazirla: async () => {}, geriAl: async () => {} };
}

/**
 * Supabase'te `anon`/`authenticated` rolleri ve `public`'e otomatik GRANT vardır: Data API açılırsa
 * proje adresi + anon anahtarı tabloları REST'ten okutur (tablolarımızda RLS yok). Uygulama yalnız
 * `postgres` rolüyle bağlanır, bu yetkiler hiçbir işe yaramaz — geri alınır, ileride initDb'nin
 * açacağı tablolar için varsayılan yetki de kaldırılır. Roller yoksa (düz Postgres) hiçbir şey yapılmaz.
 */
async function supabaseYetkileriniKapat(url) {
  const roller = (await tekSorgu(url,
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).map((r) => `"${r.rolname}"`);
  if (!roller.length) return;
  const kime = roller.join(", ");
  for (const sql of [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${kime}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${kime}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${kime}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${kime}`,
  ]) await tekSorgu(url, sql);
  console.log(`yetki  : ${roller.join(", ")} rollerinin public tablolarına erişimi kaldırıldı`);
}

async function main() {
  const secim = await soru("Hedef: [1] yerel Docker  [2] uzak Postgres adresi (Supabase vb.)  [1]: ");
  if (!["", "1", "2"].includes(secim)) throw new Error(`Geçersiz seçim: '${secim}'`);
  const hedef = secim === "2" ? await uzakHedef() : await yerelHedef();

  const prodUrl = await soru("Neon URL: ", { gizli: true });
  if (!prodUrl) throw new Error("Neon URL boş — iptal.");
  if (host(prodUrl) === host(hedef.url) && prodUrl.split("/").pop() === hedef.url.split("/").pop()) {
    throw new Error("Kaynak ve hedef aynı veritabanı — iptal.");
  }

  const sema = await semaKaynagi(prodUrl);
  console.log(`şema   : ${sema.ad}`);

  let calisma = SERVER;
  if (sema.commit) {
    rmSync(GECICI, { recursive: true, force: true });
    mkdirSync(join(GECICI, "scripts"), { recursive: true });
    const goster = (yol) => execFileSync("git", ["-C", REPO, "show", `${sema.commit}:${yol}`], { encoding: "utf8" });
    writeFileSync(join(GECICI, "db.ts"), goster("apps/server/db.ts"));
    copyFileSync(join(SERVER, "scripts", "prod-to-local.mjs"), join(GECICI, "scripts", "prod-to-local.mjs"));
    calisma = GECICI; // .env'i yok → yalnız aşağıda verdiğimiz bağlantılar kullanılır
  }

  await hedef.hazirla();

  const tsx = join(SERVER, "node_modules", ".bin", "tsx");
  const r = spawnSync(tsx, ["scripts/prod-to-local.mjs"], {
    cwd: calisma,
    stdio: "inherit",
    env: {
      ...process.env,
      PROD_URL: prodUrl,
      DATABASE_URL: hedef.url,
      ...(hedef.uzak ? { ALLOW_REMOTE_TARGET: "1" } : {}),
    },
  });
  rmSync(GECICI, { recursive: true, force: true });

  if (r.status !== 0) {
    await hedef.geriAl();
    process.exit(1);
  }
  await supabaseYetkileriniKapat(hedef.url);
  console.log(`hedef  : ${hedef.ad}`);
}

main().catch((e) => {
  rmSync(GECICI, { recursive: true, force: true });
  console.error(`\nHATA: ${e.message}`);
  process.exit(1);
});
