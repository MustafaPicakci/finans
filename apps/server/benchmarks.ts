import { db } from "./db.js";
import { yahooHistory } from "./prices.js";

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
