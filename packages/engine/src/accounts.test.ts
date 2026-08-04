import { describe, it, expect } from "vitest";
import { accountLedger, ledgerDrift, ledgerSummary, reconcileDiff, reconStatus, entriesSinceRecon, accountKindOf } from "./accounts.js";
import type { Account, AccountEntry } from "./types.js";

const e = (id: number, account_id: number, date: string, amount: number, note = ""): AccountEntry => ({
  id, account_id, date, amount, kind: "islem", source_table: null, source_id: null, note, created_at: "",
});

describe("accountLedger", () => {
  it("yürüyen bakiyeyi kronolojik toplar, listeyi yeniden eskiye döndürür", () => {
    const rows = accountLedger([e(2, 1, "2026-02-01", -300), e(1, 1, "2026-01-01", 1000)], 1);
    expect(rows.map((r) => [r.entry.id, r.balanceAfter])).toEqual([[2, 700], [1, 1000]]);
  });

  it("aynı gündeki hareketleri id sırasına göre çözer", () => {
    const rows = accountLedger([e(3, 1, "2026-01-01", -50), e(1, 1, "2026-01-01", 100), e(2, 1, "2026-01-01", -20)], 1);
    expect(rows.map((r) => [r.entry.id, r.balanceAfter])).toEqual([[3, 30], [2, 80], [1, 100]]);
  });

  it("aynı tarihte açılış bakiyesini önce sayar (dolumda id'si en büyük olsa bile)", () => {
    const opening: AccountEntry = { ...e(9, 1, "2026-01-01", 1250), kind: "acilis", note: "Açılış bakiyesi" };
    const rows = accountLedger([e(1, 1, "2026-01-01", 45000), opening], 1);
    expect(rows.map((r) => [r.entry.kind, r.balanceAfter])).toEqual([["islem", 46250], ["acilis", 1250]]);
  });

  it("yalnız istenen hesabın hareketlerini alır", () => {
    const rows = accountLedger([e(1, 1, "2026-01-01", 100), e(2, 2, "2026-01-02", 999)], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceAfter).toBe(100);
  });

  it("hareketi olmayan hesapta boş defter verir", () => {
    expect(accountLedger([e(1, 2, "2026-01-01", 5)], 1)).toEqual([]);
  });

  it("son satırın bakiyesi hareketlerin toplamına eşittir (defterin değişmez kuralı)", () => {
    const entries = [e(1, 1, "2026-01-01", 1000), e(2, 1, "2026-01-05", -250.5), e(3, 1, "2026-03-02", 40.25)];
    const rows = accountLedger(entries, 1);
    expect(rows[0].balanceAfter).toBeCloseTo(entries.reduce((s, x) => s + x.amount, 0), 10);
  });
});

describe("ledgerDrift", () => {
  it("defter bakiyeyi açıklıyorsa 0 verir", () => {
    const entries = [e(1, 1, "2026-01-01", 1000), e(2, 1, "2026-01-05", -250)];
    expect(ledgerDrift(entries, { id: 1, name: "A", balance: 750 })).toBe(0);
  });

  it("açıklanamayan fark varsa onu verir (sessizce düzeltmez)", () => {
    expect(ledgerDrift([e(1, 1, "2026-01-01", 1000)], { id: 1, name: "A", balance: 1200 })).toBe(200);
  });
});

describe("ledgerSummary", () => {
  it("giren/çıkan/net toplar", () => {
    const rows = accountLedger([e(1, 1, "2026-01-01", 1000), e(2, 1, "2026-01-02", -300), e(3, 1, "2026-01-03", -100)], 1);
    expect(ledgerSummary(rows)).toEqual({ in: 1000, out: 400, net: 600 });
  });
});

describe("mutabakat (Faz 16)", () => {
  const acc = (o: Partial<Account> = {}): Account => ({ id: 1, name: "A", balance: 1000, ...o });

  it("fark = gerçek − kayıtlı; eksik harcama negatif çıkar", () => {
    expect(reconcileDiff(acc(), 950)).toBe(-50);
    expect(reconcileDiff(acc(), 1075.25)).toBeCloseTo(75.25, 10);
    expect(reconcileDiff(acc(), 1000)).toBe(0);
  });

  it("hiç mutabakat yapılmamışsa 'hic'", () => {
    expect(reconStatus(acc(), "2026-08-04")).toBe("hic");
  });

  it("eşik içindeki doğrulama güncel, dışındaki bayat", () => {
    expect(reconStatus(acc({ last_recon_date: "2026-07-20" }), "2026-08-04")).toBe("guncel");
    expect(reconStatus(acc({ last_recon_date: "2026-06-01" }), "2026-08-04")).toBe("bayat");
    // tam sınır (30 gün önce) hâlâ güncel sayılır
    expect(reconStatus(acc({ last_recon_date: "2026-07-05" }), "2026-08-04")).toBe("guncel");
  });

  it("son mutabakattan bu yanaki hareketleri yeniden eskiye verir", () => {
    const entries = [e(1, 1, "2026-06-01", 100), e(2, 1, "2026-07-10", -40), e(3, 1, "2026-07-20", -10), e(4, 2, "2026-07-15", 5)];
    const rows = entriesSinceRecon(entries, acc({ last_recon_date: "2026-07-10" }));
    expect(rows.map((r) => r.id)).toEqual([3, 2]); // 1 eski, 4 başka hesap
  });

  it("hiç mutabakat yoksa tüm hareketler penceredir", () => {
    expect(entriesSinceRecon([e(1, 1, "2026-06-01", 100), e(2, 1, "2026-07-10", -40)], acc())).toHaveLength(2);
  });

  it("tür verilmemiş hesap banka sayılır (geriye dönük uyum)", () => {
    expect(accountKindOf(acc())).toBe("banka");
    expect(accountKindOf(acc({ kind: "nakit" }))).toBe("nakit");
  });
});
