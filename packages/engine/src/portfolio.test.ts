import { describe, it, expect } from "vitest";
import { positions, portfolioValueHistory, portfolioValueDecomposition, coveredOnly, twrSeries, rebasePct, heldSymbols, symbolPriceSeries, symbolValueHistory, portfolioValueTry, convert, groupTradesByPortfolio, portfolioGroupValueTry, tradeLedger, summarizeTrades, sliceValueHistory, bucketValueHistory, historyChange, qtyDelta, cashDelta, pnlPct } from "./portfolio.js";
import type { Trade, Price, PriceHistoryEntry } from "./types.js";

const trade = (over: Partial<Trade>): Trade => ({
  id: 0, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 0, price: 0, fee: 0, currency: "TRY", ...over,
});
const R = { usdTry: 40 }; // test FX: 1 USD = 40 TRY

describe("positions", () => {
  it("tek alışta ortalama maliyet birim fiyata eşittir", () => {
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(p.qty).toBe(10);
    expect(p.avg).toBe(100);
  });

  it("iki alışta ağırlıklı ortalama maliyet hesaplanır", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", qty: 10, price: 200 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(20);
    expect(p.avg).toBe(150); // (10*100 + 10*200) / 20
  });

  it("satışta gerçekleşen K/Z = adet × (satış − ortalama) − komisyon", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 4, price: 150, fee: 5 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(6);
    expect(p.realized).toBeCloseTo(4 * (150 - 100) - 5); // 195
    expect(p.avg).toBe(100); // kalan payın maliyeti değişmez
  });

  it("pozisyon tamamen kapanıp yeniden açılınca maliyet sıfırlanır", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 10, price: 120 }),
      trade({ id: 3, date: "2026-03-01", side: "ALIŞ", qty: 5, price: 300 }),
    ];
    const [p] = positions(trades, []);
    expect(p.qty).toBe(5);
    expect(p.avg).toBe(300); // eski maliyetten etkilenmemeli
    expect(p.realized).toBeCloseTo(10 * (120 - 100)); // ilk turdan gerçekleşen K/Z korunur
  });

  it("fiyat yoksa değer ve açık K/Z null döner", () => {
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(p.cur).toBeNull();
    expect(p.value).toBeNull();
    expect(p.unreal).toBeNull();
  });

  it("fiyat varsa değer ve açık K/Z hesaplanır, kaynak taşınır", () => {
    const prices: Price[] = [{ symbol: "THYAO", asset_type: "BIST", price: 130, source: "manual", updated_at: "2026-01-01" }];
    const [p] = positions([trade({ id: 1, qty: 10, price: 100 })], prices);
    expect(p.value).toBe(1300);
    expect(p.unreal).toBeCloseTo(300);
    expect(p.unrealPct).toBeCloseTo(0.3); // 300 / 1000 maliyet = %30
    expect(p.source).toBe("manual");
  });

  it("açık K/Z yüzdesi maliyete oranlanır; fiyat yoksa null", () => {
    const [noPrice] = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(noPrice.unrealPct).toBeNull();
    // komisyon maliyete girer: 10×100 + 50 = 1050 maliyet, değer 1100 → +50 / 1050
    const prices: Price[] = [{ symbol: "THYAO", asset_type: "BIST", price: 110, source: "auto", updated_at: "2026-01-01" }];
    const [withFee] = positions([trade({ id: 1, qty: 10, price: 100, fee: 50 })], prices);
    expect(withFee.unrealPct).toBeCloseTo(50 / 1050);
  });

  it("pnlPct sıfır/negatif maliyette null döner (0'a bölme yok)", () => {
    expect(pnlPct(100, 0)).toBeNull();
    expect(pnlPct(100, -5)).toBeNull();
    expect(pnlPct(-25, 100)).toBeCloseTo(-0.25);
  });

  it("işlemin para birimini pozisyona taşır; USD pozisyon native (USD) hesaplanır", () => {
    const trades = [trade({ id: 1, asset_type: "ETF", symbol: "VOO", qty: 2, price: 150, currency: "USD" })];
    const prices: Price[] = [{ symbol: "VOO", asset_type: "ETF", price: 180, source: "auto", updated_at: "2026-01-01", currency: "USD" }];
    const [p] = positions(trades, prices);
    expect(p.currency).toBe("USD");
    expect(p.avg).toBe(150);       // USD
    expect(p.value).toBe(360);     // 2 × 180 USD (TRY'ye çevrilmedi)
    expect(p.unreal).toBeCloseTo(60); // 2 × (180−150) USD
  });

  it("currency verilmemiş (eski) işlem TRY sayılır", () => {
    const legacy = { id: 1, date: "2026-01-01", asset_type: "BIST" as const, symbol: "THYAO", side: "ALIŞ" as const, qty: 10, price: 100, fee: 0 } as unknown as Trade;
    const [p] = positions([legacy], []);
    expect(p.currency).toBe("TRY");
  });
});

describe("convert", () => {
  it("aynı birimde değeri değiştirmez", () => {
    expect(convert(100, "TRY", "TRY", R)).toBe(100);
    expect(convert(100, "USD", "USD", R)).toBe(100);
  });
  it("USD→TRY ve TRY→USD çevirir", () => {
    expect(convert(10, "USD", "TRY", R)).toBe(400);   // 10 × 40
    expect(convert(400, "TRY", "USD", R)).toBe(10);   // 400 / 40
  });
  it("kur yoksa (0) dönüştürmez, aynı değeri döner", () => {
    expect(convert(10, "USD", "TRY", { usdTry: 0 })).toBe(10);
  });
});

describe("portfolioValueTry", () => {
  it("karışık TRY + USD portföyü TRY'de toplar", () => {
    const trades = [
      trade({ id: 1, asset_type: "BIST", symbol: "THYAO", qty: 10, price: 100, currency: "TRY" }),
      trade({ id: 2, asset_type: "ETF", symbol: "VOO", qty: 2, price: 150, currency: "USD" }),
    ];
    const prices: Price[] = [
      { symbol: "THYAO", asset_type: "BIST", price: 130, source: "auto", updated_at: "x", currency: "TRY" },
      { symbol: "VOO", asset_type: "ETF", price: 180, source: "auto", updated_at: "x", currency: "USD" },
    ];
    const pos = positions(trades, prices);
    // THYAO: 10×130=1300 TRY, VOO: 2×180=360 USD × 40 = 14400 TRY → toplam 15700
    expect(portfolioValueTry(pos, R)).toBeCloseTo(15700);
  });

  it("fiyatı olmayan pozisyon toplama katkı vermez", () => {
    const pos = positions([trade({ id: 1, qty: 10, price: 100 })], []);
    expect(portfolioValueTry(pos, R)).toBe(0);
  });
});

describe("portfolioValueHistory", () => {
  const hist = (over: Partial<PriceHistoryEntry>): PriceHistoryEntry => ({
    symbol: "THYAO", asset_type: "BIST", date: "2026-01-01", price: 0, ...over,
  });

  it("fiyat geçmişi yoksa boş dizi döner", () => {
    expect(portfolioValueHistory([trade({ id: 1, qty: 10, price: 100 })], [], R)).toEqual([]);
  });

  it("işlemden önceki günlerde miktar sıfır olduğundan değer sıfırdır", () => {
    const trades = [trade({ id: 1, date: "2026-01-10", qty: 10, price: 100 })];
    const prices = [hist({ date: "2026-01-05", price: 120 })];
    const result = portfolioValueHistory(trades, prices, R);
    expect(result).toEqual([{ date: "2026-01-05", value: 0 }]);
  });

  it("işlem sonrası günlerde miktar × o günkü fiyat hesaplanır", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 })];
    const prices = [hist({ date: "2026-01-05", price: 120 }), hist({ date: "2026-01-10", price: 150 })];
    const result = portfolioValueHistory(trades, prices, R);
    expect(result).toEqual([
      { date: "2026-01-05", value: 1200 },
      { date: "2026-01-10", value: 1500 },
    ]);
  });

  it("bilinmeyen bir güne en yakın önceki fiyatı forward-fill eder", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 })];
    // sadece THYAO için 01-05'te fiyat var; ALTIN için hiç yok (o gün 01-08'de kayıt oluşuyor)
    const prices = [
      hist({ symbol: "THYAO", date: "2026-01-05", price: 120 }),
      hist({ symbol: "GRAM", asset_type: "ALTIN", date: "2026-01-08", price: 4000 }),
    ];
    const result = portfolioValueHistory(trades, prices, R);
    // 01-08'de THYAO fiyatı hâlâ 01-05'ten forward-fill edilir (10*120=1200); ALTIN'de işlem yok
    const day8 = result.find((r) => r.date === "2026-01-08")!;
    expect(day8.value).toBe(1200);
  });

  it("satış sonrası miktar azalınca değer de düşer", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-15", side: "SATIŞ", qty: 6, price: 110 }),
    ];
    const prices = [hist({ date: "2026-01-20", price: 130 })];
    const result = portfolioValueHistory(trades, prices, R);
    expect(result).toEqual([{ date: "2026-01-20", value: 4 * 130 }]);
  });
});

describe("portfolioValueDecomposition — kâr mı, para ekleme mi? (Faz 27)", () => {
  const hist = (over: Partial<PriceHistoryEntry>): PriceHistoryEntry => ({
    symbol: "THYAO", asset_type: "BIST", date: "2026-01-01", price: 0, ...over,
  });

  it("ALIŞ katkıyı artırır; kâr = değer − katkı", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 })];
    const [d] = portfolioValueDecomposition(trades, [hist({ date: "2026-01-05", price: 120 })], R);
    expect(d.contributed).toBe(1000);
    expect(d.value).toBe(1200);
    expect(d.gain).toBe(200);
  });

  it("komisyon konulan paraya dahildir (kârı azaltır)", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", qty: 10, price: 100, fee: 50 })];
    const [d] = portfolioValueDecomposition(trades, [hist({ date: "2026-01-05", price: 120 })], R);
    expect(d.contributed).toBe(1050);
    expect(d.gain).toBe(150);
  });

  it("SATIŞ katkıyı azaltır — kâr, gerçekleşen + gerçekleşmeyenin toplamına eşit çıkar", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-15", side: "SATIŞ", qty: 6, price: 110 }),
    ];
    const [d] = portfolioValueDecomposition(trades, [hist({ date: "2026-01-20", price: 130 })], R);
    expect(d.contributed).toBe(1000 - 660);
    expect(d.value).toBe(4 * 130);
    /* gerçekleşen 6×(110−100)=60, gerçekleşmeyen 4×(130−100)=120 → 180 */
    expect(d.gain).toBe(180);
  });

  it("TEMETTÜ katkıyı azaltır, yani kâr olarak görünür", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-10", side: "TEMETTÜ", qty: 10, price: 0.5 }),
    ];
    const [d] = portfolioValueDecomposition(trades, [hist({ date: "2026-01-20", price: 100 })], R);
    expect(d.contributed).toBe(995); // 1000 konuldu, 5 geri alındı
    expect(d.value).toBe(1000);
    expect(d.gain).toBe(5); // pozisyon başa baş; kârın tamamı temettü
  });

  it("BEDELSİZ katkıyı değiştirmez (para hareketi yok)", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-10", side: "BEDELSİZ", qty: 10, price: 0 }),
    ];
    const [d] = portfolioValueDecomposition(trades, [hist({ date: "2026-01-20", price: 60 })], R);
    expect(d.contributed).toBe(1000);
    expect(d.value).toBe(20 * 60);
    expect(d.gain).toBe(200);
  });

  it("USD işlemin katkısı da TRY'ye çevrilir", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", asset_type: "ETF", symbol: "VOO", qty: 2, price: 100, currency: "USD" })];
    const prices = [hist({ symbol: "VOO", asset_type: "ETF", date: "2026-01-05", price: 110 })];
    const [d] = portfolioValueDecomposition(trades, prices, R);
    expect(d.contributed).toBe(200 * 40);
    expect(d.value).toBe(2 * 110 * 40);
  });

  it("fiyatı bilinmeyen AÇIK pozisyon o günü kapsam dışı yapar", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-01", symbol: "TP2", asset_type: "FON", qty: 100, price: 1 }),
    ];
    const prices = [
      hist({ symbol: "THYAO", date: "2026-01-05", price: 120 }),
      hist({ symbol: "TP2", asset_type: "FON", date: "2026-01-08", price: 1.2 }),
    ];
    const out = portfolioValueDecomposition(trades, prices, R);
    expect(out.map((d) => [d.date, d.covered])).toEqual([["2026-01-05", false], ["2026-01-08", true]]);
    /* kapsam dışı gün fonu 0 sayardı → 1200; çizilseydi 01-08'de sahte sıçrama olurdu */
    expect(out[0].value).toBe(1200);
    expect(coveredOnly(out).map((d) => d.date)).toEqual(["2026-01-08"]);
  });

  it("kapanmış pozisyonun fiyatı bilinmese de kapsamı bozmaz", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", symbol: "ESKI", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-02", symbol: "ESKI", side: "SATIŞ", qty: 10, price: 110 }),
      trade({ id: 3, date: "2026-01-03", symbol: "THYAO", qty: 5, price: 200 }),
    ];
    const out = portfolioValueDecomposition(trades, [hist({ symbol: "THYAO", date: "2026-01-05", price: 220 })], R);
    expect(out[0].covered).toBe(true);
    expect(coveredOnly(out)).toHaveLength(1);
  });

  it("hiçbir gün tam kapsanmıyorsa coveredOnly boş döner", () => {
    const trades = [trade({ id: 1, date: "2026-01-01", symbol: "TP2", asset_type: "FON", qty: 100, price: 1 })];
    const out = portfolioValueDecomposition(trades, [hist({ symbol: "THYAO", date: "2026-01-05", price: 120 })], R);
    expect(coveredOnly(out)).toEqual([]);
  });
});

describe("çoklu seri / getiri (%) modu (Faz 27)", () => {
  const hist = (over: Partial<PriceHistoryEntry>): PriceHistoryEntry => ({
    symbol: "THYAO", asset_type: "BIST", date: "2026-01-01", price: 0, ...over,
  });

  it("twrSeries para eklemeyi getiri saymaz", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-02", qty: 10, price: 110 }), // ortada para EKLENDİ
    ];
    const prices = [
      hist({ date: "2026-01-01", price: 100 }),
      hist({ date: "2026-01-02", price: 110 }),
      hist({ date: "2026-01-03", price: 121 }),
    ];
    const twr = twrSeries(portfolioValueDecomposition(trades, prices, R));
    expect(twr.map((p) => Math.round(p.value * 100) / 100)).toEqual([0, 10, 21]);
  });

  it("basit değer oranı aynı veride yanıltıcıdır (TWR'nin var oluş sebebi)", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-02", qty: 10, price: 110 }),
    ];
    const prices = [
      hist({ date: "2026-01-01", price: 100 }),
      hist({ date: "2026-01-02", price: 110 }),
      hist({ date: "2026-01-03", price: 121 }),
    ];
    const dec = portfolioValueDecomposition(trades, prices, R);
    /* değer 1000 → 2420, yani "+%142" gibi görünür; oysa gerçek getiri %21 */
    expect(rebasePct(dec).at(-1)!.value).toBeCloseTo(142, 0);
    expect(twrSeries(dec).at(-1)!.value).toBeCloseTo(21, 6);
  });

  it("DÜRÜST KISIT: akışın olduğu günde fiyat anlık görüntüsü yoksa TWR şişer", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-02", qty: 10, price: 110 }), // bu günde price_history YOK
    ];
    const prices = [hist({ date: "2026-01-01", price: 100 }), hist({ date: "2026-01-03", price: 121 })];
    const twr = twrSeries(portfolioValueDecomposition(trades, prices, R));
    /* Ara değerleme olmadığı için eklenen 1.100 ₺'nin kazandığı 110 ₺, dönem başındaki
       1.000 ₺'nin getirisi sayılır: %21 yerine %32. price_history günlük yazıldığından
       pratikte akış günü neredeyse hep değerlenmiştir; kural yine de burada kayıtlı. */
    expect(twr.at(-1)!.value).toBeCloseTo(32, 6);
  });

  it("rebasePct ilk noktayı 0 kabul eder", () => {
    expect(rebasePct([{ date: "a", value: 50 }, { date: "b", value: 75 }, { date: "c", value: 25 }]))
      .toEqual([{ date: "a", value: 0 }, { date: "b", value: 50 }, { date: "c", value: -50 }]);
  });

  it("symbolPriceSeries yalnız o sembolü, tarih sırasıyla verir", () => {
    const ph = [
      hist({ symbol: "TP2", asset_type: "FON", date: "2026-01-02", price: 2 }),
      hist({ symbol: "THYAO", date: "2026-01-02", price: 110 }),
      hist({ symbol: "THYAO", date: "2026-01-01", price: 100 }),
    ];
    expect(symbolPriceSeries(ph, "BIST:THYAO")).toEqual([
      { date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 110 },
    ]);
  });

  it("symbolValueHistory tek sembolün pozisyon değerini verir", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-01", symbol: "ASELS", qty: 5, price: 60 }),
    ];
    const prices = [hist({ symbol: "THYAO", date: "2026-01-05", price: 120 }), hist({ symbol: "ASELS", date: "2026-01-05", price: 70 })];
    expect(symbolValueHistory(trades, prices, R, "BIST:THYAO")).toEqual([{ date: "2026-01-05", value: 1200 }]);
  });

  it("heldSymbols kapanmış pozisyonu listelemez", () => {
    const out = heldSymbols([
      trade({ id: 1, symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, symbol: "ESKI", qty: 10, price: 100 }),
      trade({ id: 3, symbol: "ESKI", side: "SATIŞ", qty: 10, price: 120 }),
      trade({ id: 4, symbol: "TP2", asset_type: "FON", qty: 100, price: 1 }),
    ]);
    expect(out.map((h) => h.key)).toEqual(["BIST:THYAO", "FON:TP2"]);
  });
});

describe("groupTradesByPortfolio (Faz 11)", () => {
  it("işlemleri gruba ayırır, grupsuzlar null anahtarda toplanır", () => {
    const by = groupTradesByPortfolio([
      trade({ id: 1, portfolio_id: 7, qty: 10, price: 100 }),
      trade({ id: 2, portfolio_id: 7, qty: 5, price: 120 }),
      trade({ id: 3, qty: 1, price: 50 }),
    ]);
    expect(new Set(by.keys())).toEqual(new Set([7, null]));
    expect(by.get(7)!.map((t) => t.id)).toEqual([1, 2]);
    expect(by.get(null)!.map((t) => t.id)).toEqual([3]);
  });

  it("aynı sembol iki portföyde AYRI pozisyondur (ayrı ortalama maliyet)", () => {
    const trades = [
      trade({ id: 1, portfolio_id: 1, symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, portfolio_id: 2, symbol: "THYAO", qty: 10, price: 300 }),
    ];
    const by = groupTradesByPortfolio(trades);
    const [a] = positions(by.get(1)!, []);
    const [b] = positions(by.get(2)!, []);
    expect(a.avg).toBe(100);
    expect(b.avg).toBe(300);
    // tek listede değerlenince (net varlık yolu) tek pozisyonda birleşir — toplam korunur
    const [all] = positions(trades, []);
    expect(all.qty).toBe(20);
    expect(all.avg).toBe(200);
  });

  it("grup değeri o grubun işlemlerinden hesaplanır (TRY'ye çevrili)", () => {
    const prices: Price[] = [
      { symbol: "THYAO", asset_type: "BIST", price: 150, source: "auto", updated_at: "", currency: "TRY" },
      { symbol: "VOO", asset_type: "ETF", price: 200, source: "auto", updated_at: "", currency: "USD" },
    ];
    const trades = [
      trade({ id: 1, portfolio_id: 1, symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, portfolio_id: 2, asset_type: "ETF", symbol: "VOO", qty: 2, price: 150, currency: "USD" }),
    ];
    const by = groupTradesByPortfolio(trades);
    expect(portfolioGroupValueTry(by.get(1)!, prices, R)).toBe(1500);      // 10 × 150 TRY
    expect(portfolioGroupValueTry(by.get(2)!, prices, R)).toBe(2 * 200 * 40); // 2 × 200 USD × 40
  });
});

describe("tradeLedger (Faz 12 — hareket geçmişi)", () => {
  it("her işlemin öncesi/sonrası adet ve ortalama maliyetini verir", () => {
    const l = tradeLedger([
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", qty: 10, price: 200 }),
    ]);
    expect(l[0]).toMatchObject({ qtyBefore: 0, avgBefore: 0, qtyAfter: 10, avgAfter: 100, cash: 1000, realized: 0 });
    expect(l[1]).toMatchObject({ qtyBefore: 10, avgBefore: 100, qtyAfter: 20, avgAfter: 150, cash: 2000 });
  });

  it("kronolojik sıralar — girdi sırası karışık olsa da", () => {
    const l = tradeLedger([
      trade({ id: 2, date: "2026-02-01", qty: 10, price: 200 }),
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
    ]);
    expect(l.map((e) => e.trade.id)).toEqual([1, 2]);
  });

  it("satışta gerçekleşen K/Z ve ele geçen tutar komisyonu içerir", () => {
    const l = tradeLedger([
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 4, price: 150, fee: 5 }),
    ]);
    expect(l[1].realized).toBe(4 * 50 - 5);   // 195
    expect(l[1].cash).toBe(4 * 150 - 5);      // 595 (ele geçen)
    expect(l[1].avgAfter).toBe(100);          // satış ortalamayı değiştirmez
    expect(l[1].qtyAfter).toBe(6);
    expect(l[1].closed).toBe(false);
  });

  it("pozisyonu tamamen kapatan satışı işaretler, yeniden alışta maliyet sıfırdan başlar", () => {
    const l = tradeLedger([
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 10, price: 120 }),
      trade({ id: 3, date: "2026-03-01", qty: 5, price: 300 }),
    ]);
    expect(l[1].closed).toBe(true);
    expect(l[1].qtyAfter).toBe(0);
    expect(l[2]).toMatchObject({ qtyBefore: 0, avgBefore: 0, avgAfter: 300 });
  });

  it("defterin son hali positions() ile birebir aynıdır", () => {
    const trades = [
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100, fee: 3 }),
      trade({ id: 2, date: "2026-02-01", qty: 5, price: 140 }),
      trade({ id: 3, date: "2026-03-01", side: "SATIŞ", qty: 6, price: 200, fee: 4 }),
    ];
    const last = tradeLedger(trades).at(-1)!;
    const [p] = positions(trades, []);
    expect(last.qtyAfter).toBeCloseTo(p.qty);
    expect(last.avgAfter).toBeCloseTo(p.avg);
    expect(tradeLedger(trades).reduce((s, e) => s + e.realized, 0)).toBeCloseTo(p.realized);
  });

  it("farklı semboller birbirinin ortalamasını etkilemez", () => {
    const l = tradeLedger([
      trade({ id: 1, date: "2026-01-01", symbol: "THYAO", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-02", symbol: "ASELS", qty: 10, price: 50 }),
      trade({ id: 3, date: "2026-01-03", symbol: "THYAO", qty: 10, price: 300 }),
    ]);
    expect(l[1].avgAfter).toBe(50);
    expect(l[2].avgAfter).toBe(200);
  });

  it("summarizeTrades alış/satış/komisyon/gerçekleşen toplar", () => {
    const s = summarizeTrades(tradeLedger([
      trade({ id: 1, date: "2026-01-01", qty: 10, price: 100, fee: 2 }),
      trade({ id: 2, date: "2026-02-01", side: "SATIŞ", qty: 4, price: 150, fee: 5 }),
    ]));
    // alış komisyonu maliyete girer → ort. 100.2; gerçekleşen = 4×(150−100.2) − 5 = 194.2
    expect(s.realized).toBeCloseTo(194.2);
    expect(s).toMatchObject({ buy: 1002, sell: 595, fee: 7, count: 2 });
  });
});

describe("değer grafiği aralıkları (Faz 13)", () => {
  /** n günlük seri: bugünden geriye, değer = gün indeksi */
  const series = (n: number, today = new Date("2026-06-30T12:00:00Z")) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (n - 1 - i));
      return { date: d.toISOString().slice(0, 10), value: i };
    });
  const TODAY = new Date("2026-06-30T12:00:00Z");

  it("1H son 7 günü, 1A son 30 günü verir", () => {
    const pts = series(120);
    expect(sliceValueHistory(pts, "1H", TODAY)).toHaveLength(8);  // bugün dahil sınır günü
    expect(sliceValueHistory(pts, "1A", TODAY)).toHaveLength(31);
    expect(sliceValueHistory(pts, "TÜM", TODAY)).toHaveLength(120);
  });

  it("aralık veriden uzunsa eldeki tüm noktalar döner (uydurma veri yok)", () => {
    const pts = series(10);
    expect(sliceValueHistory(pts, "1Y", TODAY)).toHaveLength(10);
  });

  it("seyreltme nokta sayısını sınırlar, ilk ve son noktayı korur", () => {
    const pts = series(365);
    const b = bucketValueHistory(pts, 60);
    expect(b.length).toBeLessThanOrEqual(61);
    expect(b[0]).toEqual(pts[0]);
    expect(b.at(-1)).toEqual(pts.at(-1));
  });

  it("nokta sayısı sınırın altındaysa seri aynen döner", () => {
    const pts = series(20);
    expect(bucketValueHistory(pts, 60)).toEqual(pts);
  });

  it("dönem değişimi ilk → son üzerinden hesaplanır", () => {
    const c = historyChange([{ date: "2026-01-01", value: 1000 }, { date: "2026-02-01", value: 1250 }]);
    expect(c.abs).toBe(250);
    expect(c.pct).toBeCloseTo(25);
  });

  it("tek nokta veya sıfır başlangıçta yüzde null döner", () => {
    expect(historyChange([{ date: "2026-01-01", value: 100 }])).toEqual({ abs: 0, pct: null });
    expect(historyChange([{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 50 }]).pct).toBeNull();
  });
});

/* ————— TEMETTÜ / BEDELSİZ (Faz 21) ————— */
describe("qtyDelta / cashDelta", () => {
  it("adet etkisi: ALIŞ +, SATIŞ −, BEDELSİZ +, TEMETTÜ 0", () => {
    expect(qtyDelta(trade({ side: "ALIŞ", qty: 10 }))).toBe(10);
    expect(qtyDelta(trade({ side: "SATIŞ", qty: 10 }))).toBe(-10);
    expect(qtyDelta(trade({ side: "BEDELSİZ", qty: 10 }))).toBe(10);
    expect(qtyDelta(trade({ side: "TEMETTÜ", qty: 10 }))).toBe(0);
  });

  it("nakit etkisi: ALIŞ çıkar, SATIŞ/TEMETTÜ girer, BEDELSİZ hiç", () => {
    expect(cashDelta(trade({ side: "ALIŞ", qty: 10, price: 100, fee: 5 }))).toBe(-1005);
    expect(cashDelta(trade({ side: "SATIŞ", qty: 10, price: 100, fee: 5 }))).toBe(995);
    expect(cashDelta(trade({ side: "TEMETTÜ", qty: 100, price: 2, fee: 0 }))).toBe(200);
    expect(cashDelta(trade({ side: "BEDELSİZ", qty: 50, price: 0, fee: 0 }))).toBe(0);
  });
});

describe("positions — temettü", () => {
  const buy = trade({ id: 1, side: "ALIŞ", qty: 100, price: 50 }); // maliyet 5000, ort. 50

  it("adedi ve ortalama maliyeti DEĞİŞTİRMEZ, gerçekleşen getiriye yazılır", () => {
    const div = trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3 }); // 300 ₺
    const [p] = positions([buy, div], []);
    expect(p.qty).toBe(100);
    expect(p.avg).toBe(50);      // maliyetten DÜŞÜLMEZ
    expect(p.realized).toBe(300);
  });

  it("stopaj/komisyon fee olarak düşülür", () => {
    const div = trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3, fee: 30 });
    expect(positions([buy, div], [])[0].realized).toBe(270);
  });

  it("satış K/Z'si temettüden etkilenmez (çift sayım yok)", () => {
    const div = trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3 });
    const sell = trade({ id: 3, date: "2026-03-01", side: "SATIŞ", qty: 100, price: 60 });
    const withDiv = positions([buy, div, sell], [])[0];
    const noDiv = positions([buy, sell], [])[0];
    expect(noDiv.realized).toBe(1000);                 // 100 × (60−50)
    expect(withDiv.realized).toBe(1300);               // satış kârı + temettü, ayrı ayrı
    expect(withDiv.realized - noDiv.realized).toBe(300);
  });
});

describe("positions — bedelsiz", () => {
  const buy = trade({ id: 1, side: "ALIŞ", qty: 100, price: 50 }); // maliyet 5000

  it("adet artar, TOPLAM maliyet sabit kalır → ortalama düşer", () => {
    const bonus = trade({ id: 2, date: "2026-02-01", side: "BEDELSİZ", qty: 100, price: 0 }); // %100
    const [p] = positions([buy, bonus], []);
    expect(p.qty).toBe(200);
    expect(p.avg).toBe(25);        // 5000 / 200
    expect(p.realized).toBe(0);    // kâr/zarar doğurmaz
  });

  it("bedelsiz sonrası satışta K/Z düşmüş ortalamadan hesaplanır", () => {
    const bonus = trade({ id: 2, date: "2026-02-01", side: "BEDELSİZ", qty: 100, price: 0 });
    const sell = trade({ id: 3, date: "2026-03-01", side: "SATIŞ", qty: 200, price: 30 });
    const [p] = positions([buy, bonus, sell], []);
    expect(p.qty).toBe(0);
    expect(p.realized).toBe(1000); // 200 × (30 − 25); toplam 6000 ele geçti, 5000 ödenmişti
  });

  it("bedelsiz tek başına net varlığı değiştirmez (adet × ortalama sabit)", () => {
    const bonus = trade({ id: 2, date: "2026-02-01", side: "BEDELSİZ", qty: 400, price: 0 });
    const [p] = positions([buy, bonus], []);
    expect(p.qty * p.avg).toBeCloseTo(5000, 10);
  });
});

describe("tradeLedger — temettü/bedelsiz satırları", () => {
  const buy = trade({ id: 1, side: "ALIŞ", qty: 100, price: 50 });

  it("temettü satırı: adet ve ortalama aynı kalır, nakit = gerçekleşen", () => {
    const div = trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3, fee: 30 });
    const e = tradeLedger([buy, div])[1];
    expect([e.qtyBefore, e.qtyAfter]).toEqual([100, 100]);
    expect([e.avgBefore, e.avgAfter]).toEqual([50, 50]);
    expect(e.cash).toBe(270);
    expect(e.realized).toBe(270);
    expect(e.closed).toBe(false);
  });

  it("bedelsiz satırı: adet artar, ortalama düşer, nakit 0", () => {
    const bonus = trade({ id: 2, date: "2026-02-01", side: "BEDELSİZ", qty: 100, price: 0 });
    const e = tradeLedger([buy, bonus])[1];
    expect([e.qtyBefore, e.qtyAfter]).toEqual([100, 200]);
    expect([e.avgBefore, e.avgAfter]).toEqual([50, 25]);
    expect(e.cash).toBe(0);
    expect(e.realized).toBe(0);
  });

  it("tradeLedger sonu positions ile aynı yeri gösterir (aynı matematik)", () => {
    const all = [buy,
      trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3 }),
      trade({ id: 3, date: "2026-03-01", side: "BEDELSİZ", qty: 100, price: 0 }),
      trade({ id: 4, date: "2026-04-01", side: "SATIŞ", qty: 50, price: 40 })];
    const last = tradeLedger(all).at(-1)!;
    const [p] = positions(all, []);
    expect(last.qtyAfter).toBe(p.qty);
    expect(last.avgAfter).toBeCloseTo(p.avg, 10);
  });
});

describe("summarizeTrades — temettü ayrı gösterilir", () => {
  it("dividend realized'ın içinde ama ayrıca raporlanır", () => {
    const s = summarizeTrades(tradeLedger([
      trade({ id: 1, side: "ALIŞ", qty: 100, price: 50 }),
      trade({ id: 2, date: "2026-02-01", side: "TEMETTÜ", qty: 100, price: 3 }),
      trade({ id: 3, date: "2026-03-01", side: "SATIŞ", qty: 100, price: 60 }),
    ]));
    expect(s.buy).toBe(5000);
    expect(s.sell).toBe(6000);
    expect(s.dividend).toBe(300);
    expect(s.realized).toBe(1300); // temettü dahil
    expect(s.count).toBe(3);
  });

  it("bedelsiz alış/satış toplamlarını kirletmez", () => {
    const s = summarizeTrades(tradeLedger([
      trade({ id: 1, side: "ALIŞ", qty: 100, price: 50 }),
      trade({ id: 2, date: "2026-02-01", side: "BEDELSİZ", qty: 100, price: 0 }),
    ]));
    expect(s.buy).toBe(5000);
    expect(s.sell).toBe(0);
    expect(s.dividend).toBe(0);
  });
});
