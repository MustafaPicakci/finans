import { describe, it, expect } from "vitest";
import { pdfSatirlariKur, type PdfParca } from "./pdfSatir.js";
import { parseStatement } from "./statement.js";

/** 6 birim genişlikli harflerle, verilen x'ten başlayan parça */
const p = (s: string, x: number, y: number, h = 10): PdfParca => ({ s, x, y, w: s.length * 6, h });

describe("pdfSatirlariKur", () => {
  it("aynı yükseklikteki parçaları tek satıra, uzak sütunları sekmeyle dizer", () => {
    const satirlar = pdfSatirlariKur([
      p("450,25", 400, 700), p("12.03.2026", 40, 700), p("MIGROS ATASEHIR", 140, 700),
    ]);
    expect(satirlar).toEqual(["12.03.2026\tMIGROS ATASEHIR\t450,25"]);
  });

  it("satırları yukarıdan aşağıya sıralar (PDF'te y yukarı doğru artar)", () => {
    const satirlar = pdfSatirlariKur([p("alt", 40, 100), p("üst", 40, 700), p("orta", 40, 400)]);
    expect(satirlar).toEqual(["üst", "orta", "alt"]);
  });

  it("bitişik parçaları boşluksuz, kelime aralığını tek boşlukla birleştirir", () => {
    // "MIGR" + "OS" bitişik (aynı kelime bölünmüş); "ATASEHIR" bir harf boşlukla
    const satirlar = pdfSatirlariKur([p("MIGR", 100, 500), p("OS", 124, 500), p("ATASEHIR", 142, 500)]);
    expect(satirlar).toEqual(["MIGROS ATASEHIR"]);
  });

  it("taban çizgisi biraz oynayan parçalar yine aynı satırdır, yarım satır aşağısı değildir", () => {
    const satirlar = pdfSatirlariKur([p("12.03.2026", 40, 500), p("450,25", 400, 502.5), p("dipnot", 40, 488)]);
    expect(satirlar).toEqual(["12.03.2026\t450,25", "dipnot"]);
  });

  it("boş ve yalnız boşluk parçaları atar", () => {
    expect(pdfSatirlariKur([p(" ", 40, 500), p("", 60, 500)])).toEqual([]);
    expect(pdfSatirlariKur([])).toEqual([]);
  });

  it("çıktı yapıştırma ayrıştırıcısına doğrudan gider", () => {
    const satirlar = pdfSatirlariKur([
      p("Tarih", 40, 720), p("Açıklama", 140, 720), p("Tutar", 400, 720),
      p("12.03.2026", 40, 700), p("MIGROS ATASEHIR", 140, 700), p("-450,25", 400, 700),
      p("13.03.2026", 40, 685), p("BENZIN", 140, 685), p("-1.200,00", 400, 685),
    ]);
    const { rows } = parseStatement(satirlar.join("\n"), "gider");
    expect(rows).toEqual([
      { date: "2026-03-12", name: "MIGROS ATASEHIR", amount: -450.25 },
      { date: "2026-03-13", name: "BENZIN", amount: -1200 },
    ]);
  });
});
