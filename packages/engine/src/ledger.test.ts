import { describe, it, expect } from "vitest";
import { categoryTotals, transactionsInMonth } from "./ledger.js";
import type { Category, Transaction } from "./types.js";

const categories: Category[] = [
  { id: 1, name: "Market", kind: "expense", color: "#F00" },
  { id: 2, name: "Maaş", kind: "income", color: "#0F0" },
];

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 0, date: "2026-01-01", name: "İşlem", amount: 0, category_id: null, account_id: null, ...over,
});

describe("categoryTotals", () => {
  it("aynı kategorideki işlemleri toplar", () => {
    const txs = [
      tx({ id: 1, date: "2026-01-05", category_id: 1, amount: -100 }),
      tx({ id: 2, date: "2026-01-10", category_id: 1, amount: -50 }),
    ];
    const totals = categoryTotals(txs, categories, "2026-01");
    expect(totals).toHaveLength(1);
    expect(totals[0].name).toBe("Market");
    expect(totals[0].total).toBeCloseTo(-150);
    expect(totals[0].count).toBe(2);
  });

  it("kategorisiz işlemleri 'Kategorisiz' altında toplar", () => {
    const txs = [tx({ id: 1, category_id: null, amount: -20 })];
    const totals = categoryTotals(txs, categories, "2026-01");
    expect(totals[0].name).toBe("Kategorisiz");
    expect(totals[0].category_id).toBeNull();
  });

  it("başka aydaki işlemleri hariç tutar", () => {
    const txs = [
      tx({ id: 1, date: "2026-01-15", category_id: 1, amount: -100 }),
      tx({ id: 2, date: "2026-02-15", category_id: 1, amount: -999 }),
    ];
    const totals = categoryTotals(txs, categories, "2026-01");
    expect(totals).toHaveLength(1);
    expect(totals[0].total).toBeCloseTo(-100);
  });

  it("mutlak değere göre büyükten küçüğe sıralar", () => {
    const txs = [
      tx({ id: 1, date: "2026-01-01", category_id: 1, amount: -10 }),
      tx({ id: 2, date: "2026-01-02", category_id: 2, amount: 5000 }),
    ];
    const totals = categoryTotals(txs, categories, "2026-01");
    expect(totals[0].name).toBe("Maaş");
    expect(totals[1].name).toBe("Market");
  });

  it("silinmiş kategoriye işaret eden category_id'yi Kategorisiz sayar", () => {
    const txs = [tx({ id: 1, category_id: 999, amount: -30 })];
    const totals = categoryTotals(txs, categories, "2026-01");
    expect(totals[0].name).toBe("Kategorisiz");
  });
});

describe("transactionsInMonth", () => {
  it("belirtilen aydaki işlemleri en yeniden eskiye sıralar", () => {
    const txs = [
      tx({ id: 1, date: "2026-01-05" }),
      tx({ id: 2, date: "2026-01-20" }),
      tx({ id: 3, date: "2026-02-01" }),
    ];
    const result = transactionsInMonth(txs, "2026-01");
    expect(result.map((t) => t.id)).toEqual([2, 1]);
  });
});
