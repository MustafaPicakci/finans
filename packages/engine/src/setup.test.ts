import { describe, it, expect } from "vitest";
import { setupGaps, kurulumGerekli, ilkProjeksiyon } from "./setup.js";
import type { Day } from "./projection.js";
import type { AllData, Account, Trade } from "./types.js";

/* `balance` alanı kalktı (E2EE aşama 1a); setupGaps zaten yalnız `kind` ve
   `last_recon_date` okuyor, yani bakiye bu testler için hiç anlamlı değildi. */
const acc = (id: number, over: Partial<Account> = {}): Account =>
  ({ id, name: `H${id}`, kind: "banka", ...over });
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

describe("kurulumGerekli", () => {
  it("hiçbir şey girilmemişse sihirbaz gerekir", () => {
    expect(kurulumGerekli(data())).toBe(true);
  });
  it("tek bir tanım ya da kayıt bile varsa gerekmez (kullanıcı ekranından koparılmaz)", () => {
    expect(kurulumGerekli(data({ accounts: [acc(1)] }))).toBe(false);
    expect(kurulumGerekli(data({ trades: [trade()] }))).toBe(false);
    expect(kurulumGerekli(data({ cards: [{ id: 1, name: "K", limit_amount: 0, statement_day: 1, due_day: 10 }] as AllData["cards"] }))).toBe(false);
  });
});

describe("ilkProjeksiyon", () => {
  const gun = (k: string, bal: number) => ({ k, bal } as Day);
  it("ay sonu = içinde bulunulan ayın son günü; en düşük = penceredeki en dar gün", () => {
    const days = [gun("2026-09-28", 1000), gun("2026-09-29", 400), gun("2026-09-30", 900), gun("2026-10-01", 300), gun("2026-10-02", 800)];
    expect(ilkProjeksiyon(days)).toEqual({
      bugun: 1000,
      aySonu: { k: "2026-09-30", bal: 900 },
      enDusuk: { k: "2026-10-01", bal: 300 },
    });
  });
  it("eşit en düşükte İLK gün seçilir (en erken uyarı) ve pencere dışı sayılmaz", () => {
    const days = [gun("2026-09-01", 500), gun("2026-09-02", 100), gun("2026-09-03", 100), gun("2026-09-04", -50)];
    expect(ilkProjeksiyon(days, 3)!.enDusuk).toEqual({ k: "2026-09-02", bal: 100 });
  });
  it("projeksiyon boşsa null", () => {
    expect(ilkProjeksiyon([])).toBeNull();
  });
});
