import { describe, it, expect } from "vitest";
import { recActiveOn } from "./recurring.js";
import type { Recurring } from "./types.js";

const rec = (over: Partial<Recurring>): Recurring => ({
  id: 1, kind: "expense", name: "Kira", amount: 1000, day: 5, from_month: null, to_month: null, ...over,
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
