import type { PriceHistoryEntry } from "./types.js";
import { sliceValueHistory, twrSeries, type HistoryRange, type ValueDecompPoint, type ValuePoint } from "./portfolio.js";

/* ————— ÇOK DÖNEMLİ GETİRİLER (Faz 32) —————
   Ekran "şu an ne kadarım var" diyordu ama "bu hafta ne oldu, bu ay ne oldu" diyemiyordu.
   Buradaki dört fonksiyon o boşluğu dolduruyor: sembol başına pencere getirileri (tablo
   kolonları), ay ay portföy getirisi ("Son Aylar" paneli) ve aralık başına TWR (grafik
   çiplerinin üstündeki rakamlar).

   ÜÇ KURAL — üçü de teste bağlı:

   1) ÇAPA "BUGÜN" DEĞİL, SERİNİN SON GÜNÜDÜR. Fiyat çekimi birkaç gün durmuşsa bugüne göre
      pencere açmak sessizce kayar: "günlük getiri" aslında üç günlük olur ve kimse fark etmez.
      Son bilinen güne çapalayınca rakam her zaman "son N gün"ü anlatır.

   2) VERİ YETMİYORSA null — UYDURULMAZ. TEFAS (FON) ve ALTIN geriye doldurulamıyor
      (bkz. CLAUDE.md, Faz 27), yani o sembollerde uzun pencereler gerçekten boştur.
      Arayüz "—" yazar; eldeki en eski fiyatı taban saymak sahte bir getiri üretirdi.

   3) SEMBOL GETİRİSİ FİYAT GETİRİSİDİR, pozisyon değeri değil. Değeri yüzdeye çevirmek
      üstüne alım yapmayı "kazanç" gibi gösterirdi (portfolio.ts'teki Faz 27 kuralının aynısı). */

/** Pencere uzunlukları (gün). Takvim ayı değil sabit gün — pencere karşılaştırması için yeterli. */
const GUN = { gunluk: 1, haftalik: 7, aylik: 30, uc: 90, alti: 180, yillik: 365 } as const;

/** `symbolReturns` çıktısı; her alan yüzde (12.5 = %12,5) ya da veri yoksa `null`. */
export type SymbolReturns = { [K in keyof typeof GUN]: number | null };

const MS_GUN = 86_400_000;

/** ISO tarihten N gün çıkarır (yerel saat diliminden bağımsız, saf dizi aritmetiği değil UTC). */
function gunCikar(iso: string, gun: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - gun * MS_GUN).toISOString().slice(0, 10);
}

/** Bir sembolün fiyat serisi, tarihe göre artan. `key` = `"TÜR:SEMBOL"`. */
function seri(priceHistory: PriceHistoryEntry[], key: string): ValuePoint[] {
  return priceHistory
    .filter((h) => `${h.asset_type}:${h.symbol}` === key)
    .map((h) => ({ date: h.date, value: h.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bir sembolün SON `days` GÜNLÜK fiyat getirisi (yüzde).
 *
 * Taban nokta: `son gün − days`'e eşit ya da ondan ÖNCEKİ en yakın gün (forward-fill) —
 * borsa tatilinde o tarihte kayıt olmayabilir, en yakın önceki fiyat doğru tabandır.
 * Seride o kadar geriye giden nokta yoksa `null` döner (bkz. kural 2).
 */
export function priceReturnOver(priceHistory: PriceHistoryEntry[], key: string, days: number): number | null {
  return seriReturnOver(seri(priceHistory, key), days);
}

/** `priceReturnOver`'ın seri alan hâli — `symbolReturns` seriyi bir kez kurup altı kez çağırır. */
function seriReturnOver(pts: ValuePoint[], days: number): number | null {
  if (pts.length < 2) return null;
  const son = pts.at(-1)!;
  const hedef = gunCikar(son.date, days);
  /* Hedefe eşit ya da ondan önceki SON nokta. Geriye doğru tarama: seriler gün başına tek
     kayıt tuttuğundan kısa; ikili arama okunabilirliğe değmez. */
  let taban: ValuePoint | null = null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].date <= hedef) { taban = pts[i]; break; }
  }
  if (!taban || taban.date === son.date || !(taban.value > 0)) return null;
  return (son.value / taban.value - 1) * 100;
}

/** Tablo kolonlarının tamamı — seri bir kez kurulur. */
export function symbolReturns(priceHistory: PriceHistoryEntry[], key: string): SymbolReturns {
  const pts = seri(priceHistory, key);
  return {
    gunluk: seriReturnOver(pts, GUN.gunluk),
    haftalik: seriReturnOver(pts, GUN.haftalik),
    aylik: seriReturnOver(pts, GUN.aylik),
    uc: seriReturnOver(pts, GUN.uc),
    alti: seriReturnOver(pts, GUN.alti),
    yillik: seriReturnOver(pts, GUN.yillik),
  };
}

/**
 * Takvim ayı başına portföy getirisi (TWR, yüzde) — "Son Aylar" paneli. Yeniden eskiye.
 *
 * Bir ayın getirisi, ÖNCEKİ AYIN SON NOKTASI TOHUM alınarak hesaplanır. Yalnız ay içindeki
 * noktalarla `twrSeries` çalıştırmak ayın İLK gününün hareketini ıskalar (o nokta zincirde
 * i=0'dır ve getiri üretmez), yani her ay sistematik olarak eksik görünürdü.
 */
export function monthlyTwr(points: ValueDecompPoint[]): { ym: string; pct: number }[] {
  if (points.length === 0) return [];
  const aylar = [...new Set(points.map((p) => p.date.slice(0, 7)))].sort();
  const out: { ym: string; pct: number }[] = [];
  for (const ym of aylar) {
    const ilk = points.findIndex((p) => p.date.slice(0, 7) === ym);
    const sonrasi = points.findIndex((p) => p.date.slice(0, 7) > ym);
    const bitis = sonrasi === -1 ? points.length : sonrasi;
    // tohum: önceki ayın son noktası (ilk ayda yok — o ay kendi ilk gününden başlar)
    const dilim = points.slice(Math.max(0, ilk - 1), bitis);
    const pct = twrSeries(dilim).at(-1)?.value ?? 0;
    out.push({ ym, pct });
  }
  return out.reverse();
}

/** Grafik aralık çiplerinin üstündeki rakamlar: her aralık için o pencerenin TWR'ı. */
export function twrByRange(
  points: ValueDecompPoint[],
  ranges: HistoryRange[],
  today?: Date,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const r of ranges) {
    const pencere = sliceValueHistory(points, r, today);
    out[r] = pencere.length >= 2 ? twrSeries(pencere).at(-1)?.value ?? null : null;
  }
  return out;
}
