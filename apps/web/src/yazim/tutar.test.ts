import { describe, it, expect } from "vitest";
import { tutarTamamla } from "./tutar";
import type { AllData } from "@finans/engine";

/* Bu dosyanın koruduğu şey: sunucunun eskiden kendi hesapladığı tutarların istemcideki
   TEK kopyası. Aşama 5a'da sunucu yedekleri silindi — buradaki bir hata artık sunucu
   tarafından düzeltilmez, doğrudan deftere yanlış tutar yazar. */

const bos = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [], ...over,
});

describe("portföy işlemi", () => {
  const govde = { date: "2026-09-26", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100, fee: 5, currency: "TRY", account_id: 1 };
  it("ALIŞ hesaptan (qty×price + komisyon) düşer", () => {
    expect(tutarTamamla("POST", "/trades", govde, bos()).entry_amount).toBe(-1005);
  });
  it("SATIŞ hesaba (qty×price − komisyon) girer", () => {
    expect(tutarTamamla("POST", "/trades", { ...govde, side: "SATIŞ", qty: 5, price: 120, fee: 3 }, bos()).entry_amount).toBe(597);
  });
  it("PUT /trades/:id aynı kural", () => {
    expect(tutarTamamla("PUT", "/trades/7", govde, bos()).entry_amount).toBe(-1005);
  });
  it("hesapsız ya da USD işlemde hesap etkisi YOK (sunucudaki `affects` kuralı)", () => {
    expect(tutarTamamla("POST", "/trades", { ...govde, account_id: null }, bos()).entry_amount).toBeUndefined();
    expect(tutarTamamla("POST", "/trades", { ...govde, currency: "USD" }, bos()).entry_amount).toBeUndefined();
  });
  it("formun ZATEN gönderdiği değere dokunmaz", () => {
    expect(tutarTamamla("POST", "/trades", { ...govde, entry_amount: -999 }, bos()).entry_amount).toBe(-999);
  });
  it("/trades/:id/portfolio (grup taşıma) tutar üretmez", () => {
    expect(tutarTamamla("PUT", "/trades/7/portfolio", { portfolio_id: 2 }, bos())).toEqual({ portfolio_id: 2 });
  });
});

describe("vadeli mevduat", () => {
  it("açılışta anapara hesaptan ÇIKAR", () => {
    expect(tutarTamamla("POST", "/deposits", { principal: 5000, account_id: 1 }, bos()).entry_amount).toBe(-5000);
    expect(tutarTamamla("PUT", "/deposits/3", { principal: "7500" }, bos()).entry_amount).toBe(-7500);
  });
});

describe("ekstre ödemesi", () => {
  const card = { id: 5, name: "K", limit_amount: 5e4, statement_day: 25, due_day: 10, pay_account_id: null };
  const tx = (id: number, date: string, amount: number, installments = 1) => ({ id, card_id: 5, date, name: "x", amount, installments });
  it("o vadeye düşen taksit paylarının toplamı", () => {
    const d = bos({ cards: [card], card_txs: [tx(1, "2026-08-10", 1000), tx(2, "2026-08-12", 1200, 3)] });
    expect(tutarTamamla("POST", "/cards/5/pay-statement", { due: "2026-09-10" }, d).amount).toBe(1400);
  });
  it("başka kartın harcaması karışmaz", () => {
    const d = bos({ cards: [card], card_txs: [tx(1, "2026-08-10", 1000), { ...tx(2, "2026-08-10", 500), card_id: 9 }] });
    expect(tutarTamamla("POST", "/cards/5/pay-statement", { due: "2026-09-10" }, d).amount).toBe(1000);
  });
});

describe("düzenli kalem gerçekleştirme — işaret, sunucunun dalıyla birebir", () => {
  const rec = (o: object) => ({ id: 1, kind: "expense", name: "Kira", day: 5, from_month: null, to_month: null, account_id: 1, card_id: null, ...o });
  const veri = (o: object) => bos({ recurring: [rec(o)] as any, recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 3000 }] });
  it("gider hesaba → EKSİ", () => expect(tutarTamamla("POST", "/recurring/1/realize", { ym: "2026-09" }, veri({})).amount).toBe(-3000));
  it("gelir → ARTI", () => expect(tutarTamamla("POST", "/recurring/1/realize", { ym: "2026-09" }, veri({ kind: "income" })).amount).toBe(3000));
  it("gider KARTA → ARTI (ekstre borcu büyür)", () =>
    expect(tutarTamamla("POST", "/recurring/1/realize", { ym: "2026-09" }, veri({ account_id: null, card_id: 7 })).amount).toBe(3000));
  it("o ay tutar tanımlı değilse alan boş kalır (sunucu reddeder, 0 yazılmaz)", () => {
    const d = bos({ recurring: [rec({})] as any, recurring_amounts: [{ recurring_id: 1, from_month: "2026-10", amount: 3000 }] });
    expect(tutarTamamla("POST", "/recurring/1/realize", { ym: "2026-09" }, d).amount).toBeUndefined();
  });
});

describe("mutabakat", () => {
  it("fark = gerçek − defterden türeyen bakiye", () => {
    const d = bos({ account_entries: [{ id: 1, account_id: 2, date: "2026-01-01", amount: 1000, kind: "acilis", source_table: null, source_id: null, note: "", created_at: "" }] });
    expect(tutarTamamla("POST", "/accounts/2/reconcile", { balance: 1250 }, d).diff).toBe(250);
  });
});

describe("genel", () => {
  it("veri yoksa gövdeye dokunmaz", () => {
    expect(tutarTamamla("POST", "/deposits", { principal: 5000 }, null)).toEqual({ principal: 5000 });
  });
  it("tanımadığı uca dokunmaz", () => {
    expect(tutarTamamla("POST", "/transactions", { amount: -10, name: "x" }, bos())).toEqual({ amount: -10, name: "x" });
  });
});
