import { describe, it, expect } from "vitest";
import { zarfla, zarfAc, veriAc } from "./zarf";
import { ZARF } from "@finans/crypto/map";
import type { AllData } from "@finans/engine";

/* Zarf codec'inin sözleşmesi. Aşama 6'da `p1` (düz metin) yerine `v1` (şifreli) gelecek —
   bu testlerin koruduğu şey biçim değil, AKIŞ: hassas alan gövdeden YALNIZ zarfın içinde
   çıkar, kısmi güncellemede zarf eksiksiz yeniden kurulur, okumada alanlar yerine döner. */

const bos = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [], ...over,
});
const zarfIci = (enc: unknown) => zarfAc({ enc }) as Record<string, unknown>;

/* SIZINTI TESTİ: haritadaki her tablo için, bütün alanlarıyla bir gövde gönderilir ve
   hassas alanların HİÇBİRİ gövdenin üst seviyesinde kalmamalı. Haritaya yeni bir tablo
   eklendiğinde bu test onu kendiliğinden kapsar. */
describe("sızıntı: hassas alan gövdede yalnız zarfın içinde gider", () => {
  for (const [tablo, alanlar] of Object.entries(ZARF)) {
    it(`${tablo} (POST)`, () => {
      const govde = Object.fromEntries(alanlar.map((a) => [a, `GIZLI_${a}`]));
      const out = zarfla("POST", `/${tablo}`, { ...govde, duz_alan: 1 }, bos());
      for (const a of alanlar) expect(out).not.toHaveProperty(a);
      expect(out.duz_alan).toBe(1);
      expect(zarfIci(out.enc)).toEqual(govde);
    });
  }
});

describe("kısmi güncelleme", () => {
  const d = bos({ loans: [{ id: 5, name: "Konut", amount: 12500, first_date: "2026-10-15", total: 120 }] as any });
  it("yalnız tutar değişince zarf mevcut satırdan TAMAMLANIR (ad ve taksit kaybolmaz)", () => {
    const out = zarfla("PUT", "/loans/5", { amount: 13000 }, d);
    expect(zarfIci(out.enc)).toEqual({ name: "Konut", amount: 13000, total: 120 });
  });
  it("yalnız düz alan değişince zarfa DOKUNULMAZ (enc gönderilmez)", () => {
    expect(zarfla("PUT", "/loans/5", { first_date: "2026-11-01" }, d)).toEqual({ first_date: "2026-11-01" });
  });
  it("satır bulunamazsa zarf uydurulmaz — açık hata", () => {
    expect(() => zarfla("PUT", "/loans/99", { amount: 1 }, d)).toThrow(/bulunamadı/);
  });
  it("POST'ta gönderilmeyen hassas alan null olarak zarfa girer (okuma tarafı tutarlı olsun)", () => {
    expect(zarfIci(zarfla("POST", "/portfolios", { name: "Emeklilik" }, bos()).enc)).toEqual({ name: "Emeklilik", note: null });
  });
});

describe("yönlendirme", () => {
  it("tanımadığı uca dokunmaz", () => {
    expect(zarfla("POST", "/transactions", { name: "x", amount: -1 }, bos())).toEqual({ name: "x", amount: -1 });
  });
  it("DELETE ve GET gövdesine dokunmaz", () => {
    expect(zarfla("DELETE", "/loans/5", { x: 1 }, bos())).toEqual({ x: 1 });
  });
});

describe("okuma", () => {
  it("zarfı açar, alanları satıra yerleştirir, enc'i kaldırır", () => {
    expect(zarfAc({ id: 1, kind: "expense", enc: 'p1:{"name":"Market"}' })).toEqual({ id: 1, kind: "expense", name: "Market" });
  });
  it("zarfsız satır (göç öncesi sunucu, eski PWA önbelleği) olduğu gibi döner", () => {
    expect(zarfAc({ id: 1, name: "Market" })).toEqual({ id: 1, name: "Market" });
  });
  it("tanınmayan biçim SESSİZCE yutulmaz", () => {
    expect(() => zarfAc({ enc: "x9:abc" })).toThrow(/tanınmayan/);
  });
  it("sunucunun artık yapamadığı AD SIRALAMASINI kurar (Türkçe)", () => {
    const d = veriAc(bos({ categories: [
      { id: 1, kind: "expense", enc: 'p1:{"name":"Ulaşım"}' }, { id: 2, kind: "expense", enc: 'p1:{"name":"Çay"}' },
      { id: 3, kind: "expense", enc: 'p1:{"name":"Aidat"}' },
    ] as any }));
    expect(d.categories.map((c) => c.name)).toEqual(["Aidat", "Çay", "Ulaşım"]);
  });
  it("gidiş-dönüş: zarflanan satır okunduğunda aynı alanları verir", () => {
    const out = zarfla("POST", "/oneoffs", { date: "2026-12-01", name: "Vergi", amount: -8400.25 }, bos());
    expect(zarfAc({ id: 1, ...out })).toEqual({ id: 1, date: "2026-12-01", name: "Vergi", amount: -8400.25 });
  });
});
