import { describe, it, expect } from "vitest";
import { positions } from "./portfolio.js";
import type { Trade, Price } from "./types.js";

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
