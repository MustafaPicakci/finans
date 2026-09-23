import { describe, it, expect } from "vitest";
import { makroOlaylar, makroSonTarih } from "./makro.js";

describe("makroOlaylar", () => {
  it("aralık iki uçtan DAHİL süzer", () => {
    /* 2026-09-10 TCMB PPK, 2026-09-16 FOMC — ikisi de duyurulmuş tarih */
    const tam = makroOlaylar("2026-09-10", "2026-09-16").map((o) => o.date);
    expect(tam).toContain("2026-09-10");
    expect(tam).toContain("2026-09-16");
    expect(makroOlaylar("2026-09-11", "2026-09-15").some((o) => o.date === "2026-09-10")).toBe(false);
  });

  it("Fed yılda 8 karar günü verir (FOMC'un ikinci günü)", () => {
    const fed = makroOlaylar("2026-01-01", "2026-12-31").filter((o) => o.kaynak === "Fed");
    expect(fed).toHaveLength(8);
    expect(fed[0].date).toBe("2026-01-28");
    expect(fed.at(-1)!.date).toBe("2026-12-09");
    // duyurulmuş tarih: tahmin işareti TAŞIMAZ
    expect(fed.every((o) => !o.tahmini)).toBe(true);
  });

  it("TCMB yılda 8 PPK toplantısı verir", () => {
    const ppk = makroOlaylar("2026-01-01", "2026-12-31")
      .filter((o) => o.kaynak === "TCMB" && o.baslik.includes("PPK"));
    expect(ppk).toHaveLength(8);
    expect(ppk[0].date).toBe("2026-01-22");
  });

  /* TÜFE tek tek duyurulmuş bir liste DEĞİL, bir desendir (ayın 3'ü) — bu yüzden kuralla
     üretilir ve KARŞILIĞINDA `tahmini` işaretlenir. İkisi birlikte test edilir: desen
     doğru çalışsın ama kesinmiş gibi görünmesin. */
  describe("TÜFE (kuralla üretilen)", () => {
    const tufe = (from: string, to: string) =>
      makroOlaylar(from, to).filter((o) => o.kaynak === "TÜİK");

    it("her ay bir kez, ayın 3'ünde", () => {
      const t = tufe("2026-11-01", "2026-12-31");
      expect(t.map((o) => o.date)).toEqual(["2026-11-03", "2026-12-03"]);
    });

    it("3'ü hafta sonuna denk gelirse sonraki iş gününe kayar", () => {
      // 3 Ekim 2026 Cumartesi → 5 Ekim Pazartesi
      expect(tufe("2026-10-01", "2026-10-31")[0].date).toBe("2026-10-05");
      // 3 Ocak 2027 Pazar → 4 Ocak Pazartesi
      expect(tufe("2027-01-01", "2027-01-31")[0].date).toBe("2027-01-04");
    });

    it("her zaman TAHMİNİ işaretlidir (resmî tatil kaymasını bilmiyoruz)", () => {
      expect(tufe("2026-10-01", "2027-06-30").every((o) => o.tahmini === true)).toBe(true);
    });

    it("desen tükenmez: takvimin bittiği yılın ötesinde de üretir", () => {
      expect(tufe("2030-05-01", "2030-05-31")).toHaveLength(1);
    });
  });

  it("makroSonTarih yalnız DUYURULMUŞ tarihleri sayar", () => {
    const son = makroSonTarih();
    // TÜFE kuralla sonsuza kadar üretilebiliyor; onu saymak "takvim dolu" yanılgısı olurdu
    const tufeIleri = makroOlaylar(son, "2035-01-01").filter((o) => o.kaynak === "TÜİK");
    expect(tufeIleri.length).toBeGreaterThan(0);
    expect(makroOlaylar(son, "2035-01-01").filter((o) => o.kaynak !== "TÜİK")).toHaveLength(1);
  });
});
