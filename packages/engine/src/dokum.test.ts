import { describe, expect, it } from "vitest";
import { dokumKarsilastir, hesapDefteri, kartDefteri, type DefterKaydi } from "./dokum.js";
import type { AllData } from "./types.js";
import type { ParsedRow } from "./statement.js";

const r = (date: string, amount: number, name = "X"): ParsedRow => ({ date, name, amount });
const k = (kimlik: string, date: string, amount: number, name = "Y", taksit?: number): DefterKaydi => ({ kimlik, date, amount, name, taksit });
const durumlar = (s: ReturnType<typeof dokumKarsilastir>) => s.satirlar.map((x) => x.durum);

describe("dokumKarsilastir — eşleştirme", () => {
  it("aynı tutar ±3 gün içinde eşleşir, ada bakılmaz", () => {
    const s = dokumKarsilastir([r("2026-09-01", -13000, "MOBIL-FAST KIRA ODEMESI")], [k("e1", "2026-09-03", -13000, "Kira")]);
    expect(durumlar(s)).toEqual(["eslesti"]);
    expect(s.satirlar[0].kayit?.kimlik).toBe("e1");
    expect(s.fazla).toEqual([]);
  });
  it("gün farkı toleransı aşılırsa eşleşmez", () => {
    const s = dokumKarsilastir([r("2026-09-01", -13000)], [k("e1", "2026-09-05", -13000)]);
    expect(durumlar(s)).toEqual(["eksik"]);
  });
  it("eşleşme birebirdir: aynı gün aynı tutarda iki satır, defterde bir kayıt", () => {
    const s = dokumKarsilastir([r("2026-09-01", -500), r("2026-09-01", -500)], [k("e1", "2026-09-01", -500)]);
    expect(durumlar(s).sort()).toEqual(["eksik", "eslesti"]);
  });
  it("birden çok aday varsa en yakın gün kazanır", () => {
    const s = dokumKarsilastir(
      [r("2026-09-01", -500), r("2026-09-04", -500)],
      [k("uzak", "2026-09-02", -500), k("yakin", "2026-09-04", -500)],
    );
    expect(s.satirlar.map((x) => x.kayit?.kimlik)).toEqual(["uzak", "yakin"]);
  });
  it("işaret farklıysa eşleşmez (gelir ≠ gider)", () => {
    expect(durumlar(dokumKarsilastir([r("2026-09-01", 500)], [k("e1", "2026-09-01", -500)]))).toEqual(["eksik"]);
  });
});

describe("dokumKarsilastir — gruplar", () => {
  it("açılış gününde ya da öncesindeki eşleşmeyen satır açılışın içindedir", () => {
    const s = dokumKarsilastir(
      [r("2026-08-30", -100), r("2026-09-01", -200), r("2026-09-02", -300), r("2026-08-29", -50)],
      [k("e1", "2026-08-29", -50)],
      { acilis: "2026-09-01" },
    );
    expect(durumlar(s)).toEqual(["acilis", "acilis", "eksik", "eslesti"]);
  });
  it("fazla: dökümün aralığında olup dökümde karşılığı olmayan defter kaydı; aralık dışı sayılmaz", () => {
    const s = dokumKarsilastir(
      [r("2026-09-01", -100), r("2026-09-20", -200)],
      [k("ic", "2026-09-10", -999, "Market"), k("once", "2026-08-01", -5), k("sonra", "2026-10-01", -5)],
    );
    expect(s.fazla.map((x) => x.kimlik)).toEqual(["ic"]);
    expect(s.aralik).toEqual({ bas: "2026-09-01", son: "2026-09-20" });
  });
  it("farklı: adı ve günü tutan ama tutarı tutmayan çift yan yana gelir, fazla/eksik sayılmaz", () => {
    const s = dokumKarsilastir([r("2026-09-10", -1250, "MIGROS ATASEHIR")], [k("e1", "2026-09-09", -1200, "Migros")]);
    expect(durumlar(s)).toEqual(["farkli"]);
    expect(s.satirlar[0].kayit?.kimlik).toBe("e1");
    expect(s.fazla).toEqual([]);
  });
  it("ad benzemiyorsa farklı değil, biri eksik biri fazladır", () => {
    const s = dokumKarsilastir([r("2026-09-10", -1250, "OPET")], [k("e1", "2026-09-10", -1200, "Migros")]);
    expect(durumlar(s)).toEqual(["eksik"]);
    expect(s.fazla.map((x) => x.kimlik)).toEqual(["e1"]);
  });
});

describe("dokumKarsilastir — kart ekstresi", () => {
  it("karta para giren satır (ödeme/iade) karşılaştırılmaz", () => {
    const s = dokumKarsilastir([r("2026-09-03", 7630.53), r("2026-09-05", -240)], [k("c1", "2026-09-05", -240)], { kart: true });
    expect(durumlar(s)).toEqual(["odeme", "eslesti"]);
  });
  it("taksitli harcama: satır aylık taksittir, kayıt toplam tutardır (yuvarlama payıyla)", () => {
    const s = dokumKarsilastir([r("2026-05-17", -2606.95)], [k("c1", "2026-05-17", -15641.73, "HEPSIPAY", 6)], { kart: true });
    expect(durumlar(s)).toEqual(["eslesti"]);
  });
  it("aralık son 35 güne daralır: eski tarihli taksit satırı eski harcamaları fazla göstermez", () => {
    const s = dokumKarsilastir(
      [r("2025-09-06", -5466.58, "MONSTER 12/12"), r("2026-08-20", -300), r("2026-09-01", -200)],
      [k("eski", "2026-01-10", -80, "Kahve"), k("yeni", "2026-08-25", -90, "Kahve")],
      { kart: true },
    );
    expect(s.aralik).toEqual({ bas: "2026-07-28", son: "2026-09-01" });
    expect(s.fazla.map((x) => x.kimlik)).toEqual(["yeni"]);
  });
});

describe("defter kaynakları", () => {
  const data = {
    account_entries: [
      { id: 1, account_id: 1, date: "2026-09-01", amount: 5000, kind: "acilis", source_table: null, source_id: null, note: "Açılış", created_at: "" },
      { id: 2, account_id: 1, date: "2026-09-05", amount: -427, kind: "islem", source_table: "transactions", source_id: 9, note: "Turkcell", created_at: "" },
      { id: 3, account_id: 1, date: "2026-09-06", amount: 12, kind: "duzeltme", source_table: null, source_id: null, note: "Mutabakat", created_at: "" },
      { id: 4, account_id: 1, date: "2026-09-07", amount: -5000, kind: "virman", source_table: "transfers", source_id: 2, note: "Midas", created_at: "" },
      { id: 5, account_id: 2, date: "2026-09-07", amount: 5000, kind: "virman", source_table: "transfers", source_id: 2, note: "Midas", created_at: "" },
    ],
    card_txs: [
      { id: 7, card_id: 3, date: "2026-09-02", name: "Netflix", amount: 229.99, installments: 1 },
      { id: 8, card_id: 4, date: "2026-09-02", name: "Başka kart", amount: 10, installments: 1 },
    ],
  } as unknown as AllData;
  it("hesap defteri: yalnız o hesap, bütün hareket türleri — açılış ve mutabakat düzeltmesi hariç (bankada karşılığı yok)", () => {
    const { defter, acilis } = hesapDefteri(data, 1);
    expect(defter.map((d) => [d.kimlik, d.amount, d.name])).toEqual([["e2", -427, "Turkcell"], ["e4", -5000, "Midas"]]);
    expect(acilis).toBe("2026-09-01");
  });
  it("kart defteri: harcama hesap dilinde eksidir, taksit sayısı taşınır", () => {
    expect(kartDefteri(data, 3)).toEqual([{ kimlik: "c7", date: "2026-09-02", amount: -229.99, name: "Netflix", taksit: 1 }]);
  });
});
