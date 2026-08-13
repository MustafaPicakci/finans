import { describe, it, expect } from "vitest";
import { setupGaps } from "./setup.js";
import type { AllData, Account, Trade } from "./types.js";

const acc = (id: number, over: Partial<Account> = {}): Account =>
  ({ id, name: `H${id}`, balance: 1000, kind: "banka", ...over });
const trade = (over: Partial<Trade> = {}): Trade =>
  ({ id: 1, date: "2026-06-01", asset_type: "FON", symbol: "TP2", side: "ALIŞ", qty: 100, price: 2, fee: 0, currency: "TRY", ...over });

const data = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [],
  ...over,
} as AllData);

const keys = (d: AllData) => setupGaps(d, "2026-08-12").map((g) => g.key);

describe("setupGaps", () => {
  it("hiç hesabı olmayana hiçbir şey önermez (asıl eksik onboarding'in işi)", () => {
    expect(keys(data())).toEqual([]);
  });

  it("nakit hesabı yoksa uyarır; varsa susar", () => {
    expect(keys(data({ accounts: [acc(1, { last_recon_date: "2026-08-01" })] }))).toContain("nakit-hesap");
    expect(keys(data({ accounts: [acc(1, { last_recon_date: "2026-08-01" }), acc(2, { kind: "nakit", last_recon_date: "2026-08-01" })] })))
      .not.toContain("nakit-hesap");
  });

  it("aracı kurum hesabını YALNIZ portföy işlemi olana önerir", () => {
    const hesaplar = [acc(1, { kind: "nakit", last_recon_date: "2026-08-01" })];
    expect(keys(data({ accounts: hesaplar }))).not.toContain("araci-hesap");
    expect(keys(data({ accounts: hesaplar, trades: [trade()] }))).toContain("araci-hesap");
  });

  it("hiç mutabakat yapılmamış hesap varsa uyarır; hepsi doğrulanmışsa susar", () => {
    expect(keys(data({ accounts: [acc(1, { kind: "nakit" })] }))).toContain("mutabakat");
    expect(keys(data({ accounts: [acc(1, { kind: "nakit", last_recon_date: "2026-01-01" })] }))) // bayat ama YAPILMIŞ
      .not.toContain("mutabakat");
  });

  it("nakit sayılan fon önerisi yalnız ELDE fon tutana çıkar", () => {
    const base = { accounts: [acc(1, { kind: "nakit", last_recon_date: "2026-08-01" })] };
    expect(keys(data({ ...base, trades: [trade()] }))).toContain("nakit-fon");
    // tamamı satıldıysa öneri anlamsız
    expect(keys(data({ ...base, trades: [trade(), trade({ id: 2, side: "SATIŞ", date: "2026-07-01" })] })))
      .not.toContain("nakit-fon");
    // hisse tutmak fon önerisini tetiklemez
    expect(keys(data({ ...base, trades: [trade({ asset_type: "BIST", symbol: "ASELS" })] }))).not.toContain("nakit-fon");
    // zaten işaretliyse susar
    expect(keys(data({ ...base, trades: [trade()], settings: { cash_funds: "TP2" } }))).not.toContain("nakit-fon");
  });

  it("her eksik kullanıcıya gidecek sekmeyi ve tek satırlık gerekçesini taşır", () => {
    for (const g of setupGaps(data({ accounts: [acc(1)], trades: [trade()] }), "2026-08-12")) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.detail.length).toBeGreaterThan(20); // "neden önemli" boş geçilmesin
      expect(["hesaplar", "portfoy"]).toContain(g.tab);
    }
  });
});
