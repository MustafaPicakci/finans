import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { project } from "./projection.js";
import type { AllData } from "./types.js";

const baseData = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], cards: [], card_txs: [], prices: [],
  categories: [], transactions: [], settings: {},
  ...over,
});

describe("project", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1)); // 1 Ocak 2026, bugün sabitlenir
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hareket yoksa bakiye hesap toplamında sabit kalır", () => {
    const data = baseData({ accounts: [{ id: 1, name: "Vadesiz", balance: 1000 }] });
    const days = project(data, 1);
    expect(days[0].bal).toBe(1000);
    expect(days[days.length - 1].bal).toBe(1000);
  });

  it("bugünden başlayıp ufuk kadar ay ilerler (uç gün dahil)", () => {
    const data = baseData({ accounts: [{ id: 1, name: "Vadesiz", balance: 0 }] });
    const days = project(data, 1);
    const last = days[days.length - 1].date;
    expect(last.getFullYear()).toBe(2026);
    expect(last.getMonth()).toBe(1); // Şubat
    expect(last.getDate()).toBe(1); // 1 Ay sonra = 1 Şubat
  });

  it("düzenli gelir belirtilen günde bakiyeye eklenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "income", name: "Maaş", amount: 5000, day: 15, from_month: null, to_month: null }],
    });
    const days = project(data, 1);
    const payDay = days.find((d) => d.date.getDate() === 15 && d.date.getMonth() === 0);
    expect(payDay!.net).toBe(5000);
    expect(payDay!.ev).toEqual([{ n: "Maaş", a: 5000 }]);
    // ödeme gününden sonraki bakiye kalıcı olarak artmış olmalı
    expect(days[days.length - 1].bal).toBe(5000);
  });

  it("from_month/to_month aralığı dışındaki aylarda düzenli kalem işlemez", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "expense", name: "Eski kira", amount: 1000, day: 5, from_month: null, to_month: "2025-12" }],
    });
    const days = project(data, 1); // Ocak 2026'dan itibaren — to_month'tan sonra, hiç işlemez
    expect(days.every((d) => d.net === 0)).toBe(true);
  });

  it("kredi taksiti ödeme gününde düşer ve toplam taksit bitince projeksiyondan çıkar", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      loans: [{ id: 1, name: "Kredi", amount: 500, first_date: "2026-01-01", total: 2 }],
    });
    const days = project(data, 3);
    const jan1 = days.find((d) => d.k === "2026-01-01")!;
    expect(jan1.net).toBe(-500); // ilk taksit bugün düşer
    const feb1 = days.find((d) => d.k === "2026-02-01")!;
    expect(feb1.net).toBe(-500); // ikinci (son) taksit
    const mar1 = days.find((d) => d.k === "2026-03-01")!;
    expect(mar1.net).toBe(0); // kredi bitti, projeksiyondan düştü
  });

  it("tek seferlik kalem yalnızca kendi tarihinde işlenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      oneoffs: [{ id: 1, date: "2026-01-10", name: "Prim", amount: 2000 }],
    });
    const days = project(data, 1);
    const hit = days.find((d) => d.k === "2026-01-10")!;
    expect(hit.net).toBe(2000);
    expect(days.filter((d) => d.net !== 0)).toHaveLength(1);
  });

  it("kart ekstresi son ödeme tarihinde gider olarak düşer", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      cards: [{ id: 1, name: "Kart", limit_amount: 10000, statement_day: 15, due_day: 5 }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-01-10", name: "Market", amount: 300, installments: 1 }],
    });
    // kesim: 15 Ocak (harcama 10 Ocak, kesimden önce); son ödeme: 5 Şubat
    const days = project(data, 2);
    const due = days.find((d) => d.k === "2026-02-05")!;
    expect(due.net).toBe(-300);
  });

  it("portföy değeri güncel fiyatla o günün toplam varlığına eklenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 1000 }],
      trades: [{ id: 1, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100, fee: 0 }],
      prices: [{ symbol: "THYAO", asset_type: "BIST", price: 120, source: "manual", updated_at: "2026-01-01" }],
    });
    const days = project(data, 1);
    expect(days[0].assets).toBe(1200);
    expect(days[0].total).toBe(1000 + 1200);
  });
});
