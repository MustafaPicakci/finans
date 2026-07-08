import { describe, it, expect } from "vitest";
import { positions, portfolioValueHistory } from "./portfolio.js";
import type { Trade, Price, PriceHistoryEntry } from "./types.js";

const trade = (over: Partial<Trade>): Trade => ({
  id: 0, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 0, price: 0, fee: 0, ...over,
});

describe("positions", () => {
  it("tek alışta ortalama maliyet birim fiyata eşittir", () => {
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(p.qty).toBe(10);
    expect(p.avg).toBe(100);
  });

  it("iki alışta ağırlıklı ortalama maliyet hesaplanır", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", qty: 10, price: 200 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(20);
    expect(p.avg).toBe(150); // (10*100 + 10*200) / 20
  });

  it("satışta gerçekleşen K/Z = adet × (satış − ortalama) − komisyon", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 4, price: 150, fee: 5 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(6);
    expect(p.realized).toBeCloseTo(4 * (150 - 100) - 5); // 195
    expect(p.avg).toBe(100); // kalan payın maliyeti değişmez
  });

  it("pozisyon tamamen kapanıp yeniden açılınca maliyet sıfırlanır", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 10, price: 120 }),
      trade({ id: 3, date: "2026-03-01", side: "ALIŞ", qty: 5, price: 300 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(5);
    expect(p.avg).toBe(300); // eski maliyetten etkilenmemeli
    expect(p.realized).toBeCloseTo(10 * (120 - 100)); // ilk turdan gerçekleşen K/Z korunur
  });

  it("fiyat yoksa değer ve açık K/Z null döner", () => {
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(p.cur).toBeNull();
    expect(p.value).toBeNull();
    expect(p.unreal).toBeNull();
  });

  it("fiyat varsa değer ve açık K/Z hesaplanır, kaynak taşınır", () => {
    const prices: Price[] = [{ symbol: "THYAO", asset_type: "BIST", price: 130, source: "manual", updated_at: "2026-01-01" }];
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], prices);
    expect(p.value).toBe(1300);
    expect(p.unreal).toBeCloseTo(300);
    expect(p.source).toBe("manual");
  });
});

describe("portfolioValueHistory", () => {
  const hist = (over: Partial<PriceHistoryEntry>): PriceHistoryEntry => ({
    symbol: "THYAO", asset_type: "BIST", date: "2026-01-01", price: 0, ...over,
  });

  it("fiyat geçmişi yoksa boş dizi döner", () => {
    expect(portfolioValueHistory([trade({ id: 1, qty: 10, price: 100 })], [])).toEqual([]);
  });

  it("işlemden önceki günlerde miktar sıfır olduğundan değer sıfırdır", () => {
    const trades = [trade({ id: 1, date: "2026-01-10", qty: 10, price: 100 })];
    const prices = [hist({ date: "2026-01-05", price: 120 })];
    const result = portfolioValueHistory(trades, prices);
    expect(result).toEqual([{ date: "2026-01-05", value: 0 }]);
  });

  it("işlem sonrası günlerde miktar × o günkü fiyat hesaplanır", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 })];
    const prices = [hist({ date: "2026-01-05", price: 120 }), hist({ date: "2026-01-10", price: 150 })];
    const result = portfolioValueHistory(trades, prices);
    expect(result).toEqual([
      { date: "2026-01-05", value: 1200 },
      { date: "2026-01-10", value: 1500 },
    ]);
  });

  it("bilinmeyen bir güne en yakın önceki fiyatı forward-fill eder", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 })];
    // sadece THYAO için 01-05'te fiyat var; ALTIN için hiç yok (o gün 01-08'de kayıt oluşuyor)
    const prices = [
      hist({ symbol: "THYAO", date: "2026-01-05", price: 120 }),
      hist({ symbol: "GRAM", asset_type: "ALTIN", date: "2026-01-08", price: 4000 }),
    ];
    const result = portfolioValueHistory(trades, prices);
    // 01-08'de THYAO fiyatı hâlâ 01-05'ten forward-fill edilir (10*120=1200); ALTIN'de işlem yok
    const day8 = result.find((r) => r.date === "2026-01-08")!;
    expect(day8.value).toBe(1200);
  });

  it("satış sonrası miktar azalınca değer de düşer", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-15", side: "SATIŞ", qty: 6, price: 110 }),
    ];
    const prices = [hist({ date: "2026-01-20", price: 130 })];
    const result = portfolioValueHistory(trades, prices);
    expect(result).toEqual([{ date: "2026-01-20", value: 4 * 130 }]);
  });
});
