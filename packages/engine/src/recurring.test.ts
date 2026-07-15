import { describe, it, expect } from "vitest";
import { recActiveOn, recurringAmountIndex, recAmountOn, recNextAmountChange, REC_AMOUNT_BEGIN } from "./recurring.js";
import type { Recurring, RecurringAmount } from "./types.js";

const rec = (over: Partial<Recurring>): Recurring => ({
  id: 1, kind: "expense", name: "Kira", day: 5, from_month: null, to_month: null, ...over,
});

describe("recActiveOn", () => {
  it("from_month/to_month yoksa her zaman aktiftir", () => {
    expect(recActiveOn(rec({}), new Date(2020, 0, 1))).toBe(true);
    expect(recActiveOn(rec({}), new Date(2099, 0, 1))).toBe(true);
  });
  it("from_month'tan önceki aylarda pasiftir, dahil olduğu aydan itibaren aktiftir", () => {
    const r = rec({ from_month: "2026-03" });
    expect(recActiveOn(r, new Date(2026, 1, 15))).toBe(false); // Şubat
    expect(recActiveOn(r, new Date(2026, 2, 1))).toBe(true); // Mart (dahil)
  });
  it("to_month dahil son aydır, sonraki ay pasiftir", () => {
    const r = rec({ to_month: "2026-03" });
    expect(recActiveOn(r, new Date(2026, 2, 31))).toBe(true); // Mart (dahil)
    expect(recActiveOn(r, new Date(2026, 3, 1))).toBe(false); // Nisan
  });
});

const amt = (from_month: string, amount: number, recurring_id = 1): RecurringAmount => ({ recurring_id, from_month, amount });

describe("recAmountOn", () => {
  it("tek sentinel ('baştan') satır her ayda geçerlidir", () => {
    const rows = [amt(REC_AMOUNT_BEGIN, 9000)];
    expect(recAmountOn(rows, "2020-01")).toBe(9000);
    expect(recAmountOn(rows, "2099-12")).toBe(9000);
  });
  it("değişiklik ayından itibaren yeni tutar, öncesinde eski tutar geçerlidir", () => {
    const rows = [amt(REC_AMOUNT_BEGIN, 9000), amt("2026-08", 13000)];
    expect(recAmountOn(rows, "2026-07")).toBe(9000);
    expect(recAmountOn(rows, "2026-08")).toBe(13000); // dahil
    expect(recAmountOn(rows, "2027-01")).toBe(13000);
  });
  it("çoklu değişimde from_month <= ym olan en büyük satır kazanır", () => {
    const rows = [amt(REC_AMOUNT_BEGIN, 100), amt("2026-03", 200), amt("2026-08", 300)];
    expect(recAmountOn(rows, "2026-02")).toBe(100);
    expect(recAmountOn(rows, "2026-05")).toBe(200);
    expect(recAmountOn(rows, "2026-08")).toBe(300);
  });
  it("boş/undefined dizi → undefined", () => {
    expect(recAmountOn([], "2026-01")).toBeUndefined();
    expect(recAmountOn(undefined, "2026-01")).toBeUndefined();
  });
});

describe("recurringAmountIndex", () => {
  it("kaleme göre gruplar ve sırasız girdiyi from_month artan sıralar", () => {
    const idx = recurringAmountIndex([amt("2026-08", 13000), amt(REC_AMOUNT_BEGIN, 9000), amt("2025-01", 50, 2)]);
    expect(idx.get(1)!.map((r) => r.from_month)).toEqual([REC_AMOUNT_BEGIN, "2026-08"]);
    expect(idx.get(2)!).toHaveLength(1);
  });
});

describe("recNextAmountChange", () => {
  it("ym'den sonra başlayacak ilk değişikliği döner, yoksa undefined", () => {
    const rows = [amt(REC_AMOUNT_BEGIN, 9000), amt("2026-08", 13000)];
    expect(recNextAmountChange(rows, "2026-07")?.amount).toBe(13000);
    expect(recNextAmountChange(rows, "2026-08")).toBeUndefined();
    expect(recNextAmountChange(undefined, "2026-07")).toBeUndefined();
  });
});
