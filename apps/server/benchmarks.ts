import { db } from "./db.js";
import { yahooHistory, backfillPriceHistory } from "./prices.js";

/* ————— REFERANS ENDEKSLER (Faz 27) —————
   "Portföyüm %8 kazandı" tek başına bir şey söylemez — aynı dönemde BIST %20 kazandıysa
   kaybetmişsindir. Karşılaştırma için endeks serileri gerekiyor ve bunlar KULLANICININ
   varlıkları değil, herkes için aynı olan piyasa verisidir.

   NEDEN AYRI TABLO (price_history'ye yazılmadı):
   - `AssetType` kapalı bir birleşimdir ve TradeForm'un tür açılırı ondan beslenir; oraya
     "ENDEKS" eklemek S&P 500'ü ALINABİLİR bir varlık gibi gösterirdi.
   - `/api/all` price_history'yi kullanıcının SEMBOLLERİYLE sınırlı gönderir (EXISTS+trades);
     endeksler hiç tutulmadığından o filtreye takılır, istisna yazmak gerekirdi.
   Ayrı tablo ikisini de çözer: kapalı bir kayıt (aşağıdaki liste) + küçük, global bir seri.

   HEPSİ TL'YE ÇEVRİLİP SAKLANIR. Sebep: portföy TL tabanlı; S&P'yi dolar cinsinden çizmek
   farklı bir eğri verir (kur kazancı dışarıda kalır) ve "TL'de beni geçti mi?" sorusuna
   cevap vermez. Çevrim ALIM anında, o GÜNÜN kuruyla yapılır — bugünkü kurla çevirmek
   geçmişin tamamını bugünün kuruna göre yeniden yazardı. */

const OUNCE_GRAMS = 31.1035;

export type Benchmark = {
  key: string; label: string; yahoo: string;
  /** USD cinsinden gelen seriler o günün kuruyla TL'ye çevrilir */
  usd?: boolean;
  /** ons → gram (altın) */
  perOunce?: boolean;
  /** kur serisi: çevirici olarak kullanılır, çip listesinde de görünür */
  hidden?: boolean;
};

/** Kapalı liste — yeni bir referans eklemek buraya bir satırdır. */
export const BENCHMARKS: Benchmark[] = [
  { key: "BIST100", label: "BIST 100", yahoo: "XU100.IS" },
  { key: "SP500", label: "S&P 500", yahoo: "^GSPC", usd: true },
  { key: "NASDAQ", label: "NASDAQ", yahoo: "^IXIC", usd: true },
  { key: "GRAMALTIN", label: "Gram Altın", yahoo: "GC=F", usd: true, perOunce: true },
  { key: "USDTRY", label: "Dolar/TL", yahoo: "USDTRY=X" },
];

const UPSERT = `INSERT INTO benchmark_history (key, date, price) VALUES (?,?,?)
  ON CONFLICT (key, date) DO UPDATE SET price=excluded.price`;

/**
 * Referans serilerini çeker ve TL'ye çevirip yazar. `range` Yahoo aralığıdır ("1d" günlük
 * tazeleme, "2y" geriye doldurma). USD seriler için önce kur serisi çekilir; kurun
 * bilinmediği günler ATLANIR — eksik kuru bugünkününle doldurmak sessiz bir yalan olurdu.
 */
export async function refreshBenchmarks(range = "1d"): Promise<{ key: string; days: number }[]> {
  const fx = new Map<string, number>();
  const fxDef = BENCHMARKS.find((b) => b.key === "USDTRY")!;
  for (const p of await yahooHistory(fxDef.yahoo, range)) fx.set(p.date, p.price);

  const out: { key: string; days: number }[] = [];
  for (const b of BENCHMARKS) {
    const raw = b.key === "USDTRY"
      ? [...fx].map(([date, price]) => ({ date, price }))
      : await yahooHistory(b.yahoo, range);
    const rows: [string, number][] = [];
    for (const p of raw) {
      let v = p.price;
      if (b.perOunce) v /= OUNCE_GRAMS;
      if (b.usd) {
        const rate = fx.get(p.date);
        if (rate == null) continue; // o günün kuru yok → çevrilemez, uydurma
        v *= rate;
      }
      rows.push([p.date, v]);
    }
    if (rows.length) {
      await db.tx(async (t) => { for (const [date, price] of rows) await t.run(UPSERT, b.key, date, price); });
    }
    out.push({ key: b.key, days: rows.length });
  }
  return out;
}

/* ————— OTOMATİK BAKIM (Faz 27) —————
   Backfill'i elle çağrılan bir uçta bırakmak sessiz bir tuzaktı: sunucuya kurunca grafik yine
   kısa başlar, referans çipleri hiç görünmez (veri yokken çip basılmıyor) ve "özellik gelmemiş"
   sanılırdı. Bu yüzden açılışta ve günlük işte kendi kendine tamamlanır.

   İki ayrı boşluk, iki ayrı ölçüt:
   - REFERANSLAR: tablo boşsa/sığsa (<60 gün) 2 yıl, doluysa 5 gün (tatil/kapalı kalma boşluğu).
   - TUTULAN SEMBOLLER: `settings.backfilled_symbols` listesinde OLMAYANLAR doldurulur. Tek bir
     "yapıldı" bayrağı yetmezdi — sonradan alınan bir hisse listeye girmez, geçmişi kısa kalır
     ve sebebi görünmezdi. Liste sayesinde yalnız YENİ semboller çekilir (boşsa hiç istek yok). */

const SYMS_KEY = "backfilled_symbols";

export async function autoBackfill(): Promise<{ benchmarks: number; symbols: string[] }> {
  const covered = await db.get<{ n: number }>("SELECT count(DISTINCT date)::int AS n FROM benchmark_history");
  const benchRange = (covered?.n ?? 0) < 60 ? "2y" : "5d";
  const bench = await refreshBenchmarks(benchRange);

  const held = await db.all<{ asset_type: string; symbol: string }>(
    "SELECT DISTINCT asset_type, symbol FROM trades WHERE asset_type IN ('BIST','ETF','KRIPTO','DOVIZ')",
  );
  const rawList = (await db.get<{ value: string }>("SELECT value FROM settings WHERE key=?", SYMS_KEY))?.value ?? "";
  const done = new Set(rawList.split(",").filter(Boolean));
  const missing = held.filter((h) => !done.has(`${h.asset_type}:${h.symbol}`));
  if (missing.length) {
    /* backfillPriceHistory tutulan TÜM sembolleri tazeler; yeni sembol varsa hepsini yeniden
       çekmek 8-10 istek eder ve idempotenttir (upsert) — ayrı bir "yalnız şunlar" yolu açmaya
       değmez. Liste ancak başarıdan SONRA yazılır: hata olursa bir dahaki sefere tekrar denenir. */
    await backfillPriceHistory("2y");
    for (const h of held) done.add(`${h.asset_type}:${h.symbol}`);
    await db.run(
      "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
      SYMS_KEY, [...done].join(","),
    );
  }
  return { benchmarks: bench.reduce((n, b) => n + b.days, 0), symbols: missing.map((m) => `${m.asset_type}:${m.symbol}`) };
}
