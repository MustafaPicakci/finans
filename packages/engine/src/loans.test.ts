import { describe, it, expect } from "vitest";
import { loanRemaining, loanActiveOn, loanPayDay } from "./loans.js";
import type { Loan } from "./types.js";

const loan: Loan = { id: 1, name: "İhtiyaç kredisi", amount: 1000, first_date: "2026-01-15", total: 12 };

describe("loanRemaining", () => {
  it("ilk taksit gününden önce hiç taksit ödenmemiştir", () => {
    expect(loanRemaining(loan, new Date(2026, 0, 14))).toBe(12);
  });
  it("ilk taksit gününde bir taksit düşer", () => {
    expect(loanRemaining(loan, new Date(2026, 0, 15))).toBe(11);
  });
  it("aylar geçtikçe kalan taksit azalır", () => {
    expect(loanRemaining(loan, new Date(2026, 5, 20))).toBe(6); // Ocak-Haziran arası 6 taksit ödendi
  });
  it("toplam taksit sayısını geçtikten sonra 0'da kalır (negatife düşmez)", () => {
    expect(loanRemaining(loan, new Date(2028, 0, 1))).toBe(0);
  });
  it("kısa ayda ödeme günü ay sonuna kayar", () => {
    const l: Loan = { id: 2, name: "Ay sonu kredi", amount: 500, first_date: "2026-01-31", total: 6 };
    // Şubat'ta 31 yok → 28'e kayar; 28 Şubat'ta bir taksit daha düşmüş olmalı
    expect(loanRemaining(l, new Date(2026, 1, 28))).toBe(4);
  });
});

describe("loanActiveOn", () => {
  it("ilk taksitten önce aktif değildir", () => {
    expect(loanActiveOn(loan, new Date(2025, 11, 1))).toBe(false);
  });
  it("son taksit ayında hâlâ aktiftir", () => {
    expect(loanActiveOn(loan, new Date(2026, 11, 1))).toBe(true); // 12. ay (Ocak dahil 12 ay = Aralık)
  });
  it("son taksitten sonraki ay aktif değildir", () => {
    expect(loanActiveOn(loan, new Date(2027, 0, 1))).toBe(false);
  });
});

describe("loanPayDay", () => {
  it("ilk taksit tarihinin gününü döner", () => {
    expect(loanPayDay(loan)).toBe(15);
  });
});
