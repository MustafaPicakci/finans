import type { ValuePoint } from "./portfolio.js";

/* ————— REFERANS ENDEKSLER (Faz 27) —————
   "Portföyüm %8 kazandı" tek başına eksik bir cümledir: aynı dönemde BIST %20 kazandıysa
   aslında geride kalmışsındır. Bu dosya karşılaştırmanın İSTEMCİ tarafıdır — anahtar ve
   etiketler burada, çünkü hem sunucu (hangi Yahoo sembolünden çekilecek) hem arayüz
   (çipte ne yazacak) aynı listeye bakmalı; iki kopya olsaydı bir anahtar yeniden
   adlandırıldığında sessizce ayrışırdı. Yahoo eşlemesi sunucuda kalır (piyasa detayı).

   Serilerin HEPSİ TL'ye çevrilmiş saklanır (bkz. apps/server/benchmarks.ts): portföy TL
   tabanlı olduğundan "TL'de beni geçti mi?" sorusunun cevabı budur. */

export type BenchmarkPoint = { key: string; date: string; price: number };

export const BENCHMARKS: { key: string; label: string }[] = [
  { key: "BIST100", label: "BIST 100" },
  { key: "SP500", label: "S&P 500" },
  { key: "NASDAQ", label: "NASDAQ" },
  { key: "GRAMALTIN", label: "Gram Altın" },
  { key: "USDTRY", label: "Dolar/TL" },
];

export const benchmarkLabel = (key: string): string =>
  BENCHMARKS.find((b) => b.key === key)?.label ?? key;

/** Bir referansın tarih sıralı serisi; yüzdeye çevirme `rebasePct` ile yapılır. */
export function benchmarkSeries(rows: BenchmarkPoint[], key: string): ValuePoint[] {
  return rows
    .filter((r) => r.key === key)
    .map((r) => ({ date: r.date, value: r.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
