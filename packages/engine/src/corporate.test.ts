import { describe, it, expect } from "vitest";
import { kurumsalOneriler, bedelliPlan, dripAcikMi, dripToggle, type CorporateAction } from "./corporate.js";
import { positions } from "./portfolio.js";
import type { Trade, PriceHistoryEntry } from "./types.js";

const trade = (over: Partial<Trade>): Trade => ({
  id: 0, date: "2026-01-01", asset_type: "BIST", symbol: "BIMAS", side: "ALIŞ", qty: 0, price: 0, fee: 0, currency: "TRY", ...over,
});
const act = (over: Partial<CorporateAction>): CorporateAction => ({
  symbol: "BIMAS", asset_type: "BIST", date: "2026-05-14", kind: "bolunme", value: 2, ...over,
});
const ph = (date: string, price: number, symbol = "BIMAS"): PriceHistoryEntry =>
  ({ symbol, asset_type: "BIST", date, price, currency: "TRY" }) as PriceHistoryEntry;

describe("kurumsalOneriler — bedelsiz", () => {
  it("olaydan önce tutulan hissede eksik bedelsizi bulur", () => {
    const o = kurumsalOneriler([trade({ id: 1, date: "2026-02-01", qty: 100, price: 300 })], [act({})]);
    expect(o).toHaveLength(1);
    const b = o[0];
    expect(b.kind).toBe("bedelsiz");
    if (b.kind !== "bedelsiz") throw new Error();
    expect(b.qtyBefore).toBe(100);
    expect(b.qty).toBe(100); // ×2 → 100 adet daha gelmeli
    expect(b.ratio).toBe(2);
  });

  it("bedelsiz zaten kaydedilmişse SUSAR", () => {
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-02-01", qty: 100, price: 300 }),
      trade({ id: 2, date: "2026-05-14", side: "BEDELSİZ", qty: 100, price: 0 }),
    ], [act({})]);
    expect(o).toEqual([]);
  });

  it("olaydan SONRA alınmışsa öneri yok — olay seni ilgilendirmiyor", () => {
    /* Gerçek veriyle ölçülen durum: kullanıcı BIMAS'ı Mayıs bedelsizinden SONRA (Ağustos'ta)
       almıştı. Fiyat zaten düzeltilmiş geldiğinden ortada eksik bir şey yok. */
    const o = kurumsalOneriler([trade({ id: 1, date: "2026-08-03", qty: 6, price: 378.5 })], [act({})]);
    expect(o).toEqual([]);
  });

  it("ex-date'in KENDİSİNDE alım hak doğurmaz", () => {
    const o = kurumsalOneriler([trade({ id: 1, date: "2026-05-14", qty: 100, price: 300 })], [act({})]);
    expect(o).toEqual([]);
  });

  it("olaydan önce tamamen satılmışsa öneri yok", () => {
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-02-01", qty: 100, price: 300 }),
      trade({ id: 2, date: "2026-04-01", side: "SATIŞ", qty: 100, price: 320 }),
    ], [act({})]);
    expect(o).toEqual([]);
  });

  it("İKİ bedelsizden yalnız İKİNCİSİ kaydedilmişse birincisi hâlâ önerilir", () => {
    /* Ölçütün "olaydan sonra herhangi bir BEDELSİZ var mı" olması bu senaryoyu sessizce
       gizlerdi: ikinci kaydın tarihi birinci olaydan da sonradır. Pencere bu yüzden
       [bu olay, AYNI TÜRDEN bir sonraki olay) aralığıdır. */
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-01-05", qty: 100, price: 300 }),
      trade({ id: 2, date: "2026-09-02", side: "BEDELSİZ", qty: 200, price: 0 }),
    ], [
      act({ date: "2026-05-14", value: 2 }),
      act({ date: "2026-09-02", value: 2 }),
    ]);
    expect(o).toHaveLength(1);
    expect(o[0].date).toBe("2026-05-14");
  });

  it("oran 1 ise (eklenecek adet yok) öneri üretmez", () => {
    expect(kurumsalOneriler([trade({ id: 1, date: "2026-01-05", qty: 100, price: 300 })], [act({ value: 1 })])).toEqual([]);
  });

  it("ondalık oranı doğru uygular — ISCTR 249,99751:100", () => {
    /* Türkiye'de bedelsiz oranları yuvarlak değildir; `splitRatio` metnini ayrıştırmak yerine
       numerator/denominator kullanılmasının sebebi bu. 100 adette ~150 yeni adet gelir. */
    const o = kurumsalOneriler(
      [trade({ id: 1, symbol: "ISCTR", date: "2024-01-05", qty: 100, price: 12 })],
      [act({ symbol: "ISCTR", date: "2024-02-27", value: 249.99751 / 100 })],
    );
    expect(o).toHaveLength(1);
    expect(o[0].kind === "bedelsiz" && o[0].qty).toBeCloseTo(149.99751, 5);
  });

  it("ileri tarihli olay önerilmez", () => {
    const o = kurumsalOneriler(
      [trade({ id: 1, date: "2026-01-05", qty: 100, price: 300 })],
      [act({ date: "2026-12-01" })],
      { today: "2026-09-22" },
    );
    expect(o).toEqual([]);
  });

  it("hiç işlem görmemiş sembolün olayı görmezden gelinir", () => {
    const o = kurumsalOneriler([trade({ id: 1, symbol: "THYAO", date: "2026-01-05", qty: 10, price: 300 })], [act({})]);
    expect(o).toEqual([]);
  });
});

describe("kurumsalOneriler — temettü", () => {
  const tem = (over: Partial<CorporateAction> = {}) => act({ kind: "temettu", value: 0.2346, date: "2026-03-10", ...over });

  it("hisse başına tutarı elde tutulan adetle çarpar", () => {
    const o = kurumsalOneriler([trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 })], [tem()]);
    expect(o).toHaveLength(1);
    const t = o[0];
    if (t.kind !== "temettu") throw new Error();
    expect(t.qty).toBe(150);
    expect(t.perShare).toBe(0.2346);
    expect(t.amount).toBeCloseTo(35.19, 2);
    expect(t.reinvest).toBeNull(); // DRIP kapalı
  });

  it("temettü zaten kaydedilmişse SUSAR", () => {
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 }),
      trade({ id: 2, date: "2026-03-10", side: "TEMETTÜ", qty: 150, price: 0.2346 }),
    ], [tem()]);
    expect(o).toEqual([]);
  });

  it("bedelsiz kaydı temettü olayını KAPATMAZ (türler ayrı pencere)", () => {
    /* Aynı yıl hem bedelsiz hem temettü veren hissede tek pencere kullanılsaydı, kaydedilen
       bedelsiz temettü önerisini de susturur ve gelir sessizce kaybolurdu. */
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 }),
      trade({ id: 2, date: "2026-03-12", side: "BEDELSİZ", qty: 150, price: 0 }),
    ], [tem()]);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe("temettu");
  });

  it("DRIP açıksa ödeme GÜNÜNÜN fiyatıyla geri yatırım adedi verir", () => {
    const o = kurumsalOneriler(
      [trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 })],
      [tem()],
      { dripSymbols: ["BIMAS"], priceHistory: [ph("2026-03-10", 400), ph("2026-09-22", 800)] },
    );
    const t = o[0];
    if (t.kind !== "temettu") throw new Error();
    // BUGÜNKÜ fiyat (800) değil, o günün fiyatı (400) kullanılmalı
    expect(t.reinvest).not.toBeNull();
    expect(t.reinvest!.price).toBe(400);
    expect(t.reinvest!.qty).toBeCloseTo(35.19 / 400, 6);
  });

  it("DRIP açık ama o günün fiyatı yoksa tutar verilir, adet uydurulmaz", () => {
    const o = kurumsalOneriler(
      [trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 })],
      [tem()],
      { dripSymbols: ["BIMAS"], priceHistory: [ph("2026-09-22", 800)] },
    );
    const t = o[0];
    if (t.kind !== "temettu") throw new Error();
    expect(t.amount).toBeCloseTo(35.19, 2);
    expect(t.reinvest).toBeNull();
  });

  it("DRIP listesi TYPE:SYM biçimini de kabul eder", () => {
    const o = kurumsalOneriler(
      [trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 })],
      [tem()],
      { dripSymbols: ["BIST:BIMAS"], priceHistory: [ph("2026-03-10", 400)] },
    );
    expect((o[0] as any).reinvest).not.toBeNull();
  });

  it("taksitli temettü: iki ödeme ayrı ayrı önerilir, biri kaydedilince diğeri kalır", () => {
    const o = kurumsalOneriler([
      trade({ id: 1, date: "2026-01-05", qty: 150, price: 300 }),
      trade({ id: 2, date: "2026-03-10", side: "TEMETTÜ", qty: 150, price: 0.2346 }),
    ], [tem({ date: "2026-03-10" }), tem({ date: "2026-06-10", value: 0.18 })]);
    expect(o).toHaveLength(1);
    expect(o[0].date).toBe("2026-06-10");
  });
});

describe("kurumsalOneriler — genel", () => {
  it("öneriler yeniden eskiye sıralı", () => {
    const o = kurumsalOneriler(
      [trade({ id: 1, date: "2026-01-05", qty: 100, price: 300 })],
      [act({ date: "2026-03-01", kind: "temettu", value: 1 }), act({ date: "2026-07-01", value: 2 })],
    );
    expect(o.map((x) => x.date)).toEqual(["2026-07-01", "2026-03-01"]);
  });

  it("öneri üretmek pozisyonlara DOKUNMAZ — kayıt yazmaz, yalnız rapor eder", () => {
    /* Ayrışma kapanı: bu dosya salt okunurdur. Önce/sonra `positions()` aynı olmalı. */
    const tl = [trade({ id: 1, date: "2026-01-05", qty: 100, price: 300 })];
    const onceki = JSON.stringify(positions(tl, []));
    kurumsalOneriler(tl, [act({})]);
    expect(JSON.stringify(positions(tl, []))).toBe(onceki);
  });

  it("olay listesi boşsa hiç iş yapmaz", () => {
    expect(kurumsalOneriler([trade({ id: 1, qty: 10, price: 5 })], [])).toEqual([]);
  });
});

describe("bedelliPlan", () => {
  it("%50 bedelli, nominal ₺1 → 100 lotta 50 yeni lot, ₺50 ödeme", () => {
    expect(bedelliPlan(100, 0.5, 1)).toEqual({ qty: 50, cost: 50, qtyAfter: 150 });
  });

  it("küsurat KIRPILIR — 0,4 lot alınamaz", () => {
    /* Rüçhan hakkı lot bazında kullanılır; kalan kesir hakkı borsada satılır. Yuvarlamak
       defterdeki adedi gerçek hesaptan ayırırdı. */
    expect(bedelliPlan(101, 0.5, 1)).toEqual({ qty: 50, cost: 50, qtyAfter: 151 });
  });

  it("bedel nominal değilse de doğru toplar", () => {
    expect(bedelliPlan(200, 1, 2.5)).toEqual({ qty: 200, cost: 500, qtyAfter: 400 });
  });

  it("geçersiz girdide null", () => {
    expect(bedelliPlan(0, 0.5, 1)).toBeNull();
    expect(bedelliPlan(100, 0, 1)).toBeNull();
    expect(bedelliPlan(100, 0.5, 0)).toBeNull();
    expect(bedelliPlan(1, 0.4, 1)).toBeNull(); // floor(0,4) = 0 → alınacak lot yok
  });
});

describe("DRIP ayarı", () => {
  it("boş ayar → kapalı", () => {
    expect(dripAcikMi({}, "BIST", "BIMAS")).toBe(false);
    expect(dripAcikMi(undefined, "BIST", "BIMAS")).toBe(false);
  });

  it("aç → kapat gidiş dönüşü", () => {
    const acik = dripToggle({}, "BIST", "BIMAS");
    expect(acik).toBe("BIST:BIMAS");
    expect(dripAcikMi({ drip_symbols: acik }, "BIST", "BIMAS")).toBe(true);
    expect(dripToggle({ drip_symbols: acik }, "BIST", "BIMAS")).toBe("");
  });

  it("büyük/küçük harf ve boşluk toleranslı — işaret 'kaybolmaz'", () => {
    expect(dripAcikMi({ drip_symbols: " bist:bimas , BIST:SASA " }, "BIST", "BIMAS")).toBe(true);
    expect(dripAcikMi({ drip_symbols: " bist:bimas , BIST:SASA " }, "BIST", "SASA")).toBe(true);
  });

  it("TÜR ayırt edilir — aynı sembol başka türde açılmış sayılmaz", () => {
    expect(dripAcikMi({ drip_symbols: "BIST:NVDA" }, "ETF", "NVDA")).toBe(false);
  });

  it("varolanı bozmadan ikinci sembol ekler", () => {
    expect(dripToggle({ drip_symbols: "BIST:BIMAS" }, "ETF", "NVDA")).toBe("BIST:BIMAS,ETF:NVDA");
  });
});
