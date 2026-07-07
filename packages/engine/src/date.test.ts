import { describe, it, expect } from "vitest";
import { hits, normYm, ymOf } from "./date.js";

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
