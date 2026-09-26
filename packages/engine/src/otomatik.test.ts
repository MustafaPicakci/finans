import { describe, it, expect } from "vitest";
import { bekleyenDuzenli, bekleyenEkstreler, OTOMATIK_PENCERE_GUN } from "./otomatik.js";
import type { AllData, Recurring, Card, CardTx } from "./types.js";

const bos = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [], ...over,
});
const rec = (o: Partial<Recurring> = {}): Recurring => ({
  id: 1, kind: "expense", name: "Kira", day: 5, from_month: null, to_month: null, auto: true, account_id: 1, ...o,
});
const tutar = (amount: number, recurring_id = 1, from_month = "0000-01") => ({ recurring_id, from_month, amount });

describe("bekleyenDuzenli", () => {
  const BUGUN = "2026-09-26";

  it("günü geçmiş auto kalemi gerçekleşmeye hazır sayar (tarih occurrence tarihidir, bugün DEĞİL)", () => {
    const d = bos({ recurring: [rec()], recurring_amounts: [tutar(3000)] });
    const r = bekleyenDuzenli(d, BUGUN);
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe("2026-09-05"); // yazılırken bu tarih kullanılır → geç yazım kaydı değiştirmez
    expect(r[0].amount).toBe(-3000);
  });

  it("auto işaretsiz kalem hiç girmez", () => {
    expect(bekleyenDuzenli(bos({ recurring: [rec({ auto: false })], recurring_amounts: [tutar(3000)] }), BUGUN)).toHaveLength(0);
  });

  it("hedefsiz kalem girmez — o yalnız tahmindir, deftere yazılmaz", () => {
    const d = bos({ recurring: [rec({ account_id: null, card_id: null })], recurring_amounts: [tutar(3000)] });
    expect(bekleyenDuzenli(d, BUGUN)).toHaveLength(0);
  });

  it("günü gelmemiş occurrence girmez (ama önceki ayın günü gelmişi girer)", () => {
    const d = bos({ recurring: [rec({ day: 28 })], recurring_amounts: [tutar(3000)] });
    const aylar = bekleyenDuzenli(d, BUGUN).map((x) => x.ym);
    expect(aylar).not.toContain("2026-09"); // 28 Eylül henüz gelmedi
    expect(aylar).toContain("2026-08");     // 28 Ağustos geldi ve pencerede
  });

  it("zaten gerçekleşmiş ay ikinci kez girmez", () => {
    const d = bos({
      recurring: [rec()], recurring_amounts: [tutar(3000)],
      recurring_realized: [{ recurring_id: 1, ym: "2026-09" }],
    });
    expect(bekleyenDuzenli(d, BUGUN)).toHaveLength(0);
  });

  it("tutarı tanımlı olmayan kalem girmez (gerçekleşti ama kayıt yok durumuna düşmesin)", () => {
    expect(bekleyenDuzenli(bos({ recurring: [rec()], recurring_amounts: [] }), BUGUN)).toHaveLength(0);
  });

  it("ÖNCEKİ ay da taranır (telafi), ama pencereden eski olan girmez", () => {
    const d = bos({ recurring: [rec({ day: 5 })], recurring_amounts: [tutar(3000)] });
    // 5 Ağustos, 26 Eylül'e 52 gün uzak → pencere (45) dışında
    const r = bekleyenDuzenli(d, BUGUN);
    expect(r.map((x) => x.ym)).toEqual(["2026-09"]);
    // aynı kalem 20 Ekim'de bakılırsa Eylül occurrence'ı hâlâ pencerede (45 gün)
    expect(bekleyenDuzenli(d, "2026-10-20").map((x) => x.ym)).toEqual(["2026-09", "2026-10"]);
  });

  it("pencere sınırı tam gününde hâlâ içeride", () => {
    const d = bos({ recurring: [rec({ day: 1 })], recurring_amounts: [tutar(100)] });
    const sinir = "2026-09-01";
    const tamGun = new Date(2026, 8, 1); tamGun.setDate(tamGun.getDate() + OTOMATIK_PENCERE_GUN);
    const g = `${tamGun.getFullYear()}-${String(tamGun.getMonth() + 1).padStart(2, "0")}-${String(tamGun.getDate()).padStart(2, "0")}`;
    expect(bekleyenDuzenli(d, g).some((x) => x.date === sinir)).toBe(true);
  });

  it("yaşam penceresi dışındaki ay girmez (from_month / to_month)", () => {
    const a = bos({ recurring: [rec({ from_month: "2026-10" })], recurring_amounts: [tutar(3000)] });
    expect(bekleyenDuzenli(a, BUGUN)).toHaveLength(0);
    const b = bos({ recurring: [rec({ to_month: "2026-08" })], recurring_amounts: [tutar(3000)] });
    expect(bekleyenDuzenli(b, BUGUN)).toHaveLength(0);
  });

  it("kısa ayda ödeme günü ay sonuna kayar", () => {
    const d = bos({ recurring: [rec({ day: 31 })], recurring_amounts: [tutar(500)] });
    expect(bekleyenDuzenli(d, "2026-03-05").find((x) => x.ym === "2026-02")?.date).toBe("2026-02-28");
  });

  /* İŞARET: sunucudaki dal ayrımıyla birebir olmalı — dördü de ayrı ayrı yazılı,
     çünkü bir tanesinin ters dönmesi sessizce yanlış işaretli kayıt yazardı. */
  it("gider hesaba düşerse EKSİ", () => {
    const d = bos({ recurring: [rec({ kind: "expense", account_id: 1, card_id: null })], recurring_amounts: [tutar(1000)] });
    expect(bekleyenDuzenli(d, BUGUN)[0].amount).toBe(-1000);
  });
  it("gelir hesaba düşerse ARTI", () => {
    const d = bos({ recurring: [rec({ kind: "income", account_id: 1, card_id: null })], recurring_amounts: [tutar(1000)] });
    expect(bekleyenDuzenli(d, BUGUN)[0].amount).toBe(1000);
  });
  it("gider KARTA düşerse ARTI (ekstre borcu büyür)", () => {
    const d = bos({ recurring: [rec({ kind: "expense", account_id: null, card_id: 7 })], recurring_amounts: [tutar(150)] });
    expect(bekleyenDuzenli(d, BUGUN)[0].amount).toBe(150);
  });
  it("gelir kart hedefliyse yine ARTI (sunucuda hesap dalına düşer)", () => {
    const d = bos({ recurring: [rec({ kind: "income", account_id: null, card_id: 7 })], recurring_amounts: [tutar(150)] });
    expect(bekleyenDuzenli(d, BUGUN)[0].amount).toBe(150);
  });

  it("tutar zaman çizelgesinden O AYIN tutarı çözülür", () => {
    const d = bos({
      recurring: [rec({ day: 5 })],
      recurring_amounts: [tutar(3000), tutar(4000, 1, "2026-09")],
    });
    expect(bekleyenDuzenli(d, BUGUN)[0].amount).toBe(-4000);
  });
});

describe("bekleyenEkstreler", () => {
  /* 10 Ağustos harcaması → kesim 25 Ağustos → vade 10 Eylül (ölçüldü). Pencere 10 gün
     olduğundan referans gün 14 Eylül: vade 4 gün geride, yani içeride. */
  const BUGUN = "2026-09-14";
  const kart = (o: Partial<Card> = {}): Card =>
    ({ id: 1, name: "Kart", limit_amount: 50000, statement_day: 25, due_day: 10, pay_account_id: 1, ...o });
  const harcama = (o: Partial<CardTx> = {}): CardTx =>
    ({ id: 1, card_id: 1, date: "2026-08-10", name: "A", amount: 1000, installments: 1, ...o });
  const veri = (o: Partial<AllData> = {}) => bos({ accounts: [{ id: 1, name: "H" }], cards: [kart()], card_txs: [harcama()], ...o });

  it("vadesi gelmiş ödenmemiş ekstreyi verir", () => {
    const r = bekleyenEkstreler(veri(), BUGUN);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(1000);
    expect(r[0].account_id).toBe(1);
  });

  it("ödeme talimatı yoksa girmez", () => {
    expect(bekleyenEkstreler(veri({ cards: [kart({ pay_account_id: null })] }), BUGUN)).toHaveLength(0);
  });

  it("talimat hesabı silinmişse girmez (uydurma hesaba yazmaz)", () => {
    expect(bekleyenEkstreler(veri({ accounts: [] }), BUGUN)).toHaveLength(0);
  });

  it("zaten ödenmiş ekstre girmez", () => {
    const r0 = bekleyenEkstreler(veri(), BUGUN);
    const d = veri({ statement_payments: [{ card_id: 1, due: r0[0].due }] });
    expect(bekleyenEkstreler(d, BUGUN)).toHaveLength(0);
  });

  it("pencereden (10 gün) eski vade girmez", () => {
    expect(bekleyenEkstreler(veri(), "2026-09-20").map((x) => x.due)).toEqual(["2026-09-10"]); // 10 gün: sınırda içeride
    expect(bekleyenEkstreler(veri(), "2026-09-21")).toHaveLength(0);                          // 11 gün: dışarıda
  });

  it("taksitler ayrı vadelere bölünür — bir aylık ekstre yalnız kendi payını taşır", () => {
    const d = veri({ card_txs: [harcama({ amount: 1200, installments: 3 })] });
    const r = bekleyenEkstreler(d, BUGUN);
    expect(r).toHaveLength(1);        // Ekim ve Kasım payları henüz vadesinde değil
    expect(r[0].amount).toBe(400);
  });

  it("aynı vadedeki iki harcama toplanır", () => {
    const d = veri({ card_txs: [harcama(), harcama({ id: 2, amount: 500 })] });
    expect(bekleyenEkstreler(d, BUGUN)[0].amount).toBe(1500);
  });
});
