import { describe, it, expect } from "vitest";
import { kartMutabakat, mutabakatKalemi, KART_MUTABAKAT_ADI } from "./kartMutabakat.js";
import { cardInfos, statementAmount, stmtKey } from "./cards.js";
import { kartDefteri } from "./dokum.js";
import { harcamaOzeti } from "./harcama.js";
import type { AllData, Card, CardTx } from "./types.js";

// kesim 15, son ödeme 5 → bugün 10 Ekim: açık dönem 15 Eki kesimi (vade 5 Kas)
const card: Card = { id: 1, name: "Kart", limit_amount: 50000, statement_day: 15, due_day: 5 };
const bugun = new Date(2026, 9, 10);
let sira = 100;
const tx = (date: string, amount: number, installments = 1, ek: Partial<CardTx> = {}): CardTx =>
  ({ id: sira++, card_id: 1, date, name: "x", amount, installments, ...ek });
/** Kalemi yazılmış gibi listeye ekler */
const yaz = (txs: CardTx[], k: ReturnType<typeof mutabakatKalemi>) => [...txs, { id: sira++, card_id: 1, ...k }];
const borc = (txs: CardTx[], today = bugun) => cardInfos([card], txs, today, new Set())[0].debt;

describe("kartMutabakat — fark", () => {
  it("bankadaki borç uygulamadakiyle aynıysa tutar", () => {
    const txs = [tx("2026-10-02", 1200)];
    const m = kartMutabakat(card, txs, bugun, new Set(), 1200);
    expect(m.bizim).toBe(1200);
    expect(m.tutuyor).toBe(true);
  });

  it("kuruş yuvarlaması (1 TL altı) fark sayılmaz", () => {
    const m = kartMutabakat(card, [tx("2026-10-02", 1000, 3)], bugun, new Set(), 1000.4);
    expect(m.tutuyor).toBe(true);
  });

  it("bankadaki borç GELECEK TAKSİTLERİ de içerir: girilmiş taksitli alışveriş tam tutarıyla sayılır", () => {
    // 6.000'lik 6 taksit: bu dönem 1.000 ama limitten 6.000 düşer — debt de 6.000
    const m = kartMutabakat(card, [tx("2026-10-02", 6000, 6)], bugun, new Set(), 6000);
    expect(m.tutuyor).toBe(true);
  });

  it("tek çekim eksik harcama: kalem bugüne yazılır ve sonrasında tutar", () => {
    const txs = [tx("2026-10-02", 1200)];
    const m = kartMutabakat(card, txs, bugun, new Set(), 2000);
    expect(m.fark).toBe(800);
    const k = mutabakatKalemi(m, bugun);
    expect(k).toMatchObject({ date: "2026-10-10", amount: 800, installments: 1, mutabakat: true, name: KART_MUTABAKAT_ADI });
    expect(kartMutabakat(card, yaz(txs, k), bugun, new Set(), 2000).tutuyor).toBe(true);
  });

  it("taksitli eksik: toplam aynı, ama açık döneme yalnız bir pay düşer", () => {
    const txs: CardTx[] = [];
    const m = kartMutabakat(card, txs, bugun, new Set(), 12000);
    const k = mutabakatKalemi(m, bugun, { taksit: 6 });
    const sonra = yaz(txs, k);
    expect(borc(sonra)).toBeCloseTo(12000);
    expect(statementAmount(card, sonra, "2026-11-05")).toBeCloseTo(2000);
    expect(statementAmount(card, sonra, "2027-04-05")).toBeCloseTo(2000);
  });

  it("kesilmiş ama vadesi gelmemiş ekstre varsa fark ona yazılabilir", () => {
    // 20 Ekim: 15 Eki kesildi (vade 5 Kas), açık dönem 15 Kas kesimi
    const gun = new Date(2026, 9, 20);
    const txs = [tx("2026-10-02", 1000)];
    const m = kartMutabakat(card, txs, gun, new Set(), 1500);
    expect(m.kesilen?.amount).toBe(1000);
    const k = mutabakatKalemi(m, gun, { donem: "kesilen" });
    expect(k.date).toBe("2026-10-15");
    expect(statementAmount(card, yaz(txs, k), "2026-11-05")).toBe(1500);
    // açık dönem seçilirse kesilmiş ekstre değişmez
    const k2 = mutabakatKalemi(m, gun, { donem: "acik" });
    expect(statementAmount(card, yaz(txs, k2), "2026-11-05")).toBe(1000);
  });

  it("eksi fark: ödenmemiş görünen ekstre farka denkse 'ödedin mi' adayıdır", () => {
    const gun = new Date(2026, 9, 20);
    const txs = [tx("2026-10-02", 1000), tx("2026-10-18", 300)];
    const m = kartMutabakat(card, txs, gun, new Set(), 300);
    expect(m.fark).toBe(-1000);
    expect(m.odenmisOlabilir.map((s) => s.amount)).toEqual([1000]);
    // ödendi işaretlenince tutar
    expect(kartMutabakat(card, txs, gun, new Set([stmtKey(1, "2026-11-05")]), 300).tutuyor).toBe(true);
  });

  it("eksi fark taksite bölünmez, açık döneme tek çekim yazılır", () => {
    const m = kartMutabakat(card, [tx("2026-10-02", 1000)], bugun, new Set(), 600);
    expect(mutabakatKalemi(m, bugun, { taksit: 6, donem: "kesilen" })).toMatchObject({ amount: -400, installments: 1, date: "2026-10-10" });
  });

  it("borçta payı süren eski mutabakat kalemleri listelenir, vadesi geçmiş olanlar listelenmez", () => {
    const eski = tx("2026-08-01", 500, 1, { mutabakat: true });   // vade 5 Eyl — geçti
    const suren = tx("2026-09-20", 600, 3, { mutabakat: true });  // 3 pay: 5 Kas, 5 Ara, 5 Oca
    const m = kartMutabakat(card, [eski, suren, tx("2026-10-02", 100)], bugun, new Set(), 0);
    expect(m.duzeltmeler.map((d) => [d.tx.id, d.kalan])).toEqual([[suren.id, 600]]);
  });
});

describe("mutabakat kalemi — diğer hesaplarda", () => {
  const veri = (txs: CardTx[]): AllData => ({ card_txs: txs, cards: [card], categories: [], transactions: [] } as unknown as AllData);

  it("içe aktarma karşılaştırmasında defterde yer almaz", () => {
    const d = veri([tx("2026-10-02", 100), tx("2026-10-10", 800, 1, { mutabakat: true })]);
    expect(kartDefteri(d, 1).map((k) => k.amount)).toEqual([-100]);
  });

  it("harcama özetinde kendi kovasında, işaretiyle sayılır; kategorisiz kart uyarısı üretmez", () => {
    const d = veri([tx("2026-10-02", 100), tx("2026-10-10", 800, 1, { mutabakat: true }), tx("2026-10-11", -50, 1, { mutabakat: true })]);
    const o = harcamaOzeti(d, { baslangic: "2026-10-01", bitis: "2026-10-31", grup: "kategori" });
    expect(o.gider).toBe(850);
    expect(o.kalemler.find((k) => k.ad === "Açıklanamayan kart farkı")?.gider).toBe(750);
    expect(o.kapsam.kategorisiz_kart_gideri).toBe(100);
    expect(o.uyari.some((u) => u.includes("mutabakatı farkı"))).toBe(true);
  });
});
