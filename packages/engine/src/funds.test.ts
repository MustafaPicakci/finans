import { describe, it, expect } from "vitest";
import { cashFundSymbols, cashFundHoldings, cashGap, fundSellSuggestion } from "./funds.js";
import { qtyFromAmount, amountFromQty } from "./portfolio.js";
import type { AllData, Day, Trade } from "./index.js";

const day = (i: number, bal: number): Day => {
  const date = new Date(2026, 7, 4 + i); date.setHours(0, 0, 0, 0);
  return { date, k: "", net: 0, bal, assets: 0, cashFunds: 0, deposits: 0, total: bal, ev: [] };
};
const trade = (o: Partial<Trade>): Trade => ({
  id: 1, date: "2026-07-01", asset_type: "FON", symbol: "TPP", side: "ALIŞ",
  qty: 1_000_000, price: 0.05, fee: 0, currency: "TRY", ...o,
} as Trade);
const data = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [{ symbol: "TPP", asset_type: "FON", price: 0.05, source: "auto", updated_at: "", currency: "TRY" }] as AllData["prices"],
  price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: { cash_funds: "TPP" }, recurring_amounts: [], account_entries: [], transfers: [],
  ...over,
});

describe("qtyFromAmount / amountFromQty (Faz 17)", () => {
  it("tutardan adet: alışta hesaptan çıkan para tutara eşit olur", () => {
    // 50.000 ₺ fona atıldı, NAV 0,05 → 1.000.000 adet; hesaptan çıkan = qty*price + fee = 50.000
    const q = qtyFromAmount("ALIŞ", 50_000, 0.05);
    expect(q).toBeCloseTo(1_000_000, 6);
    expect(amountFromQty("ALIŞ", q, 0.05)).toBeCloseTo(50_000, 6);
  });

  it("satışta hesaba GİREN para tutara eşit olur (komisyon dahil)", () => {
    // "12.400 ₺ lazım": komisyon 100 ise brüt 12.500 satılmalı ki hesaba 12.400 girsin
    const q = qtyFromAmount("SATIŞ", 12_400, 0.05, 100);
    expect(q * 0.05 - 100).toBeCloseTo(12_400, 6);
    expect(amountFromQty("SATIŞ", q, 0.05, 100)).toBeCloseTo(12_400, 6);
  });

  it("alışta komisyon adetten düşülür (toplam çıkış sabit kalır)", () => {
    const q = qtyFromAmount("ALIŞ", 50_000, 0.05, 250);
    expect(q * 0.05 + 250).toBeCloseTo(50_000, 6);
    expect(q).toBeLessThan(1_000_000);
  });

  it("gidiş-dönüş her iki yönde de kayıpsız", () => {
    for (const side of ["ALIŞ", "SATIŞ"] as const) {
      expect(qtyFromAmount(side, amountFromQty(side, 1234.5678, 0.043210, 12), 0.043210, 12)).toBeCloseTo(1234.5678, 6);
    }
  });

  it("geçersiz girdi 0 verir (fiyat 0, negatif/komisyonu aşan tutar)", () => {
    expect(qtyFromAmount("ALIŞ", 50_000, 0)).toBe(0);
    expect(qtyFromAmount("ALIŞ", -5, 0.05)).toBe(0);
    expect(qtyFromAmount("ALIŞ", 100, 0.05, 100)).toBe(0); // komisyon tutarı yiyor
    expect(amountFromQty("ALIŞ", 0, 0.05)).toBe(0);
  });
});

describe("cashFundSymbols / cashFundHoldings", () => {
  it("ayardan sembolleri okur, boşlukları kırpar, büyük harfe çevirir", () => {
    expect(cashFundSymbols({ cash_funds: " tpp , AFA ,, " })).toEqual(new Set(["TPP", "AFA"]));
    expect(cashFundSymbols({})).toEqual(new Set());
  });

  it("elde tutulanı alış−satış ile bulur ve TRY değerini verir", () => {
    const d = data({ trades: [trade({}), trade({ id: 2, side: "SATIŞ", qty: 200_000 })] });
    expect(cashFundHoldings(d)).toEqual([{ symbol: "TPP", qty: 800_000, price: 0.05, valueTry: 40_000 }]);
  });

  it("nakit sayılmayan fonu ve kapanmış pozisyonu dışlar", () => {
    expect(cashFundHoldings(data({ trades: [trade({ symbol: "XYZ" })] }))).toEqual([]);
    expect(cashFundHoldings(data({ trades: [trade({}), trade({ id: 2, side: "SATIŞ", qty: 1_000_000 })] }))).toEqual([]);
  });

  it("fiyatı bilinmeyen fon önerilemez (tutar hesaplanamaz)", () => {
    expect(cashFundHoldings(data({ trades: [trade({})], prices: [] }))).toEqual([]);
  });

  it("büyükten küçüğe sıralar", () => {
    const d = data({
      settings: { cash_funds: "TPP,AFA" },
      trades: [trade({}), trade({ id: 2, symbol: "AFA", qty: 3_000_000 })],
      prices: [
        { symbol: "TPP", asset_type: "FON", price: 0.05, source: "auto", updated_at: "", currency: "TRY" },
        { symbol: "AFA", asset_type: "FON", price: 0.05, source: "auto", updated_at: "", currency: "TRY" },
      ] as AllData["prices"],
    });
    expect(cashFundHoldings(d).map((h) => h.symbol)).toEqual(["AFA", "TPP"]);
  });
});

describe("cashGap", () => {
  it("nakit hiç eksiye düşmezse öneri yok", () => {
    expect(cashGap([day(0, 5000), day(1, 3000), day(2, 100)])).toBeNull();
  });

  it("tutarı EN DERİN noktadan alır, tarihi ilk eksi günden", () => {
    // ilk eksi 1. gün (−2.000) ama 3. gün −9.000 → 2.000 bozmak yetmez
    const g = cashGap([day(0, 500), day(1, -2000), day(2, -5000), day(3, -9000)])!;
    expect(g.amount).toBe(9000);
    expect(g.firstNegative.bal).toBe(-2000);
    expect(g.deepest.bal).toBe(-9000);
  });

  it("pencere dışındaki açığı görmez", () => {
    const days = [day(0, 100), day(1, 100), day(2, 100), day(3, -8000)];
    expect(cashGap(days, 2)).toBeNull();
    expect(cashGap(days, 3)!.amount).toBe(8000);
  });

  it("bugün zaten eksideyse bugünü döndürür", () => {
    expect(cashGap([day(0, -1500)])!.amount).toBe(1500);
  });
});

describe("fundSellSuggestion", () => {
  const days = [day(0, 500), day(1, 500), day(2, -12_400)];

  it("açığı kapatacak tutarı en büyük fondan önerir, bir gün önceye tarihler", () => {
    const s = fundSellSuggestion(days, data({ trades: [trade({})] }))!;
    expect(s.amount).toBe(12_400);
    expect(s.fund.symbol).toBe("TPP");
    expect(s.covered).toBe(true);
    expect(s.sellBy.getDate()).toBe(days[2].date.getDate() - 1); // açık gününden 1 gün önce
  });

  it("fon açığı karşılamıyorsa tutar fonla sınırlanır ve covered false olur", () => {
    const s = fundSellSuggestion(days, data({ trades: [trade({ qty: 100_000 })] }))!; // 5.000 ₺
    expect(s.amount).toBe(5000);
    expect(s.covered).toBe(false);
  });

  it("açık yoksa veya nakit fon yoksa öneri yok", () => {
    expect(fundSellSuggestion([day(0, 9999)], data({ trades: [trade({})] }))).toBeNull();
    expect(fundSellSuggestion(days, data({ settings: {} , trades: [trade({})] }))).toBeNull();
  });

  it("açık bugünse satış tarihi geçmişe kaymaz (bugün kalır)", () => {
    const s = fundSellSuggestion([day(0, -3000)], data({ trades: [trade({})] }))!;
    expect(s.sellBy.getTime()).toBe(day(0, 0).date.getTime());
  });
});
