import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { project } from "./projection.js";
import type { AllData } from "./types.js";

const baseData = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], cards: [], card_txs: [], prices: [], price_history: [],
  categories: [], transactions: [], deposits: [], recurring_realized: [], statement_payments: [], settings: {}, recurring_amounts: [],
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
      recurring: [{ id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 5000 }],
    });
    const days = project(data, 1);
    const payDay = days.find((d) => d.date.getDate() === 15 && d.date.getMonth() === 0);
    expect(payDay!.net).toBe(5000);
    expect(payDay!.ev).toEqual([{ n: "Maaş", a: 5000 }]);
    // ödeme gününden sonraki bakiye kalıcı olarak artmış olmalı
    expect(days[days.length - 1].bal).toBe(5000);
  });

  it("gerçekleşmiş (kalem, ay) çifti tahminde tekrar işlenmez, diğer aylar işlenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 5000 }],
      recurring_realized: [{ recurring_id: 1, ym: "2026-01" }], // Ocak gerçekleşti
    });
    const days = project(data, 2); // Ocak + Şubat
    const jan = days.find((d) => d.date.getMonth() === 0 && d.date.getDate() === 15)!;
    const feb = days.find((d) => d.date.getMonth() === 1 && d.date.getDate() === 15)!;
    expect(jan.ev).toEqual([]);            // Ocak gerçekleşti → tahminde yok (çift sayım engellendi)
    expect(feb.ev).toEqual([{ n: "Maaş", a: 5000 }]); // Şubat hâlâ tahminde
  });

  it("from_month/to_month aralığı dışındaki aylarda düzenli kalem işlemez", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "expense", name: "Eski kira", day: 5, from_month: null, to_month: "2025-12" }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 1000 }],
    });
    const days = project(data, 1); // Ocak 2026'dan itibaren — to_month'tan sonra, hiç işlemez
    expect(days.every((d) => d.net === 0)).toBe(true);
  });

  it("tutar zaman çizelgesi: değişiklik ayından itibaren yeni tutar işlenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null }],
      recurring_amounts: [
        { recurring_id: 1, from_month: "0000-01", amount: 5000 },
        { recurring_id: 1, from_month: "2026-02", amount: 6000 }, // Şubat'tan itibaren zam
      ],
    });
    const days = project(data, 2); // Ocak + Şubat
    const jan = days.find((d) => d.date.getMonth() === 0 && d.date.getDate() === 15)!;
    const feb = days.find((d) => d.date.getMonth() === 1 && d.date.getDate() === 15)!;
    expect(jan.net).toBe(5000); // eski tutar
    expect(feb.net).toBe(6000); // yeni tutar
  });

  it("tutar satırı olmayan düzenli kalem hiç event üretmez", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      recurring: [{ id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null }],
      // recurring_amounts bilinçli boş — tutarı tanımsız kalem savunmayla atlanır
    });
    const days = project(data, 1);
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

  it("ödendi işaretlenen kart ekstresi projeksiyonda gider olarak düşmez", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      cards: [{ id: 1, name: "Kart", limit_amount: 10000, statement_day: 15, due_day: 5 }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-01-10", name: "Market", amount: 300, installments: 1 }],
      statement_payments: [{ card_id: 1, due: "2026-02-05" }], // ekstre ödendi (transactions'a yazıldı)
    });
    const days = project(data, 2);
    const due = days.find((d) => d.k === "2026-02-05")!;
    expect(due.net).toBe(0); // tekrar düşülmez — çift sayım engellendi
  });

  it("portföy değeri güncel fiyatla o günün toplam varlığına eklenir", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 1000 }],
      trades: [{ id: 1, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100, fee: 0, currency: "TRY" }],
      prices: [{ symbol: "THYAO", asset_type: "BIST", price: 120, source: "manual", updated_at: "2026-01-01" }],
    });
    const days = project(data, 1);
    expect(days[0].assets).toBe(1200);
    expect(days[0].total).toBe(1000 + 1200);
  });

  it("para piyasası fonu (settings.cash_funds) nakit sayılır: cashFunds dolar, assets'e de girer", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 1000 }],
      trades: [
        { id: 1, date: "2026-01-01", asset_type: "FON", symbol: "AFA", side: "ALIŞ", qty: 100, price: 10, fee: 0, currency: "TRY" },
        { id: 2, date: "2026-01-01", asset_type: "FON", symbol: "TTE", side: "ALIŞ", qty: 50, price: 20, fee: 0, currency: "TRY" },
      ],
      prices: [
        { symbol: "AFA", asset_type: "FON", price: 12, source: "manual", updated_at: "2026-01-01" },
        { symbol: "TTE", asset_type: "FON", price: 20, source: "manual", updated_at: "2026-01-01" },
      ],
      settings: { cash_funds: "AFA" }, // yalnız AFA nakit sayılır
    });
    const days = project(data, 1);
    expect(days[0].cashFunds).toBe(100 * 12); // 1200 — sadece AFA
    expect(days[0].assets).toBe(100 * 12 + 50 * 20); // 2200 — tüm fonlar
    expect(days[0].bal + days[0].cashFunds).toBe(1000 + 1200); // etkin nakit
  });

  it("cash_funds boşsa cashFunds sıfırdır", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 0 }],
      trades: [{ id: 1, date: "2026-01-01", asset_type: "FON", symbol: "AFA", side: "ALIŞ", qty: 100, price: 10, fee: 0, currency: "TRY" }],
      prices: [{ symbol: "AFA", asset_type: "FON", price: 12, source: "manual", updated_at: "2026-01-01" }],
    });
    const days = project(data, 1);
    expect(days[0].cashFunds).toBe(0);
    expect(days[0].assets).toBe(1200);
  });

  it("USD-doğal varlık güncel FX ile TRY'ye çevrilerek toplam varlığa girer", () => {
    const data = baseData({
      accounts: [{ id: 1, name: "Vadesiz", balance: 1000 }],
      trades: [{ id: 1, date: "2026-01-01", asset_type: "ETF", symbol: "VOO", side: "ALIŞ", qty: 2, price: 150, fee: 0, currency: "USD" }],
      prices: [{ symbol: "VOO", asset_type: "ETF", price: 180, source: "auto", updated_at: "2026-01-01", currency: "USD" }],
    });
    const days = project(data, 1, { usdTry: 40 });
    expect(days[0].assets).toBe(2 * 180 * 40); // 14400 TRY
    expect(days[0].total).toBe(1000 + 14400);
  });
});
