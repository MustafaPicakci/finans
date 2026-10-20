import { describe, it, expect } from "vitest";
import { clampDay, firstCutoff, dueOf, txShares, cardInfos, stmtKey, statementAmount, ekstreOdemeleri, acikDonem, ekstreDetayi } from "./cards.js";
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
  /* Gözlenen hata: asistan taksiti göndermedi, zarf `installments: null` yazdı — harcama listede
     görünüp hiçbir ekstreye ve borca girmiyordu. Mevcut bozuk kayıtlar da doğru ekstreye düşmeli. */
  it("taksit sayısı boş/geçersizse harcama TEK ÇEKİM sayılır (kaybolmaz)", () => {
    for (const bozuk of [null, undefined, 0, NaN, "abc"]) {
      const tx = { id: 3, card_id: 1, date: "2026-06-10", name: "Otobüs", amount: 2000, installments: bozuk } as unknown as CardTx;
      const shares = txShares(tx, card);
      expect(shares).toHaveLength(1);
      expect(shares[0].amount).toBe(2000);
      expect(shares[0].total).toBe(1);
    }
    const tx = { id: 3, card_id: 1, date: "2026-06-10", name: "Otobüs", amount: 2000, installments: null } as unknown as CardTx;
    expect(cardInfos([card], [tx], new Date(2026, 5, 15))[0].debt).toBe(2000);
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
  it("ödendi işaretlenen ekstre listede kalır (paid) ama borca ve sıradakine sayılmaz", () => {
    const today = new Date(2026, 5, 1); // 1 Haziran
    const txs: CardTx[] = [
      { id: 1, card_id: 1, date: "2026-06-10", name: "A", amount: 300, installments: 2 }, // 5 Tem + 5 Ağu ekstreleri
    ];
    // 5 Temmuz ekstresi ödendi
    const paid = new Set([stmtKey(1, "2026-07-05")]);
    const [info] = cardInfos([card], txs, today, paid);
    expect(info.statements).toHaveLength(2);
    expect(info.statements[0].paid).toBe(true);
    expect(info.statements[1].paid).toBe(false);
    expect(info.debt).toBeCloseTo(150);           // yalnız ödenmemiş pay
    expect(info.nextDue).toEqual(new Date(2026, 7, 5)); // sıradaki = ilk ÖDENMEMİŞ ekstre
    expect(info.nextAmount).toBeCloseTo(150);
  });
  it("ödenmiş ekstreye sonradan düşen harcama borca EKSİK olarak girer (sessizce yutulmaz)", () => {
    const today = new Date(2026, 5, 1);
    const txs: CardTx[] = [
      { id: 1, card_id: 1, date: "2026-06-10", name: "A", amount: 300, installments: 1 },
      { id: 2, card_id: 1, date: "2026-06-12", name: "B", amount: 200, installments: 1 }, // ödemeden sonra
    ];
    const [info] = cardInfos([card], txs, today, new Map([[stmtKey(1, "2026-07-05"), 300]]));
    expect(info.statements[0]).toMatchObject({ paid: true, amount: 500, eksik: 200 });
    expect(info.debt).toBeCloseTo(200);
    // tamamı ödendiyse ya da tutar bilinmiyorsa eksik yok; kuruş yuvarlaması eksik sayılmaz
    for (const odenen of [500, 499.995, null]) {
      expect(cardInfos([card], txs, today, new Map([[stmtKey(1, "2026-07-05"), odenen]]))[0].debt).toBe(0);
    }
  });
  it("ekstreOdemeleri: ödenen tutar ödemenin gider kaydından okunur, kayıt yoksa bilinmez", () => {
    const m = ekstreOdemeleri({
      statement_payments: [{ card_id: 1, due: "2026-07-05", tx_id: 9 }, { card_id: 1, due: "2026-08-05", tx_id: null }, { card_id: 2, due: "2026-07-05" }],
      transactions: [{ id: 9, date: "2026-06-20", name: "Kart ekstresi", amount: -300, category_id: null, account_id: 1 }],
    });
    expect(m.get(stmtKey(1, "2026-07-05"))).toBe(300);
    expect(m.get(stmtKey(1, "2026-08-05"))).toBeNull();
    expect(m.has(stmtKey(2, "2026-07-05"))).toBe(true);
  });
  it("açık dönem: kesim günü (dahil) gelmeden ekstre kesinleşmez", () => {
    const [info] = cardInfos([card], [{ id: 1, card_id: 1, date: "2026-06-10", name: "A", amount: 100, installments: 1 }], new Date(2026, 5, 1));
    expect(info.statements[0].cut).toEqual(new Date(2026, 5, 15));
    expect(acikDonem(info.statements[0], new Date(2026, 5, 15))).toBe(true);  // kesim günü harcama alır
    expect(acikDonem(info.statements[0], new Date(2026, 5, 16))).toBe(false);
  });
});

describe("statementAmount", () => {
  const txs: CardTx[] = [
    { id: 1, card_id: 1, date: "2026-06-10", name: "A", amount: 300, installments: 2 }, // 5 Tem + 5 Ağu
    { id: 2, card_id: 1, date: "2026-06-12", name: "B", amount: 200, installments: 1 }, // 5 Tem
    { id: 3, card_id: 2, date: "2026-06-12", name: "Başka kart", amount: 999, installments: 1 },
  ];
  it("o vadeye düşen tüm taksit paylarını toplar", () => {
    expect(statementAmount(card, txs, "2026-07-05")).toBeCloseTo(350); // 150 + 200
    expect(statementAmount(card, txs, "2026-08-05")).toBeCloseTo(150); // ikinci taksit
  });
  it("başka kartın harcamasını saymaz, ekstresi olmayan vadede 0 döner", () => {
    expect(statementAmount(card, txs, "2026-09-05")).toBe(0);
  });
});

describe("ekstreDetayi", () => {
  const txs: CardTx[] = [
    { id: 1, card_id: 1, date: "2026-05-02", name: "Telefon", amount: 600, installments: 6 }, // 15 May kesim → 5 Haz, 5 Tem…
    { id: 2, card_id: 1, date: "2026-06-12", name: "Market", amount: 200, installments: 1 },  // 15 Haz kesim → 5 Tem
    { id: 3, card_id: 1, date: "2026-06-16", name: "Sonraki dönem", amount: 50, installments: 1 }, // 15 Tem kesim
    { id: 4, card_id: 2, date: "2026-06-12", name: "Başka kart", amount: 999, installments: 1 },
  ];
  it("ekstreye düşen PAYLARI dönem aralığıyla verir; toplam statementAmount ile aynı", () => {
    const e = ekstreDetayi(card, txs, "2026-07-05");
    expect(e.kesim).toEqual(new Date(2026, 5, 15));
    expect(e.donemBasi).toEqual(new Date(2026, 4, 16)); // önceki kesimin ertesi günü
    expect(e.kalemler.map((k) => [k.tx.id, k.tutar, k.idx, k.total])).toEqual([[2, 200, 1, 1], [1, 100, 2, 6]]); // yeniden eskiye
    expect(e.toplam).toBe(300);
    expect(statementAmount(card, txs, "2026-07-05")).toBe(e.toplam);
  });
  it("kalemi olmayan vadede kesim bilinmez", () => {
    expect(ekstreDetayi(card, txs, "2027-01-05")).toEqual({ kesim: null, donemBasi: null, kalemler: [], toplam: 0 });
  });
});
