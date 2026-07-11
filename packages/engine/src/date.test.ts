import { describe, it, expect } from "vitest";
import { hits, normYm, ymOf, monthsBack, num } from "./date.js";

describe("hits", () => {
  it("ayın belirtilen gününde eşleşir", () => {
    expect(hits(new Date(2026, 0, 15), 15)).toBe(true);
    expect(hits(new Date(2026, 0, 14), 15)).toBe(false);
  });
  it("kısa ayda ödeme günü ay sonuna kayar (31 → Şubat 28)", () => {
    expect(hits(new Date(2026, 1, 28), 31)).toBe(true);
    expect(hits(new Date(2026, 1, 27), 31)).toBe(false);
  });
  it("artık yılda Şubat 29'a kayar", () => {
    expect(hits(new Date(2028, 1, 29), 31)).toBe(true);
  });
});

describe("normYm", () => {
  it("YYYY-MM biçimini olduğu gibi kabul eder", () => {
    expect(normYm("2026-08")).toBe("2026-08");
  });
  it("tek haneli ayı sıfırla doldurur", () => {
    expect(normYm("2026-8")).toBe("2026-08");
  });
  it("nokta veya eğik çizgi ayracını kabul eder", () => {
    expect(normYm("2026.8")).toBe("2026-08");
    expect(normYm("2026/12")).toBe("2026-12");
  });
  it("geçersiz ay numarasını reddeder", () => {
    expect(normYm("2026-13")).toBeNull();
    expect(normYm("2026-00")).toBeNull();
  });
  it("tanınmayan biçimi reddeder", () => {
    expect(normYm("ağustos 2026")).toBeNull();
    expect(normYm("")).toBeNull();
  });
});

describe("ymOf", () => {
  it("YYYY-MM üretir, ay sıfırla doldurulur", () => {
    expect(ymOf(new Date(2026, 0, 1))).toBe("2026-01");
    expect(ymOf(new Date(2026, 10, 1))).toBe("2026-11");
  });
});

describe("monthsBack", () => {
  it("son n ayı eskiden yeniye sıralı döner, verilen ay dahil", () => {
    expect(monthsBack(3, new Date(2026, 2, 15))).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
  it("yıl sınırını doğru geçer", () => {
    expect(monthsBack(3, new Date(2026, 0, 1))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
  it("n=1 sadece verilen ayı döner", () => {
    expect(monthsBack(1, new Date(2026, 5, 1))).toEqual(["2026-06"]);
  });
});

describe("num", () => {
  it("Türkçe binlik+ondalık biçimini doğru ayrıştırır", () => {
    expect(num("1.234,56")).toBeCloseTo(1234.56);
    expect(num("12.345,67")).toBeCloseTo(12345.67);
    expect(num("1.234.567,89")).toBeCloseTo(1234567.89);
  });
  it("düz ondalık noktayı binlik ayracıyla karıştırmaz", () => {
    expect(num("1234.56")).toBeCloseTo(1234.56);
    expect(num("0.5")).toBeCloseTo(0.5);
  });
  it("virgülü ondalık ayracı olarak kabul eder", () => {
    expect(num("1234,56")).toBeCloseTo(1234.56);
  });
  it("düz tam sayıları ve bozuk girişi doğru ele alır", () => {
    expect(num("100")).toBe(100);
    expect(num("")).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(500)).toBe(500);
  });
});
