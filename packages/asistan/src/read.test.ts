import { describe, it, expect } from "vitest";
import { READ_TOOLS } from "./read.js";
import { buildContext } from "./context.js";
import { enrichSummary } from "./enrich.js";
import type { AllData, AccountEntry } from "@finans/engine";

/* Okuma araçları E2EE aşama 4'e kadar veritabanına bağlıydı ve HİÇ test edilmiyordu.
   Artık `AllData` alan saf fonksiyonlar — asistanın söylediği rakamın ekranla aynı
   olması bu testlere bağlı. */

const bos = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [], ...over,
});
const hareket = (id: number, account_id: number, amount: number): AccountEntry =>
  ({ id, account_id, date: "2026-09-01", amount, kind: "islem", source_table: null, source_id: null, note: "", created_at: "" });
const calistir = (ad: string, data: AllData, args: Record<string, unknown> = {}, bugun = "2026-09-26") =>
  READ_TOOLS.find((t) => t.name === ad)!.run(data, args, bugun) as any;

describe("buildContext", () => {
  it("hesap bakiyesi defterden türer (kolon yok — E2EE aşama 1a)", () => {
    const d = bos({
      accounts: [{ id: 1, name: "Garanti" }, { id: 2, name: "Nakit", kind: "nakit" }],
      account_entries: [hareket(1, 1, 1000), hareket(2, 1, -250.5), hareket(3, 2, 80)],
    });
    const c = buildContext(d, "2026-09-26");
    expect(c.hesaplar).toEqual([
      { id: 1, ad: "Garanti", tur: "banka", bakiye: 749.5 },
      { id: 2, ad: "Nakit", tur: "nakit", bakiye: 80 },
    ]);
  });

  it("tutulan sembolleri işlemlerden, fiyatı birleşik fiyat listesinden alır", () => {
    const d = bos({
      trades: [
        { id: 1, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 10, price: 250, fee: 0, currency: "TRY" },
        { id: 2, date: "2026-02-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 5, price: 260, fee: 0, currency: "TRY" },
      ] as any,
      prices: [{ symbol: "THYAO", asset_type: "BIST", price: 312.456, source: "manual", updated_at: "", currency: "TRY" }] as any,
    });
    expect(buildContext(d, "2026-09-26").portfoydeki_semboller).toEqual([
      { sembol: "THYAO", tur: "BIST", para_birimi: "TRY", guncel_fiyat: 312.46 },
    ]);
  });
});

describe("kayit_ara", () => {
  const islem = (id: number, date: string, name: string) => ({ id, date, name, amount: -10, category_id: null, account_id: null });

  /* Davranış değişikliği bilinçli: SQL ILIKE Türkçe'yi bilmiyordu. Artık Kayıtlar ekranıyla
     aynı `metinEsler` — asistanın bulduğu ile ekranın bulduğu aynı satırlar. */
  it("aramada Türkçe'ye toleranslı: 'MIGROS' 'Migros'u, 'sut' 'Süt'ü bulur", () => {
    const d = bos({ transactions: [islem(1, "2026-09-01", "Migros market"), islem(2, "2026-09-02", "Süt"), islem(3, "2026-09-03", "Kira")] as any });
    expect(calistir("kayit_ara", d, { tur: "islem", metin: "MIGROS" }).kayitlar.map((k: any) => k.id)).toEqual([1]);
    expect(calistir("kayit_ara", d, { tur: "islem", metin: "sut" }).kayitlar.map((k: any) => k.id)).toEqual([2]);
  });

  it("yeniden eskiye sıralar ve tarih aralığına uyar", () => {
    const d = bos({ transactions: [islem(1, "2026-08-01", "a"), islem(2, "2026-09-10", "b"), islem(3, "2026-09-05", "c")] as any });
    const r = calistir("kayit_ara", d, { tur: "islem", baslangic: "2026-09-01" });
    expect(r.kayitlar.map((k: any) => k.id)).toEqual([2, 3]);
  });

  it("kesilen listede TOPLAM sayıyı ve uyarıyı verir (model kafadan toplamasın)", () => {
    const d = bos({ transactions: Array.from({ length: 30 }, (_, i) => islem(i + 1, "2026-09-01", `x${i}`)) as any });
    const r = calistir("kayit_ara", d, { tur: "islem", limit: 5 });
    expect(r.toplam).toBe(30);
    expect(r.gosterilen).toBe(5);
    expect(r.uyari).toMatch(/TOPLAM ÇIKARMA/);
  });

  it("yalnız tanımlı alanları döndürür (modele gereksiz veri sızmaz)", () => {
    const d = bos({ transactions: [{ ...islem(1, "2026-09-01", "a"), gizli_alan: "x" }] as any });
    expect(Object.keys(calistir("kayit_ara", d, { tur: "islem" }).kayitlar[0]).sort())
      .toEqual(["account_id", "amount", "category_id", "date", "id", "name"]);
  });
});

describe("bugun", () => {
  it("gün adını VERİLEN tarihten türetir (sunucu saatinden değil)", () => {
    expect(calistir("bugun", bos(), {}, "2026-09-26")).toEqual({ bugun: "2026-09-26", gun: "Cumartesi" });
  });
});

describe("harcama_ozeti", () => {
  it("ekstre ödemesi statement_payments.tx_id'den tanınıp tüketim temelinde SAYILMAZ", () => {
    const d = bos({
      transactions: [
        { id: 1, date: "2026-09-10", name: "Market", amount: -500, category_id: null, account_id: null },
        { id: 2, date: "2026-09-12", name: "Kart ödemesi", amount: -2000, category_id: null, account_id: null },
      ] as any,
      statement_payments: [{ card_id: 1, due: "2026-09-12", tx_id: 2 }] as any,
    });
    const r = calistir("harcama_ozeti", d, { temel: "tuketim" });
    expect(r.gider).toBe(500);
  });
});

describe("enrichSummary", () => {
  it("mutabakat önizlemesi farkı DEFTERDEN hesaplar", () => {
    const d = bos({ accounts: [{ id: 1, name: "G" }], account_entries: [hareket(1, 1, 1000)] });
    expect(enrichSummary(d, "hesap_mutabakat", { id: 1, balance: 1200 }, "Mutabakat")).toMatch(/1\.000,00 ₺.*\+200,00 ₺/);
  });

  it("zenginleştirici patlarsa özet olduğu gibi kalır (onay akışı bozulmaz)", () => {
    expect(enrichSummary(null as unknown as AllData, "ekstre_ode", { id: 1 }, "Özet")).toBe("Özet");
  });
});
