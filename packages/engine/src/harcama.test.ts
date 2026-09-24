import { describe, it, expect } from "vitest";
import { harcamaOzeti, type HarcamaVeri } from "./harcama.js";
import type { CardTx, Category, Transaction, Card } from "./types.js";

const kat = (id: number, name: string, kind: "income" | "expense" = "expense"): Category =>
  ({ id, name, kind, color: null });
const tx = (id: number, date: string, name: string, amount: number, category_id: number | null = null): Transaction =>
  ({ id, date, name, amount, category_id, account_id: 1 });
const ktx = (id: number, date: string, name: string, amount: number, card_id = 1, installments = 1,
  category_id: number | null = null): CardTx => ({ id, card_id, date, name, amount, installments, category_id });
const kart = (id: number, name: string): Card =>
  ({ id, name, limit_amount: 0, statement_day: 1, due_day: 10 });

const veri = (over: Partial<HarcamaVeri> = {}): HarcamaVeri => ({
  transactions: [], card_txs: [], categories: [], cards: [kart(1, "Akbank Kart")], ...over,
});
const AY = { baslangic: "2026-03-01", bitis: "2026-03-31" };

describe("harcamaOzeti", () => {
  it("gider ve geliri ayrı toplar, net = gelir − gider", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(1, "2026-03-05", "Market", -400), tx(2, "2026-03-10", "Maaş", 30000)],
    }), AY);
    expect(o.gider).toBe(400);
    expect(o.gelir).toBe(30000);
    expect(o.net).toBe(29600);
    expect(o.adet).toBe(2);
  });

  it("aralık dışındaki kayıtlar sayılmaz (iki uç DAHİL)", () => {
    const o = harcamaOzeti(veri({
      transactions: [
        tx(1, "2026-02-28", "Önce", -100),
        tx(2, "2026-03-01", "İlk gün", -10),
        tx(3, "2026-03-31", "Son gün", -20),
        tx(4, "2026-04-01", "Sonra", -100),
      ],
    }), AY);
    expect(o.gider).toBe(30);
    expect(o.adet).toBe(2);
  });

  /* ————— ÇİFTE SAYMA: bu modülün var olma sebebi ————— */
  it("tüketim temelinde ekstre ödemesi sayılmaz — kart harcaması + onun ödemesi aynı parayı iki kez saymaz", () => {
    const v = veri({
      card_txs: [ktx(1, "2026-03-05", "Market", 1000)],
      // ekstre ödemesi de bir transactions satırıdır (payStatementTx) — id'si dışarıdan gelir
      transactions: [tx(9, "2026-03-20", "Akbank Kart ekstresi", -1000)],
      ekstreTxIds: [9],
    });
    const t = harcamaOzeti(v, AY);
    expect(t.gider).toBe(1000);                       // 2000 DEĞİL
    expect(t.kapsam.haric_ekstre_odemesi).toBe(1000); // elendiği sessizce geçilmez
    expect(t.adet).toBe(1);
    expect(t.uyari.join(" ")).toContain("ekstre ödemesi");

    // nakit temeli aynı veriye başka bir soruyu cevaplar: hesaptan ne çıktı?
    const n = harcamaOzeti(v, { ...AY, temel: "nakit" });
    expect(n.gider).toBe(1000);                        // yalnız ödeme
    expect(n.kapsam.kart_harcamasi).toBe(false);
    expect(n.kapsam.haric_ekstre_odemesi).toBe(0);     // nakit temelinde elenen yok
  });

  it("ekstre ödemesi olarak işaretlenmemiş bir işlem normal gider sayılır (ad'a göre tahmin edilmez)", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(9, "2026-03-20", "Akbank Kart ekstresi", -1000)], // ekstreTxIds VERİLMEDİ
    }), AY);
    expect(o.gider).toBe(1000);
    expect(o.kapsam.haric_ekstre_odemesi).toBe(0);
  });

  it("taksitli kart harcaması harcandığı ay TAM tutarıyla sayılır (ekstre payı değil)", () => {
    const o = harcamaOzeti(veri({ card_txs: [ktx(1, "2026-03-05", "Buzdolabı", 12000, 1, 12)] }), AY);
    expect(o.gider).toBe(12000);
  });

  it("nakit temelinde kart harcaması hiç sayılmaz", () => {
    const o = harcamaOzeti(veri({ card_txs: [ktx(1, "2026-03-05", "Market", 500)] }), { ...AY, temel: "nakit" });
    expect(o.gider).toBe(0);
    expect(o.adet).toBe(0);
  });

  /* ————— gruplama ————— */
  it("aya göre gruplar ve kronolojik sıralar", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(1, "2026-03-05", "A", -100), tx(2, "2026-01-05", "B", -300), tx(3, "2026-02-05", "C", -200)],
    }), { baslangic: "2026-01-01", bitis: "2026-03-31", grup: "ay" });
    expect(o.kalemler.map((k) => k.ad)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(o.kalemler.map((k) => k.gider)).toEqual([300, 200, 100]);
  });

  it("kategoriye göre gruplar, gidere göre azalan sıralar; kategorisi olmayan işlem kendi kovasında", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market"), kat(2, "Ulaşım")],
      transactions: [tx(1, "2026-03-05", "A", -100, 2), tx(2, "2026-03-06", "B", -500, 1), tx(3, "2026-03-07", "C", -50)],
    }), { ...AY, grup: "kategori" });
    expect(o.kalemler.map((k) => [k.ad, k.gider])).toEqual([["Market", 500], ["Ulaşım", 100], ["(kategorisiz)", 50]]);
  });

  /* ————— kart harcamasının kategorisi (Faz 39) ————— */
  it("kategorisi girilmiş kart harcaması hesap işlemiyle AYNI kovaya girer", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market")],
      transactions: [tx(1, "2026-03-05", "Pazar", -200, 1)],
      card_txs: [ktx(1, "2026-03-06", "Migros", 800, 1, 1, 1)],
    }), { ...AY, grup: "kategori" });
    // soru "para hangi işe gitti"dir, hangi araçla ödendiği değil → tek kova
    expect(o.kalemler.map((k) => [k.ad, k.gider])).toEqual([["Market", 1000]]);
    expect(o.kapsam.kategorisiz_kart_gideri).toBe(0);
    // kova doluyken uyarı çıkmaz: kısıt yapısal değil, veri girişi kısıtıydı ve giriş yapılmış
    expect(o.uyari.join(" ")).not.toContain("kategorisi girilmemiş");
  });

  it("kategorisi GİRİLMEMİŞ kart harcaması ayrı kovada durur ve uyarı çıkar", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market")],
      transactions: [tx(1, "2026-03-05", "Pazar", -200, 1)],
      card_txs: [ktx(1, "2026-03-06", "Migros", 800)],
    }), { ...AY, grup: "kategori" });
    expect(o.kalemler.find((k) => k.ad === "Kart harcaması (kategorisiz)")!.gider).toBe(800);
    expect(o.kapsam.kategorisiz_kart_gideri).toBe(800);
    expect(o.uyari.join(" ")).toContain("kategorisi girilmemiş");
    // kategori kırılımı kartın 800'ünü bir işe bağlamaz ama TOPLAM onu içerir — ikisi çelişmemeli
    expect(o.gider).toBe(1000);
  });

  it("kısmi giriş: yalnız kategorisi olmayan kısım kart kovasında sayılır", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market"), kat(2, "Ulaşım")],
      card_txs: [
        ktx(1, "2026-03-05", "Migros", 800, 1, 1, 1),
        ktx(2, "2026-03-06", "Taksi", 150, 1, 1, 2),
        ktx(3, "2026-03-07", "Bilinmeyen", 300),
      ],
    }), { ...AY, grup: "kategori" });
    expect(o.kalemler.map((k) => [k.ad, k.gider])).toEqual([
      ["Market", 800], ["Kart harcaması (kategorisiz)", 300], ["Ulaşım", 150],
    ]);
    expect(o.kapsam.kategorisiz_kart_gideri).toBe(300);
  });

  it("uyarıdaki tutar Türkçe biçimlidir (metin insana gösterilir, aynen aktarılır)", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(1, "2026-03-05", "Akbank ekstresi", -12480)],
      card_txs: [ktx(1, "2026-03-06", "Migros", 18400)],
      ekstreTxIds: [1],
    }), { ...AY, grup: "kategori" });
    expect(o.uyari.join(" ")).toContain("12.480,00 TL");   // ham "12480 TL" değil
    expect(o.uyari.join(" ")).toContain("18.400,00 TL");
    expect(o.kapsam.haric_ekstre_odemesi).toBe(12480);     // sayısal alan HAM kalır (makine tarafı)
  });

  it("silinmiş/tanınmayan kategori id'si kategorisiz sayılır, ad uydurulmaz", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market")],
      card_txs: [ktx(1, "2026-03-06", "Migros", 800, 1, 1, 99)],
    }), { ...AY, grup: "kategori" });
    expect(o.kalemler.map((k) => k.ad)).toEqual(["Kart harcaması (kategorisiz)"]);
    expect(o.kapsam.kategorisiz_kart_gideri).toBe(800);
  });

  it("AYRIŞMA KAPANI: kategori kalemlerinin toplamı = toplam gider", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Market")],
      transactions: [tx(1, "2026-03-05", "Pazar", -200, 1), tx(2, "2026-03-06", "Şey", -50)],
      card_txs: [ktx(1, "2026-03-07", "Migros", 800, 1, 1, 1), ktx(2, "2026-03-08", "?", 300)],
    }), { ...AY, grup: "kategori" });
    expect(o.kalemler.reduce((s, k) => s + k.gider, 0)).toBe(o.gider);
  });

  it("karta göre gruplar; kart dışı işlemler ayrı kovada", () => {
    const o = harcamaOzeti(veri({
      cards: [kart(1, "Akbank"), kart(2, "Garanti")],
      card_txs: [ktx(1, "2026-03-05", "A", 100, 1), ktx(2, "2026-03-06", "B", 700, 2)],
      transactions: [tx(1, "2026-03-07", "Kira", -5000)],
    }), { ...AY, grup: "kart" });
    expect(o.kalemler.map((k) => [k.ad, k.gider])).toEqual([
      ["Kart dışı (hesap/nakit)", 5000], ["Garanti", 700], ["Akbank", 100],
    ]);
  });

  it("grup 'yok' ise kalem üretilmez (yalnız toplam istenmiştir)", () => {
    const o = harcamaOzeti(veri({ transactions: [tx(1, "2026-03-05", "A", -100)] }), AY);
    expect(o.kalemler).toEqual([]);
  });

  /* ————— metin süzgeci ————— */
  it("kart harcaması KATEGORİ adıyla da bulunur (gelir-giderde zaten öyleydi)", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Ulaşım")],
      card_txs: [ktx(1, "2026-03-05", "Taksi", 150, 1, 1, 1), ktx(2, "2026-03-06", "Migros", 800)],
    }), { ...AY, metin: "ulasim" });
    expect(o.gider).toBe(150);
    expect(o.adet).toBe(1);
  });

  it("metin süzgeci Türkçe'ye toleranslı ve İKİ kaynakta da çalışır", () => {
    const v = veri({
      transactions: [tx(1, "2026-03-05", "MIGROS alışveriş", -100), tx(2, "2026-03-06", "Kira", -5000)],
      card_txs: [ktx(1, "2026-03-07", "Migros Sanal", 250)],
    });
    // büyük I küçülünce ı olur — katlama olmasa "migros" araması MIGROS'u bulamazdı
    const o = harcamaOzeti(v, { ...AY, metin: "migros" });
    expect(o.gider).toBe(350);
    expect(o.adet).toBe(2);
  });

  it("metin kategori ve kart adında da aranır", () => {
    const o = harcamaOzeti(veri({
      categories: [kat(1, "Şarj")],
      transactions: [tx(1, "2026-03-05", "Zes", -120, 1)],
    }), { ...AY, metin: "sarj" }); // Türkçe karakter yazmadan
    expect(o.gider).toBe(120);
  });

  it("metin süzgeci ekstre elemesini bozmaz (eleme süzgeçten ÖNCE gelir)", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(9, "2026-03-20", "Akbank ekstresi", -1000)],
      ekstreTxIds: [9],
    }), { ...AY, metin: "ekstre" });
    expect(o.gider).toBe(0);
    expect(o.kapsam.haric_ekstre_odemesi).toBe(1000);
  });

  /* ————— kenar durumlar ————— */
  it("ters aralık boş sonuç verir ve bunu söyler", () => {
    const o = harcamaOzeti(veri({ transactions: [tx(1, "2026-03-05", "A", -100)] }), { baslangic: "2026-03-31", bitis: "2026-03-01" });
    expect(o.gider).toBe(0);
    expect(o.uyari.join(" ")).toContain("aralık boş");
  });

  it("kuruş artıkları iki haneye yuvarlanır", () => {
    const o = harcamaOzeti(veri({
      transactions: [tx(1, "2026-03-05", "A", -0.1), tx(2, "2026-03-06", "B", -0.2)],
    }), AY);
    expect(o.gider).toBe(0.3); // 0.30000000000000004 değil
  });
});
