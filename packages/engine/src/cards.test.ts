import { describe, it, expect } from "vitest";
import { clampDay, firstCutoff, dueOf, txShares, cardInfos } from "./cards.js";
import type { Card, CardTx } from "./types.js";

const card: Card = { id: 1, name: "Test Kart", limit_amount: 50000, statement_day: 15, due_day: 5 };

describe("clampDay", () => {
  it("kısa ayda gün sayısını aya sığdırır (Şubat 30 → 28)", () => {
    const d = clampDay(2026, 1, 30); // Şubat 2026 (index 1), 30. gün yok
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });
  it("artık yılda Şubat 29'u destekler", () => {
    const d = clampDay(2028, 1, 30);
    expect(d.getDate()).toBe(29);
  });
});

describe("firstCutoff", () => {
  it("kesim gününden önceki harcama aynı ayın kesimine düşer", () => {
    const purchase = new Date(2026, 5, 10); // 10 Haziran, kesim 15
    const c = firstCutoff(purchase, 15);
    expect(c.getMonth()).toBe(5);
    expect(c.getDate()).toBe(15);
  });
  it("kesim gününden sonraki harcama bir sonraki ayın kesimine düşer", () => {
    const purchase = new Date(2026, 5, 20); // 20 Haziran, kesim 15 geçti
    const c = firstCutoff(purchase, 15);
    expect(c.getMonth()).toBe(6);
    expect(c.getDate()).toBe(15);
  });
  it("tam kesim gününde yapılan harcama o kesime dahildir (sınır dahil)", () => {
    const purchase = new Date(2026, 5, 15);
    const c = firstCutoff(purchase, 15);
    expect(c.getMonth()).toBe(5);
    expect(c.getDate()).toBe(15);
  });
});

describe("dueOf", () => {
  it("son ödeme günü kesimden sonraysa aynı ay içindedir", () => {
    const cutoff = new Date(2026, 5, 15); // kesim: 15 Haziran
    const due = dueOf(cutoff, 25); // son ödeme: 25 (kesimden sonra)
    expect(due.getMonth()).toBe(5);
    expect(due.getDate()).toBe(25);
  });
  it("son ödeme günü kesimden önce/eşitse bir sonraki aya kayar", () => {
    const cutoff = new Date(2026, 5, 15);
    const due = dueOf(cutoff, 5); // son ödeme: 5, kesimden önce
    expect(due.getMonth()).toBe(6);
    expect(due.getDate()).toBe(5);
  });
});

describe("txShares", () => {
  it("tek çekim harcama tek paya sahiptir", () => {
    const tx: CardTx = { id: 1, card_id: 1, date: "2026-06-10", name: "Market", amount: 1000, installments: 1 };
    const shares = txShares(tx, card);
    expect(shares).toHaveLength(1);
    expect(shares[0].amount).toBe(1000);
    expect(shares[0].due).toEqual(new Date(2026, 6, 5)); // Haziran kesim → Temmuz son ödeme
  });
  it("taksitli harcama ardışık ekstrelere eşit bölünür", () => {
    const tx: CardTx = { id: 2, card_id: 1, date: "2026-06-10", name: "Telefon", amount: 3000, installments: 3 };
    const shares = txShares(tx, card);
    expect(shares).toHaveLength(3);
    shares.forEach((s) => expect(s.amount).toBeCloseTo(1000));
    // ardışık aylara yayılmalı: Temmuz, Ağustos, Eylül son ödeme
    expect(shares[0].due).toEqual(new Date(2026, 6, 5));
    expect(shares[1].due).toEqual(new Date(2026, 7, 5));
    expect(shares[2].due).toEqual(new Date(2026, 8, 5));
  });
});

describe("cardInfos", () => {
  it("geçmiş vadeli ekstreleri borca dahil etmez (ödenmiş sayılır)", () => {
    const today = new Date(2026, 7, 1); // 1 Ağustos 2026
    const txs: CardTx[] = [
      { id: 1, card_id: 1, date: "2026-01-10", name: "Eski harcama", amount: 500, installments: 1 }, // vadesi geçmiş
      { id: 2, card_id: 1, date: "2026-07-20", name: "Yeni harcama", amount: 800, installments: 1 }, // gelecekte
    ];
    const [info] = cardInfos([card], txs, today);
    expect(info.debt).toBeCloseTo(800);
  });
  it("bir güne düşen birden fazla payı tek ekstrede toplar", () => {
    const today = new Date(2026, 5, 1);
    const txs: CardTx[] = [
      { id: 1, card_id: 1, date: "2026-06-10", name: "A", amount: 100, installments: 1 },
      { id: 2, card_id: 1, date: "2026-06-12", name: "B", amount: 200, installments: 1 },
    ];
    const [info] = cardInfos([card], txs, today);
    expect(info.statements).toHaveLength(1);
    expect(info.statements[0].amount).toBeCloseTo(300);
  });
});
