import { describe, it, expect } from "vitest";
import { takvimOlaylari, takvimGunleri, type TakvimOlay } from "./takvim.js";
import { tumKayitlar } from "./kayitlar.js";
import { project, type Day } from "./projection.js";
import type { AllData } from "./types.js";

/** Yalnız bu modülün okuduğu alanlar doldurulur (AllData geniş, testi o boğmasın). */
const veri = (over: Partial<AllData> = {}): AllData => ({
  accounts: [{ id: 1, name: "Garanti", balance: 10000 }],
  cards: [{ id: 1, name: "Axess", limit_amount: 0, statement_day: 25, due_day: 10 }],
  categories: [{ id: 1, name: "Market", kind: "expense", color: null }],
  transactions: [], card_txs: [], transfers: [], trades: [],
  recurring: [], recurring_amounts: [], recurring_realized: [], loans: [], oneoffs: [],
  portfolios: [], deposits: [], prices: [], price_history: [], statement_payments: [],
  account_entries: [], settings: {},
  ...over,
} as unknown as AllData);

/** Sahte projeksiyon günü — `project()` bugünden başlar, test sabit tarih istiyor. */
const gun = (k: string, ev: Day["ev"] = []): Day => ({
  date: new Date(k), k, net: 0, bal: 0, assets: 0, cashFunds: 0, deposits: 0,
  total: 0, debt: 0, worth: 0, ev,
});

const PENCERE = { from: "2026-03-01", to: "2026-03-31" };
const tur = (o: TakvimOlay[], t: string) => o.filter((x) => x.tur === t);

describe("takvimOlaylari", () => {
  it("geçmişi ve geleceği TEK eksende birleştirir, tarihe göre artan sırada", () => {
    const d = veri({ transactions: [{ id: 1, date: "2026-03-05", name: "Market", amount: -400, category_id: 1, account_id: 1 }] });
    const o = takvimOlaylari(d, [gun("2026-03-20", [{ n: "Kira", a: -9000, t: "duzenli" }])], PENCERE);
    expect(o.map((x) => x.date)).toEqual([...o.map((x) => x.date)].sort());
    expect(tur(o, "gerceklesen")[0].baslik).toBe("Market");
    expect(tur(o, "planli")[0].baslik).toBe("Kira");
  });

  it("pencere iki uçtan DAHİL süzer", () => {
    const d = veri({ transactions: [
      { id: 1, date: "2026-02-28", name: "Önce", amount: -1, category_id: null, account_id: null },
      { id: 2, date: "2026-03-01", name: "İlk gün", amount: -1, category_id: null, account_id: null },
      { id: 3, date: "2026-03-31", name: "Son gün", amount: -1, category_id: null, account_id: null },
      { id: 4, date: "2026-04-01", name: "Sonra", amount: -1, category_id: null, account_id: null },
    ] });
    const o = tur(takvimOlaylari(d, [], PENCERE), "gerceklesen");
    expect(o.map((x) => x.baslik)).toEqual(["İlk gün", "Son gün"]);
  });

  /* ————— AYRIŞMA KAPANLARI —————
     Bu dosyanın sözü "yeni matematik yok". Kopya matematik girdiği gün aşağıdakiler patlar. */

  it("gerçekleşen olaylar tumKayitlar()'ın BİREBİR aynısıdır (ikinci birleştirici yok)", () => {
    const d = veri({
      transactions: [{ id: 1, date: "2026-03-05", name: "Market", amount: -400, category_id: 1, account_id: 1 }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-03-07", name: "Migros", amount: 250, installments: 1 }],
      transfers: [{ id: 1, date: "2026-03-09", from_account_id: 1, to_account_id: 1, amount: 500, note: "ATM" }],
      trades: [{ id: 1, date: "2026-03-11", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100, fee: 0, currency: "TRY" }],
    });
    const takvim = tur(takvimOlaylari(d, [], PENCERE), "gerceklesen");
    const kayit = tumKayitlar(d).filter((k) => k.date >= PENCERE.from && k.date <= PENCERE.to);
    expect(takvim).toHaveLength(kayit.length);
    // tutar ve YÖN aynı kaynaktan gelmeli: virman "notr", kart harcaması "cikis"…
    expect(takvim.map((o) => [o.baslik, o.tutar, o.yon]).sort())
      .toEqual(kayit.map((k) => [k.ad, k.tutar, k.yon]).sort());
  });

  it("planlı olaylar Day.ev'in BİREBİR aynısıdır (taksit/ekstre tutarı yeniden hesaplanmaz)", () => {
    const gunler = [
      gun("2026-03-05", [{ n: "Maaş", a: 42000, t: "duzenli" }, { n: "Kira", a: -9000, t: "duzenli" }]),
      gun("2026-03-10", [{ n: "Axess ekstresi", a: -3200, t: "ekstre" }]),
      gun("2026-03-15", [{ n: "Konut kredisi (kalan 84)", a: -12500, t: "kredi" }]),
      gun("2026-03-20", [{ n: "Vergi", a: -1500, t: "plan" }]),
    ];
    const o = tur(takvimOlaylari(veri(), gunler, PENCERE), "planli");
    const ev = gunler.flatMap((g) => g.ev);
    expect(o).toHaveLength(ev.length);
    /* Aynı gün içindeki sıra ada göredir (deterministik ama Day.ev sırası değil), o yüzden
       karşılaştırma ad↦(tutar, yön, etiket) eşlemesi üzerinden yapılır. */
    const esle = new Map(o.map((x) => [x.baslik, [x.tutar, x.yon, x.etiket]]));
    expect(esle.get("Maaş")).toEqual([42000, "giris", "Düzenli"]);
    expect(esle.get("Kira")).toEqual([9000, "cikis", "Düzenli"]);
    // tür etiketi Day.ev.t'den okunur — addan ("…ekstresi") türetilmez
    expect(esle.get("Axess ekstresi")).toEqual([3200, "cikis", "Ekstre ödemesi"]);
    expect(esle.get("Konut kredisi (kalan 84)")).toEqual([12500, "cikis", "Kredi taksidi"]);
    expect(esle.get("Vergi")).toEqual([1500, "cikis", "Planlı"]);
    // tür yalnız `etiket`te durur, `detay`da tekrarlanmaz
    expect(o.every((x) => x.detay === "")).toBe(true);
  });

  it("days boş verilirse planlı olay ÜRETİLMEZ (projeksiyon burada taklit edilmez)", () => {
    const d = veri({ recurring: [{ id: 1, name: "Kira", day: 5, kind: "expense", target: null, auto: 0 } as any] });
    expect(tur(takvimOlaylari(d, [], PENCERE), "planli")).toHaveLength(0);
  });

  it("gerçek project() çıktısıyla da planlı olay sayısı Day.ev toplamına eşittir", () => {
    const d = veri({
      recurring: [{ id: 1, name: "Kira", day: 5, kind: "expense", target: null, auto: 0 } as any],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 9000 }] as any,
    });
    const days = project(d, 3);
    const o = tur(takvimOlaylari(d, days), "planli");
    expect(o).toHaveLength(days.reduce((s, g) => s + g.ev.length, 0));
    expect(o.length).toBeGreaterThan(0);
  });

  /* ————— KART KESİM GÜNÜ ————— */

  it("kesim günü ayda bir düşer ve TUTARI YOKTUR (para hareketi değil)", () => {
    const o = tur(takvimOlaylari(veri(), [], { from: "2026-03-01", to: "2026-05-31" }), "kesim");
    expect(o.map((x) => x.date)).toEqual(["2026-03-25", "2026-04-25", "2026-05-25"]);
    expect(o.every((x) => x.tutar === null && x.yon === "notr")).toBe(true);
  });

  it("kesim günü kısa ayda ay sonuna kırpılır", () => {
    const d = veri({ cards: [{ id: 1, name: "Kart", limit_amount: 0, statement_day: 31, due_day: 10 }] });
    const o = tur(takvimOlaylari(d, [], { from: "2026-02-01", to: "2026-02-28" }), "kesim");
    expect(o.map((x) => x.date)).toEqual(["2026-02-28"]);
  });

  /* ————— VADELİ MEVDUAT ————— */

  it("vade günü mevduatın vade DEĞERİYLE yazılır", () => {
    const d = veri({ deposits: [{ id: 1, name: "3 aylık", principal: 100000, rate: 40, open_date: "2026-01-01", term_days: 90, withholding: 0 }] as any });
    const o = tur(takvimOlaylari(d, [], { from: "2026-01-01", to: "2026-12-31" }), "vade");
    expect(o).toHaveLength(1);
    expect(o[0].date).toBe("2026-04-01");
    expect(o[0].tutar).toBeGreaterThan(100000);
  });

  /* ————— PİYASA OLAYLARI ————— */

  it("bilanço tarihinin TAHMİNİ olup olmadığı olduğu gibi aktarılır", () => {
    const d = veri({ company_events: [
      { symbol: "THYAO", asset_type: "BIST", kind: "bilanco", date: "2026-03-05", tahmini: false },
      { symbol: "ASELS", asset_type: "BIST", kind: "bilanco", date: "2026-03-06", tahmini: true },
    ] });
    const o = tur(takvimOlaylari(d, [], PENCERE), "bilanco");
    expect(o.map((x) => x.tahmini)).toEqual([false, true]);
    expect(o[1].detay).toContain("tahmini");
    // bilanço bir para hareketi DEĞİL
    expect(o.every((x) => x.tutar === null)).toBe(true);
  });

  it("bedelsizde tutar YOKTUR (oran detaya yazılır), temettüde hisse başına brüt tutar vardır", () => {
    const d = veri({ corporate_actions: [
      { symbol: "ISCTR", asset_type: "BIST", date: "2026-03-12", kind: "bolunme", value: 2.5, currency: "TRY" },
      { symbol: "BIMAS", asset_type: "BIST", date: "2026-03-14", kind: "temettu", value: 12.34, currency: "TRY" },
    ] });
    const o = tur(takvimOlaylari(d, [], PENCERE), "kurumsal");
    expect(o[0].tutar).toBeNull();
    expect(o[0].detay).toContain("2,5");
    expect(o[1].tutar).toBe(12.34);
    expect(o[1].detay).toContain("brüt");
  });

  it("makro tarihler takvime girer ve kaynağı etiketlenir", () => {
    const o = tur(takvimOlaylari(veri(), [], { from: "2026-09-01", to: "2026-09-30" }), "makro");
    expect(o.some((x) => x.date === "2026-09-10" && x.etiket === "TCMB")).toBe(true);
    expect(o.some((x) => x.date === "2026-09-16" && x.etiket === "Fed")).toBe(true);
    /* `detay` etiketi TEKRAR ETMEZ: ikisi birlikte satırda "Fed · Fed" yazıyordu. */
    expect(o.every((x) => x.detay === "")).toBe(true);
  });

  /* ————— SIRALAMA + SÜZGEÇ ————— */

  it("aynı gün DEFTER olayları piyasa/bilgi olaylarından ÖNCE gelir", () => {
    const d = veri({
      transactions: [{ id: 1, date: "2026-09-16", name: "Market", amount: -100, category_id: null, account_id: null }],
      company_events: [{ symbol: "THYAO", asset_type: "BIST", kind: "bilanco", date: "2026-09-16", tahmini: false }],
    });
    const o = takvimOlaylari(d, [gun("2026-09-16", [{ n: "Kira", a: -9000, t: "duzenli" }])], { from: "2026-09-16", to: "2026-09-16" });
    expect(o.map((x) => x.tur)).toEqual(["gerceklesen", "planli", "bilanco", "makro"]);
  });

  it("tür süzgeci yalnız istenen cinsi döndürür", () => {
    const d = veri({
      transactions: [{ id: 1, date: "2026-03-05", name: "Market", amount: -100, category_id: null, account_id: null }],
      company_events: [{ symbol: "THYAO", asset_type: "BIST", kind: "bilanco", date: "2026-03-06", tahmini: false }],
    });
    const o = takvimOlaylari(d, [], { ...PENCERE, turler: ["bilanco"] });
    expect(o.map((x) => x.tur)).toEqual(["bilanco"]);
  });

  it("anahtarlar tekildir (tablolar arası id çakışması React'i bozmasın)", () => {
    const d = veri({
      transactions: [{ id: 1, date: "2026-03-05", name: "A", amount: -1, category_id: null, account_id: null }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-03-05", name: "B", amount: 1, installments: 1 }],
      transfers: [{ id: 1, date: "2026-03-05", from_account_id: 1, to_account_id: 1, amount: 1, note: "" }],
      trades: [{ id: 1, date: "2026-03-05", asset_type: "BIST", symbol: "X", side: "ALIŞ", qty: 1, price: 1, fee: 0, currency: "TRY" }],
    });
    const o = takvimOlaylari(d, [gun("2026-03-05", [{ n: "K", a: -1, t: "duzenli" }, { n: "L", a: -2, t: "plan" }])], PENCERE);
    expect(new Set(o.map((x) => x.key)).size).toBe(o.length);
  });
});

describe("takvimGunleri", () => {
  it("gün anahtarına göre gruplar", () => {
    const d = veri({ transactions: [
      { id: 1, date: "2026-03-05", name: "A", amount: -1, category_id: null, account_id: null },
      { id: 2, date: "2026-03-05", name: "B", amount: -1, category_id: null, account_id: null },
      { id: 3, date: "2026-03-06", name: "C", amount: -1, category_id: null, account_id: null },
    ] });
    const g = takvimGunleri(takvimOlaylari(d, [], { ...PENCERE, turler: ["gerceklesen"] }));
    expect(g.get("2026-03-05")).toHaveLength(2);
    expect(g.get("2026-03-06")).toHaveLength(1);
  });
});
