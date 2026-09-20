import { describe, it, expect } from "vitest";
import { priceReturnOver, symbolReturns, monthlyTwr, twrByRange } from "./returns.js";
import { twrSeries, type ValueDecompPoint } from "./portfolio.js";
import type { PriceHistoryEntry } from "./types.js";

const ph = (date: string, price: number, symbol = "THYAO", asset_type: PriceHistoryEntry["asset_type"] = "BIST"): PriceHistoryEntry =>
  ({ date, price, symbol, asset_type });

/** Gün gün seri üretici: `2026-01-01`'den başlayarak verilen fiyatlar */
const gunler = (baslangic: string, fiyatlar: number[], symbol = "THYAO", tur: PriceHistoryEntry["asset_type"] = "BIST") => {
  const [y, m, d] = baslangic.split("-").map(Number);
  return fiyatlar.map((p, i) => {
    const t = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    return ph(t, p, symbol, tur);
  });
};

describe("priceReturnOver", () => {
  it("son N günlük fiyat getirisini yüzde olarak verir", () => {
    // 8 gün: 100 … 110 — 7 gün önceki fiyat 100, son 110 → %10
    const h = gunler("2026-01-01", [100, 101, 102, 103, 104, 105, 106, 110]);
    expect(priceReturnOver(h, "BIST:THYAO", 7)).toBeCloseTo(10, 10);
  });

  it("taban gün seride yoksa en yakın ÖNCEKİ güne düşer (borsa tatili)", () => {
    /* 7 gün öncesi 2026-01-08; o gün kayıt YOK, en yakın önceki 2026-01-06 (fiyat 50).
       Eldeki en eski güne düşmek ya da null dönmek yanlış olurdu — 06'daki fiyat gerçek tabandır. */
    const h = [ph("2026-01-06", 50), ph("2026-01-12", 60), ph("2026-01-15", 75)];
    expect(priceReturnOver(h, "BIST:THYAO", 7)).toBeCloseTo(50, 10); // 75/50 − 1
  });

  it("seri pencereden kısaysa null döner — uydurulmuş getiri yok", () => {
    const h = gunler("2026-01-01", [100, 105]); // yalnız 2 gün
    expect(priceReturnOver(h, "BIST:THYAO", 365)).toBeNull();
    expect(priceReturnOver(h, "BIST:THYAO", 1)).toBeCloseTo(5, 10);
  });

  it("tek noktalı ve boş seride null döner", () => {
    expect(priceReturnOver([ph("2026-01-01", 100)], "BIST:THYAO", 1)).toBeNull();
    expect(priceReturnOver([], "BIST:THYAO", 1)).toBeNull();
  });

  it("başka sembolün kayıtları karışmaz", () => {
    const h = [...gunler("2026-01-01", [100, 200], "THYAO"), ...gunler("2026-01-01", [10, 10], "ASELS")];
    expect(priceReturnOver(h, "BIST:THYAO", 1)).toBeCloseTo(100, 10);
    expect(priceReturnOver(h, "BIST:ASELS", 1)).toBeCloseTo(0, 10);
  });

  it("ÇAPA serinin son günüdür: fiyatlar bayatsa pencere kaymaz", () => {
    /* Kritik davranış. Seri 2026-01-08'de bitiyor; bugün çok ileride olsa bile "1 günlük
       getiri" son iki kaydın farkıdır. Bugüne çapalansaydı sonuç sessizce null'a düşer
       (ya da çok daha uzun bir pencereyi "günlük" diye gösterirdi). */
    const h = gunler("2026-01-01", [100, 101, 102, 103, 104, 105, 106, 110]);
    expect(priceReturnOver(h, "BIST:THYAO", 1)).toBeCloseTo((110 / 106 - 1) * 100, 10);
  });

  it("taban fiyat 0 ise null (0'a bölme tek yerde çözülür)", () => {
    const h = [ph("2026-01-01", 0), ph("2026-01-08", 50)];
    expect(priceReturnOver(h, "BIST:THYAO", 7)).toBeNull();
  });
});

describe("symbolReturns", () => {
  it("kısa geçmişte yakın pencereler dolu, uzaklar null", () => {
    /* TEFAS/ALTIN durumu: geriye doldurulamadığı için seri kısadır. Kolon boş kalır ("—"),
       eldeki en eski fiyat 1 yıllık taban sayılmaz. */
    const h = gunler("2026-01-01", [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5], "TP2", "FON");
    const r = symbolReturns(h, "FON:TP2");
    expect(r.gunluk).not.toBeNull();
    expect(r.haftalik).not.toBeNull();
    expect(r.aylik).toBeNull();
    expect(r.yillik).toBeNull();
  });

  it("uzun geçmişte tüm pencereler dolar ve priceReturnOver ile aynı sonucu verir", () => {
    const fiyatlar = Array.from({ length: 400 }, (_, i) => 100 + i);
    const h = gunler("2025-01-01", fiyatlar);
    const r = symbolReturns(h, "BIST:THYAO");
    expect(r.yillik).toBeCloseTo(priceReturnOver(h, "BIST:THYAO", 365)!, 10);
    expect(r.gunluk).toBeCloseTo(priceReturnOver(h, "BIST:THYAO", 1)!, 10);
    expect(Object.values(r).every((v) => v != null)).toBe(true);
  });
});

/* ————— monthlyTwr ————— */

const dp = (date: string, value: number, contributed = 0): ValueDecompPoint =>
  ({ date, value, contributed, gain: value - contributed, covered: true });

describe("monthlyTwr", () => {
  it("her takvim ayının getirisini ayrı verir, yeniden eskiye sıralı", () => {
    const pts = [
      dp("2026-01-30", 100), dp("2026-01-31", 110),
      dp("2026-02-01", 121), dp("2026-02-28", 121),
      dp("2026-03-01", 121), dp("2026-03-31", 133.1),
    ];
    const aylar = monthlyTwr(pts);
    expect(aylar.map((a) => a.ym)).toEqual(["2026-03", "2026-02", "2026-01"]);
    expect(aylar.find((a) => a.ym === "2026-03")!.pct).toBeCloseTo(10, 6);
  });

  it("ayın İLK günü ıskalanmaz: önceki ayın son noktası tohum alınır", () => {
    /* Şubat'ın tüm hareketi 31 Oca → 1 Şub arasında (100 → 120). Tohumsuz hesapta Şubat
       dilimi yalnız [1 Şub, 28 Şub] olurdu; ilk nokta zincirde getiri üretmediği için
       Şubat %0 görünür, gerçek %20 kaybolurdu. */
    const pts = [
      dp("2026-01-31", 100),
      dp("2026-02-01", 120), dp("2026-02-28", 120),
    ];
    const subat = monthlyTwr(pts).find((a) => a.ym === "2026-02")!;
    expect(subat.pct).toBeCloseTo(20, 6);

    // tohumsuz hesabın ne vereceğini açıkça gösteren karşılaştırma
    const tohumsuz = twrSeries(pts.filter((p) => p.date.startsWith("2026-02"))).at(-1)!.value;
    expect(tohumsuz).toBeCloseTo(0, 6);
  });

  it("ay içinde para eklemek getiriyi ŞİŞİRMEZ (TWR)", () => {
    /* 100 ₺ ile başla, ayın ortasında 100 ₺ ekle, fiyat hiç değişmesin → getiri %0 olmalı.
       Basit değer oranı burada %100 derdi. */
    const pts = [
      dp("2026-01-31", 100, 100),
      dp("2026-02-10", 200, 200), // +100 ₺ konuldu, değer da 200 — kazanç yok
      dp("2026-02-28", 200, 200),
    ];
    expect(monthlyTwr(pts).find((a) => a.ym === "2026-02")!.pct).toBeCloseTo(0, 6);
  });

  it("tek ayda ve boş seride patlamaz", () => {
    expect(monthlyTwr([])).toEqual([]);
    const tek = monthlyTwr([dp("2026-01-10", 100), dp("2026-01-20", 150)]);
    expect(tek).toHaveLength(1);
    expect(tek[0].pct).toBeCloseTo(50, 6);
  });
});

describe("twrByRange", () => {
  const bugun = new Date(2026, 2, 31); // 31 Mart 2026
  const pts = [
    dp("2026-01-01", 100), dp("2026-02-01", 110), dp("2026-03-01", 120), dp("2026-03-31", 130),
  ];

  it("TÜM aralığı, tüm serinin TWR'ına eşittir", () => {
    const r = twrByRange(pts, ["TÜM"], bugun);
    expect(r["TÜM"]).toBeCloseTo(twrSeries(pts).at(-1)!.value, 10);
  });

  it("dar aralık yalnız o pencereyi ölçer", () => {
    const r = twrByRange(pts, ["1A"], bugun);
    // son 30 gün: 2026-03-01 (120) → 2026-03-31 (130)
    expect(r["1A"]).toBeCloseTo((130 / 120 - 1) * 100, 6);
  });

  it("pencerede 2'den az nokta varsa null", () => {
    expect(twrByRange(pts, ["1H"], bugun)["1H"]).toBeNull();
  });

  it("istenen her aralık için anahtar döner", () => {
    const r = twrByRange(pts, ["1H", "1A", "1Y", "TÜM"], bugun);
    expect(Object.keys(r).sort()).toEqual(["1A", "1H", "1Y", "TÜM"].sort());
  });
});
