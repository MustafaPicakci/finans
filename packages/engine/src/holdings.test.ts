import { describe, it, expect } from "vitest";
import { positionPeriods, portfolioFlow } from "./holdings.js";
import { positions, portfolioValueDecomposition, openPositions } from "./portfolio.js";
import type { Trade, PriceHistoryEntry } from "./types.js";

const trade = (over: Partial<Trade>): Trade => ({
  id: 0, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 0, price: 0, fee: 0, currency: "TRY", ...over,
});
const R = { usdTry: 40 };

describe("positionPeriods — giriş/çıkış tarihleri", () => {
  it("açık pozisyonun kapanış tarihi yoktur", () => {
    const p = positionPeriods([trade({ id: 1, date: "2026-01-10", qty: 10, price: 100 })]);
    expect(p).toHaveLength(1);
    expect(p[0].openedAt).toBe("2026-01-10");
    expect(p[0].closedAt).toBeNull();
    expect(p[0].qty).toBe(10);
    expect(p[0].avg).toBe(100);
  });

  it("al → tamamen sat → yeniden al = İKİ ayrı dönem", () => {
    /* Asıl sebep bu: sembol başına tek satır gösterilseydi, Mart'ta kapanan iş ile
       Temmuz'da açılan yeni iş tek bir ortalamada birleşir ve ikisi de görünmez olurdu. */
    const p = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-03-12", side: "SATIŞ", qty: 10, price: 130 }),
      trade({ id: 3, date: "2026-07-01", side: "ALIŞ", qty: 5, price: 200 }),
    ]);
    expect(p).toHaveLength(2);
    // sıralama yeniden eskiye
    const [yeni, eski] = p;
    expect(eski.openedAt).toBe("2026-01-10");
    expect(eski.closedAt).toBe("2026-03-12");
    expect(eski.qty).toBe(0);
    expect(eski.realized).toBe(300); // 10 × (130 − 100)
    expect(yeni.openedAt).toBe("2026-07-01");
    expect(yeni.closedAt).toBeNull();
    expect(yeni.qty).toBe(5);
    expect(yeni.avg).toBe(200); // maliyet sıfırlandı — eski dönemin 100'ü taşınmaz
  });

  it("kısmi satış dönemi kapatmaz", () => {
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-10", side: "SATIŞ", qty: 4, price: 150 }),
    ]);
    expect(p.closedAt).toBeNull();
    expect(p.qty).toBe(6);
    expect(p.peakQty).toBe(10);
  });

  it("konan ve çıkan para komisyonla birlikte toplanır", () => {
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100, fee: 20 }),
      trade({ id: 2, date: "2026-02-10", side: "ALIŞ", qty: 10, price: 120, fee: 10 }),
      trade({ id: 3, date: "2026-03-10", side: "SATIŞ", qty: 5, price: 150, fee: 5 }),
    ]);
    expect(p.invested).toBe(1020 + 1210); // ödenen (komisyon dahil)
    expect(p.returned).toBe(745);         // 5 × 150 − 5
    expect(p.count).toBe(3);
  });

  it("float artığı bırakan satış dönemi KAPALI sayar", () => {
    /* "Tümünü sat" 0.1+0.2 gibi toplamlarda 1e-13 artık bırakabiliyor; eşik olmasaydı
       pozisyon sonsuza dek "açık" görünür ve listede 0 adetle dururdu. */
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 0.3, price: 100 }),
      trade({ id: 2, date: "2026-02-10", side: "SATIŞ", qty: 0.1 + 0.2, price: 120 }),
    ]);
    expect(p.closedAt).toBe("2026-02-10");
    expect(p.qty).toBe(0);
  });

  it("elde olandan fazlasını satmak dönemi kapatır", () => {
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-10", side: "SATIŞ", qty: 12, price: 120 }),
    ]);
    expect(p.closedAt).toBe("2026-02-10");
    expect(p.qty).toBe(0);
  });

  it("TEMETTÜ adedi değiştirmez, dönemin getirisine yazılır", () => {
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-10", side: "TEMETTÜ", qty: 10, price: 3, fee: 4.5 }),
    ]);
    expect(p.qty).toBe(10);
    expect(p.closedAt).toBeNull();
    expect(p.dividend).toBe(25.5);  // 10 × 3 − 4,5 stopaj
    expect(p.realized).toBe(25.5);  // temettü gerçekleşen getirinin İÇİNDE
  });

  it("kapanıştan SONRA ödenen temettü yeni dönem açmaz, kapanış tarihini de değiştirmez", () => {
    const p = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-03-12", side: "SATIŞ", qty: 10, price: 130 }),
      trade({ id: 3, date: "2026-04-20", side: "TEMETTÜ", qty: 10, price: 2 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].closedAt).toBe("2026-03-12"); // temettü tarihi değil
    expect(p[0].dividend).toBe(20);
    expect(p[0].realized).toBe(320);          // 300 satış kârı + 20 temettü
  });

  it("BEDELSİZ adedi artırır, konan parayı artırmaz (ortalama maliyet düşer)", () => {
    const [p] = positionPeriods([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-02-10", side: "BEDELSİZ", qty: 10, price: 0 }),
    ]);
    expect(p.qty).toBe(20);
    expect(p.peakQty).toBe(20);
    expect(p.invested).toBe(1000); // değişmedi
    expect(p.avg).toBe(50);        // 1000 / 20
  });

  it("aynı sembolün farklı varlık türü ayrı dönemdir", () => {
    const p = positionPeriods([
      trade({ id: 1, asset_type: "BIST", symbol: "X", qty: 1, price: 10 }),
      trade({ id: 2, asset_type: "FON", symbol: "X", qty: 1, price: 10 }),
    ]);
    expect(p).toHaveLength(2);
  });
});

describe("positionPeriods — positions() ile ayrışma kapanı", () => {
  /* EN ÖNEMLİ TEST. Ortalama maliyet matematiğinin üçüncü bir kopyası yazılmadı; dönemler
     `tradeLedger`'ın gruplamasıdır. Bu test o sözü bağlar: yarın yeni bir olay türü
     eklenirse ve kopyalardan biri ayrışırsa, burada patlar. */
  const karisik: Trade[] = [
    trade({ id: 1, date: "2026-01-10", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100, fee: 5 }),
    trade({ id: 2, date: "2026-02-10", symbol: "THYAO", side: "TEMETTÜ", qty: 10, price: 3 }),
    trade({ id: 3, date: "2026-03-12", symbol: "THYAO", side: "SATIŞ", qty: 10, price: 130, fee: 7 }),
    trade({ id: 4, date: "2026-07-01", symbol: "THYAO", side: "ALIŞ", qty: 5, price: 200 }),
    trade({ id: 5, date: "2026-02-01", symbol: "EREGL", side: "ALIŞ", qty: 20, price: 40 }),
    trade({ id: 6, date: "2026-04-01", symbol: "EREGL", side: "BEDELSİZ", qty: 20, price: 0 }),
    trade({ id: 7, date: "2026-05-01", symbol: "EREGL", side: "SATIŞ", qty: 15, price: 30 }),
    trade({ id: 8, date: "2026-03-01", symbol: "BTC", asset_type: "KRIPTO", currency: "USD", side: "ALIŞ", qty: 0.5, price: 60000 }),
  ];

  it("sembol başına dönem toplamları positions() ile birebir tutar", () => {
    const per = positionPeriods(karisik);
    for (const pos of positions(karisik, [])) {
      const donemler = per.filter((d) => d.sym === pos.sym && d.type === pos.type);
      const realized = donemler.reduce((s, d) => s + d.realized, 0);
      expect(realized).toBeCloseTo(pos.realized, 10);

      // açık dönemin adedi ve ortalama maliyeti = positions()'ın verdiği
      const acik = donemler.find((d) => d.closedAt == null);
      expect(acik?.qty ?? 0).toBeCloseTo(pos.qty, 10);
      expect(acik?.avg ?? 0).toBeCloseTo(pos.avg, 10);
    }
  });

  it("açık dönem kümesi openPositions() ile aynı sembolleri verir", () => {
    const acikDonem = positionPeriods(karisik).filter((d) => d.closedAt == null).map((d) => `${d.type}:${d.sym}`).sort();
    const acikPoz = openPositions(positions(karisik, [])).map((p) => `${p.type}:${p.sym}`).sort();
    expect(acikDonem).toEqual(acikPoz);
  });

  it("hiç işlem yoksa boş döner", () => {
    expect(positionPeriods([])).toEqual([]);
  });
});

describe("portfolioFlow", () => {
  const akis: Trade[] = [
    trade({ id: 1, date: "2026-01-10", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 100 }),
    trade({ id: 2, date: "2026-01-20", symbol: "EREGL", side: "ALIŞ", qty: 20, price: 40 }),
    trade({ id: 3, date: "2026-02-05", symbol: "THYAO", side: "ALIŞ", qty: 5, price: 120 }),
    trade({ id: 4, date: "2026-02-18", symbol: "EREGL", side: "SATIŞ", qty: 20, price: 50 }),
    trade({ id: 5, date: "2026-03-02", symbol: "THYAO", side: "SATIŞ", qty: 5, price: 130 }),
  ];

  it("olayların cinsini doğru ayırır", () => {
    const aylar = portfolioFlow(akis, R);
    const kind = (ym: string, sym: string) => aylar.find((m) => m.ym === ym)!.events.find((e) => e.sym === sym)!.kind;
    expect(kind("2026-01", "THYAO")).toBe("acildi");  // sıfırdan açıldı
    expect(kind("2026-02", "THYAO")).toBe("artti");   // üstüne alındı
    expect(kind("2026-02", "EREGL")).toBe("kapandi"); // tamamen satıldı
    expect(kind("2026-03", "THYAO")).toBe("azaldi");  // kısmi satış
  });

  it("aylar ve ay içi olaylar yeniden eskiye sıralanır", () => {
    const aylar = portfolioFlow(akis, R);
    expect(aylar.map((m) => m.ym)).toEqual(["2026-03", "2026-02", "2026-01"]);
    expect(aylar[1].events.map((e) => e.date)).toEqual(["2026-02-18", "2026-02-05"]);
  });

  it("aylık net akışın toplamı, grafikteki 'konan para' ile AYNI sayıdır", () => {
    /* İki ekran aynı soruya iki farklı cevap vermesin diye: `netTry` tanımı
       `walkValueHistory`'nin `contributed`'ı ile birebir aynı (`-cashDelta`). */
    const hist: PriceHistoryEntry[] = [{ date: "2026-03-31", symbol: "THYAO", asset_type: "BIST", price: 130 }];
    const toplam = portfolioFlow(akis, R).reduce((s, m) => s + m.netTry, 0);
    const son = portfolioValueDecomposition(akis, hist, R).at(-1)!;
    expect(toplam).toBeCloseTo(son.contributed, 10);
  });

  it("USD işlem net akışa güncel kurla TRY olarak girer", () => {
    const [ay] = portfolioFlow([
      trade({ id: 1, date: "2026-01-10", symbol: "BTC", asset_type: "KRIPTO", currency: "USD", side: "ALIŞ", qty: 1, price: 100 }),
    ], R);
    expect(ay.netTry).toBe(4000); // 100 USD × 40
  });

  it("BEDELSİZ net akışı değiştirmez, TEMETTÜ azaltır", () => {
    const [ay] = portfolioFlow([
      trade({ id: 1, date: "2026-01-10", side: "ALIŞ", qty: 10, price: 100 }),
      trade({ id: 2, date: "2026-01-11", side: "BEDELSİZ", qty: 10, price: 0 }),
      trade({ id: 3, date: "2026-01-12", side: "TEMETTÜ", qty: 20, price: 2 }),
    ], R);
    expect(ay.netTry).toBe(1000 - 40); // bedelsiz 0 etki, temettü katkıyı azaltır
  });

  it("hiç işlem yoksa boş döner", () => {
    expect(portfolioFlow([], R)).toEqual([]);
  });
});
