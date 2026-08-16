import { describe, it, expect } from "vitest";
import { tumKayitlar, kayitAra, kayitSuz, kayitlariAyaGoreGrupla } from "./kayitlar.js";
import type { AllData } from "./types.js";

/** Yalnız bu modülün okuduğu alanlar doldurulur; gerisi boş (AllData geniş, testi o boğmasın). */
const veri = (over: Partial<AllData> = {}): AllData => ({
  accounts: [
    { id: 1, name: "Garanti Vadesiz", balance: 0 },
    { id: 2, name: "Nakit Cüzdan", balance: 0 },
  ],
  cards: [{ id: 1, name: "Akbank Axess", limit_amount: 0, statement_day: 25, due_day: 10 }],
  categories: [{ id: 1, name: "Market", kind: "expense", color: null }],
  transactions: [], card_txs: [], transfers: [], trades: [],
  recurring: [], recurring_amounts: [], recurring_realized: [], loans: [], oneoffs: [],
  portfolios: [], deposits: [], prices: [], price_history: [], statement_payments: [],
  account_entries: [], settings: {},
  ...over,
} as unknown as AllData);

describe("tumKayitlar", () => {
  it("dört kaynağı tek listede birleştirir ve en yeniyi öne alır", () => {
    const k = tumKayitlar(veri({
      transactions: [{ id: 1, date: "2026-01-10", name: "Maaş", amount: 1000, category_id: null, account_id: 1 }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-03-01", name: "Market", amount: 250, installments: 1 }],
      transfers: [{ id: 1, date: "2026-02-01", from_account_id: 1, to_account_id: 2, amount: 500, note: "ATM" }],
      trades: [{ id: 1, date: "2026-04-01", asset_type: "BIST", symbol: "thyao", side: "ALIŞ", qty: 10, price: 100, fee: 5, currency: "TRY" }],
    }));
    expect(k.map((x) => x.tur)).toEqual(["portfoy", "kart", "virman", "gelir-gider"]);
    expect(k[0].date).toBe("2026-04-01");
  });

  it("yön: gelir giriş, gider çıkış, virman nötr", () => {
    const k = tumKayitlar(veri({
      transactions: [
        { id: 1, date: "2026-01-01", name: "Maaş", amount: 1000, category_id: null, account_id: null },
        { id: 2, date: "2026-01-01", name: "Kira", amount: -800, category_id: null, account_id: null },
      ],
      transfers: [{ id: 1, date: "2026-01-01", from_account_id: 1, to_account_id: 2, amount: 500, note: null }],
    }));
    const y = Object.fromEntries(k.map((x) => [x.ad, x.yon]));
    expect(y["Maaş"]).toBe("giris");
    expect(y["Kira"]).toBe("cikis");
    expect(y["Garanti Vadesiz → Nakit Cüzdan"]).toBe("notr");
  });

  it("tutar her zaman mutlak; işaret yalnız yönde taşınır", () => {
    const [k] = tumKayitlar(veri({
      transactions: [{ id: 1, date: "2026-01-01", name: "Kira", amount: -800, category_id: null, account_id: null }],
    }));
    expect(k.tutar).toBe(800);
    expect(k.yon).toBe("cikis");
  });

  it("portföy: SATIŞ/TEMETTÜ giriş, ALIŞ çıkış, BEDELSİZ nötr ve tutarsız", () => {
    const k = tumKayitlar(veri({
      trades: [
        { id: 1, date: "2026-01-01", asset_type: "BIST", symbol: "X", side: "ALIŞ", qty: 2, price: 50, fee: 0, currency: "TRY" },
        { id: 2, date: "2026-01-02", asset_type: "BIST", symbol: "X", side: "SATIŞ", qty: 1, price: 60, fee: 0, currency: "TRY" },
        { id: 3, date: "2026-01-03", asset_type: "BIST", symbol: "X", side: "TEMETTÜ", qty: 1, price: 5, fee: 0, currency: "TRY" },
        { id: 4, date: "2026-01-04", asset_type: "BIST", symbol: "X", side: "BEDELSİZ", qty: 3, price: 0, fee: 0, currency: "TRY" },
      ],
    }));
    const m = Object.fromEntries(k.map((x) => [x.etiket, x]));
    expect(m["ALIŞ"].yon).toBe("cikis");
    expect(m["ALIŞ"].tutar).toBe(100);
    expect(m["SATIŞ"].yon).toBe("giris");
    expect(m["TEMETTÜ"].yon).toBe("giris");
    expect(m["BEDELSİZ"].yon).toBe("notr");
    expect(m["BEDELSİZ"].tutar).toBe(0); // bedelsizde para hareketi yoktur
  });

  it("işlemin para birimini taşır (USD portföy işlemi TRY'ye çevrilmez)", () => {
    const [k] = tumKayitlar(veri({
      trades: [{ id: 1, date: "2026-01-01", asset_type: "ETF", symbol: "VOO", side: "ALIŞ", qty: 2, price: 500, fee: 0, currency: "USD" }],
    }));
    expect(k.currency).toBe("USD");
    expect(k.tutar).toBe(1000);
  });

  it("anahtarlar tablolar arası çakışmaz (aynı id, farklı tür)", () => {
    const k = tumKayitlar(veri({
      transactions: [{ id: 1, date: "2026-01-01", name: "A", amount: 1, category_id: null, account_id: null }],
      card_txs: [{ id: 1, card_id: 1, date: "2026-01-01", name: "B", amount: 1, installments: 1 }],
    }));
    expect(new Set(k.map((x) => x.key)).size).toBe(2);
  });

  it("detaya kategori/hesap/kart adını koyar — arama bunları da bulsun", () => {
    const [k] = tumKayitlar(veri({
      transactions: [{ id: 1, date: "2026-01-01", name: "Alışveriş", amount: -100, category_id: 1, account_id: 1 }],
    }));
    expect(k.detay).toBe("Market · Garanti Vadesiz");
  });
});

describe("kayitAra", () => {
  const liste = tumKayitlar(veri({
    transactions: [
      { id: 1, date: "2026-01-01", name: "Migros market", amount: -100, category_id: 1, account_id: 1 },
      { id: 2, date: "2026-01-02", name: "İnternet faturası", amount: -300, category_id: null, account_id: 2 },
    ],
  }));

  it("boş sorgu listeyi olduğu gibi döner", () => {
    expect(kayitAra(liste, "   ")).toHaveLength(2);
  });

  it("ad üzerinden bulur, büyük/küçük harf duyarsız", () => {
    expect(kayitAra(liste, "MIGROS").map((k) => k.id)).toEqual([1]);
  });

  it("Türkçe büyük İ doğru küçültülür", () => {
    // "İnternet" → locale'siz toLowerCase'de "i̇nternet" olur ve "internet" araması kaçardı
    expect(kayitAra(liste, "internet").map((k) => k.id)).toEqual([2]);
  });

  it("büyük I → ı tuzağı: 'MIGROS' yine 'Migros'u bulur", () => {
    // Türkçe locale'de "MIGROS".toLocaleLowerCase("tr") === "mıgros" — katlama olmadan eşleşmez
    expect(kayitAra(liste, "MIGROS").map((k) => k.id)).toEqual([1]);
  });

  it("Türkçe karakter yazmadan da bulur (sarj → Şarj)", () => {
    const tr = tumKayitlar(veri({
      transactions: [{ id: 9, date: "2026-01-01", name: "Şarj istasyonu ödemesi", amount: -50, category_id: null, account_id: null }],
    }));
    expect(kayitAra(tr, "sarj").map((k) => k.id)).toEqual([9]);
    expect(kayitAra(tr, "odeme").map((k) => k.id)).toEqual([9]);
  });

  it("detay alanında da arar (kategori/hesap adı)", () => {
    expect(kayitAra(liste, "garanti").map((k) => k.id)).toEqual([1]);
  });

  it("çok kelimeli sorgu VE ile bağlanır", () => {
    expect(kayitAra(liste, "market garanti").map((k) => k.id)).toEqual([1]);
    expect(kayitAra(liste, "market olmayan")).toHaveLength(0);
  });
});

describe("kayitSuz", () => {
  const liste = tumKayitlar(veri({
    transactions: [{ id: 1, date: "2026-01-10", name: "Eski", amount: -1, category_id: null, account_id: null }],
    card_txs: [{ id: 2, card_id: 1, date: "2026-06-10", name: "Yeni", amount: 1, installments: 1 }],
  }));

  it("türe göre süzer", () => {
    expect(kayitSuz(liste, { tur: "kart" }).map((k) => k.ad)).toEqual(["Yeni"]);
    expect(kayitSuz(liste, { tur: "hepsi" })).toHaveLength(2);
  });

  it("tarih alt sınırı uygular (dahil)", () => {
    expect(kayitSuz(liste, { from: "2026-06-10" }).map((k) => k.ad)).toEqual(["Yeni"]);
  });

  it("süzgeçleri birlikte uygular", () => {
    expect(kayitSuz(liste, { tur: "kart", sorgu: "eski" })).toHaveLength(0);
  });
});

describe("kayitlariAyaGoreGrupla", () => {
  it("aya böler ve giriş sırasını (en yeni üstte) korur", () => {
    const liste = tumKayitlar(veri({
      transactions: [
        { id: 1, date: "2026-01-05", name: "A", amount: 1, category_id: null, account_id: null },
        { id: 2, date: "2026-03-05", name: "B", amount: 1, category_id: null, account_id: null },
        { id: 3, date: "2026-03-20", name: "C", amount: 1, category_id: null, account_id: null },
      ],
    }));
    const g = kayitlariAyaGoreGrupla(liste);
    expect(g.map((x) => x.ym)).toEqual(["2026-03", "2026-01"]);
    expect(g[0].kayitlar.map((k) => k.ad)).toEqual(["C", "B"]);
  });
});
