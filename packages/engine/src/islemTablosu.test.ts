import { describe, expect, it } from "vitest";
import { islemKarsilastir, ozetKarsilastir, parseIslemler } from "./islemTablosu.js";
import type { Trade } from "./types.js";

/* Satırlar uydurma; YAPI gerçek bir aracı kurum ekstresinden (tek belge — kurala o kurumun
   düzeni değil, sütun başlıklarının ortak dili yazıldı). */
const BELGE = [
  "01/08/26 - 31/08/26 HESAP EKSTRESİ",
  "PORTFÖY ÖZETİ (31/08/26)",
  "Sermaye Piyasası Aracı\tAdet\tHisse Başı Ortalama Maliyet\tKar / Zarar*\tToplam Değeri (YP)",
  "KHA - Pardus Portföy İkinc...\t383\t2,89 TRY\t680,29 TRY\t1786,72 TRY",
  "BIMAS - BİM Birleşik Mağazal...\t6\t378,50 TRY\t162,00 TRY\t2433,00 TRY",
  "YATIRIM İŞLEMLERİ (01/08/26 - 31/08/26)",
  "Tarih\tİşlem Türü\tSembol\tİşlem Tipi\tİşlem Durumu\tPara Birimi\tEmir Adedi\tEmir Tutarı\tGerçekleşen Adet\tOrtalama İşlem Fiyatı\tİşlem Ücreti\tİşlem Tutarı",
  "31/07/26 10:25:24\tLimit Emri\tQUICK\tAlış\tGerçekleşti\tTRY\t50\t-\t50\t76,60\t0,00\t3830,00",
  "03/08/26 15:38:40\tPiyasa Emri\tBIMAS\tAlış\tGerçekleşti\tTRY\t6\t-\t6\t378,50\t1,25\t2272,25",
  "05/08/26 10:00:00\tLimit Emri\tTHYAO\tSatış\tİptal Edildi\tTRY\t10\t-\t0\t0,00\t0,00\t0,00",
  "17/08/26 11:09:46\tFon Emri\tTLY\tAlış\tGerçekleşti\tTRY\t1\t-\t1\t8690,33\t0,00\t8690,33",
  "HESAP İŞLEMLERİ (01/08/26 - 31/08/26)",
  "Talep Tarihi\tİşlem Tarihi\tİşlem Tipi\tİşlem Açıklaması\tİşlem Durumu\tTutar (YP)",
  "03/08/26 15:34:47\t03/08/26 15:34:47\tPara Yatırma\tBanka - TR00\tGerçekleşti\t10000,00 TRY",
].join("\n");

describe("parseIslemler", () => {
  const { islemler, ozet } = parseIslemler(BELGE);
  it("işlem tablosunu başlık sözcüklerinden okur: gerçekleşen adet, ortalama fiyat, ücret, yön değerden", () => {
    expect(islemler.map(({ fonIpucu, ...r }) => r)).toEqual([
      { date: "2026-07-31", symbol: "QUICK", side: "ALIŞ", qty: 50, price: 76.6, fee: 0, currency: "TRY" },
      { date: "2026-08-03", symbol: "BIMAS", side: "ALIŞ", qty: 6, price: 378.5, fee: 1.25, currency: "TRY" },
      { date: "2026-08-17", symbol: "TLY", side: "ALIŞ", qty: 1, price: 8690.33, fee: 0, currency: "TRY" },
    ]);
  });
  it("gerçekleşmeyen (iptal) emir işlem değildir; başka tablonun satırları (hesap hareketi) karışmaz", () => {
    expect(islemler.some((r) => r.symbol === "THYAO")).toBe(false);
    expect(islemler).toHaveLength(3);
  });
  it("fon ipucu satırdan gelir (karar değil, tür seçicinin varsayılanı)", () => {
    expect(islemler.map((r) => r.fonIpucu)).toEqual([false, false, true]);
  });
  it("portföy özeti: sembol adı açıklamadan ayrılır, maliyet sütunu fiyat sayılmaz", () => {
    expect(ozet).toEqual([{ symbol: "KHA", qty: 383 }, { symbol: "BIMAS", qty: 6 }]);
  });
  it("başlık yoksa hiçbir şey uydurmaz", () => {
    expect(parseIslemler("03/08/26\tBIMAS\tAlış\t6\t378,50").islemler).toEqual([]);
  });
});

describe("islemKarsilastir / ozetKarsilastir", () => {
  const t = (symbol: string, side: Trade["side"], qty: number, date: string): Trade =>
    ({ id: 0, date, asset_type: "BIST", symbol, side, qty, price: 1, fee: 0, currency: "TRY" });
  it("aynı sembol+yön+adet ±1 gün eşleşir, birebir", () => {
    const { islemler } = parseIslemler(BELGE);
    expect(islemKarsilastir(islemler, [t("BIMAS", "ALIŞ", 6, "2026-08-04"), t("QUICK", "SATIŞ", 50, "2026-07-31")]))
      .toEqual(["eksik", "eslesti", "eksik"]);
  });
  it("fiyat da aynıysa ±5 gün eşleşir (takas günüyle girilmiş işlem); fiyat farklıysa eşleşmez", () => {
    const { islemler } = parseIslemler(BELGE); // QUICK 31/07 50 × 76,60
    const fiyatli = (p: number, d: string) => ({ ...t("QUICK", "ALIŞ", 50, d), price: p });
    expect(islemKarsilastir(islemler, [fiyatli(76.6, "2026-08-03")])[0]).toBe("eslesti");
    expect(islemKarsilastir(islemler, [fiyatli(80, "2026-08-03")])[0]).toBe("eksik");
    expect(islemKarsilastir(islemler, [fiyatli(76.6, "2026-08-10")])[0]).toBe("eksik");
  });
  it("özet: dönem sonu adedi uygulamadakiyle tutmayan semboller döner", () => {
    const { ozet } = parseIslemler(BELGE);
    expect(ozetKarsilastir(ozet, [t("BIMAS", "ALIŞ", 6, "2026-08-03"), t("KHA", "ALIŞ", 400, "2026-01-01"), t("KHA", "SATIŞ", 17, "2026-02-01")])).toEqual([]);
    expect(ozetKarsilastir(ozet, [t("BIMAS", "ALIŞ", 6, "2026-08-03")])).toEqual([{ symbol: "KHA", belge: 383, uygulama: 0 }]);
  });
  it("özet tarihi okunur; o tarihten SONRAKİ işlem sayılmaz", () => {
    const r = parseIslemler(BELGE);
    expect(r.ozetTarih).toBe("2026-08-31");
    const islemler = [t("BIMAS", "ALIŞ", 6, "2026-08-03"), t("KHA", "ALIŞ", 383, "2026-07-01"), t("KHA", "SATIŞ", 383, "2026-09-07")];
    expect(ozetKarsilastir(r.ozet, islemler, r.ozetTarih)).toEqual([]);
    expect(ozetKarsilastir(r.ozet, islemler)).toEqual([{ symbol: "KHA", belge: 383, uygulama: 0 }]); // tarihsiz eski davranış
  });
});
