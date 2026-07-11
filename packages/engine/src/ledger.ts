import type { Category, Transaction } from "./types.js";
import { ymOf, parseD } from "./date.js";

export type CategoryTotal = { category_id: number | null; name: string; kind: Category["kind"] | null; total: number; count: number };

/** Belirtilen ay (YYYY-MM) için kategori bazında gerçekleşen toplamlar; kategorisiz işlemler "Kategorisiz" altında toplanır */
export function categoryTotals(transactions: Transaction[], categories: Category[], ym: string): CategoryTotal[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byCat = new Map<number | null, CategoryTotal>();
  transactions
    .filter((t) => ymOf(parseD(t.date)) === ym)
    .forEach((t) => {
      const cat = t.category_id != null ? catMap.get(t.category_id) : undefined;
      const key = cat ? cat.id : null;
      if (!byCat.has(key)) {
        byCat.set(key, { category_id: key, name: cat?.name ?? "Kategorisiz", kind: cat?.kind ?? null, total: 0, count: 0 });
      }
      const entry = byCat.get(key)!;
      entry.total += t.amount;
      entry.count += 1;
    });
  return [...byCat.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/** Belirtilen ay (YYYY-MM) için işlemleri filtreler, tarihe göre yeniden eskiye sıralar */
export function transactionsInMonth(transactions: Transaction[], ym: string): Transaction[] {
  return transactions
    .filter((t) => ymOf(parseD(t.date)) === ym)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

export type MonthlyTotal = { ym: string; income: number; expense: number; net: number };

/** Verilen aylar (YYYY-MM) için gelir/gider/net toplamları; işlemi olmayan aylar 0 olarak döner. Sıralama `months` ile aynıdır */
export function monthlyTotals(transactions: Transaction[], months: string[]): MonthlyTotal[] {
  const byYm = new Map<string, MonthlyTotal>(months.map((ym) => [ym, { ym, income: 0, expense: 0, net: 0 }]));
  transactions.forEach((t) => {
    const entry = byYm.get(ymOf(parseD(t.date)));
    if (!entry) return; // istenen ay aralığının dışında
    if (t.amount >= 0) entry.income += t.amount; else entry.expense += t.amount;
    entry.net += t.amount;
  });
  return months.map((ym) => byYm.get(ym)!);
}
