import { describe, it, expect } from "vitest";
import {
  depositMaturity, depositGrossInterest, depositNetInterest, depositMaturityValue,
  depositAccruedFraction, depositAccruedInterest, depositValueOn, depositMatured, depositDaysRemaining,
} from "./deposits.js";
import type { Deposit } from "./types.js";

const dep = (over: Partial<Deposit> = {}): Deposit => ({
  id: 1, name: "Vadeli", principal: 100_000, rate: 50, open_date: "2026-01-01", term_days: 365, withholding: 0,
  ...over,
});

describe("deposits", () => {
  it("vade tarihi = açılış + gün sayısı", () => {
    expect(depositMaturity(dep({ open_date: "2026-01-01", term_days: 30 }))).toEqual(new Date(2026, 0, 31));
  });

  it("brüt faiz = anapara × oran × gün/365 (basit)", () => {
    // 100.000 × %50 × 365/365 = 50.000
    expect(depositGrossInterest(dep())).toBeCloseTo(50_000, 6);
    // yarım yıla oranlanır: 100.000 × %50 × 182,5/365 = 25.000
    expect(depositGrossInterest(dep({ term_days: 182.5 }))).toBeCloseTo(25_000, 6);
  });

  it("stopaj net faizi düşürür", () => {
    expect(depositNetInterest(dep({ withholding: 10 }))).toBeCloseTo(45_000, 6); // 50.000 × 0,9
    expect(depositMaturityValue(dep({ withholding: 10 }))).toBeCloseTo(145_000, 6);
    expect(depositMaturityValue(dep())).toBeCloseTo(150_000, 6);
  });

  it("değer açılıştan vadeye doğrusal accrue eder", () => {
    const d = dep(); // 365 gün, net faiz 50.000
    expect(depositAccruedFraction(d, new Date(2026, 0, 1))).toBeCloseTo(0, 6);
    expect(depositValueOn(d, new Date(2026, 0, 1))).toBeCloseTo(100_000, 6); // açılışta = anapara
    // ~yarı yol (182,5 gün): 2026-07-02 açılıştan 182 gün
    const half = new Date(parseDays("2026-01-01", 182.5));
    expect(depositAccruedInterest(d, half)).toBeCloseTo(25_000, 0);
  });

  it("vadeden önce değer anapara+kısmi faiz, vadede/sonrasında donar", () => {
    const d = dep({ term_days: 100, rate: 36.5 }); // brüt = 100.000×0,365×100/365 = 10.000
    expect(depositMaturityValue(d)).toBeCloseTo(110_000, 6);
    const afterMaturity = new Date(parseDays("2026-01-01", 200)); // vade geçti
    expect(depositAccruedFraction(d, afterMaturity)).toBe(1);
    expect(depositValueOn(d, afterMaturity)).toBeCloseTo(110_000, 6); // donmuş
    expect(depositMatured(d, afterMaturity)).toBe(true);
    expect(depositMatured(d, new Date(2026, 0, 1))).toBe(false);
  });

  it("açılıştan önceki tarihte faiz birikmez (fraction 0)", () => {
    const d = dep({ open_date: "2026-06-01", term_days: 30 });
    expect(depositAccruedFraction(d, new Date(2026, 0, 1))).toBe(0);
    expect(depositValueOn(d, new Date(2026, 0, 1))).toBeCloseTo(100_000, 6);
  });

  it("kalan gün: vade dolunca 0", () => {
    const d = dep({ open_date: "2026-01-01", term_days: 30 });
    expect(depositDaysRemaining(d, new Date(2026, 0, 11))).toBe(20);
    expect(depositDaysRemaining(d, new Date(2026, 1, 15))).toBe(0);
  });
});

/** test yardımcı: açılış + n gün (kesirli gün destekli) → Date */
function parseDays(open: string, n: number): number {
  const [y, m, d] = open.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() + n * 86_400_000;
}
