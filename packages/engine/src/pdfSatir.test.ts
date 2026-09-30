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

/* ————— Faz 45.5: konumlu sütun modeli ————— */
import { pdfSatirlariKurKonumlu } from "./pdfSatir.js";

describe("konumlu ayrıştırma — sayı sütunları konumdan", () => {
  /* Bir kart ekstresinin düzeni: tutarın SAĞINDA iki sayı sütunu daha var (kalan borç/taksit ve
     chip-para). Metin yolunda "tutar = son sayı" bunlardan birini okurdu. Sayılar sağa yaslı. */
  const sag = (s: string, x1: number, y: number) => p(s, x1 - s.length * 6, y);
  const parcalar = [
    p("Kart Limiti", 40, 800), sag("472,950.00 TL", 250, 800), p("Son Ödeme Tarihi :", 330, 800), p("14/09/2026", 450, 800),
    p("Dönem Borcu", 40, 785), sag("1,176.00 TL", 250, 785),
    p("Önceki Dönem Bakiyesi", 40, 760), sag("500.00", 400, 760),
    p("11/08/2026", 40, 745), p("ÖDEME TEŞEKKÜRLER", 110, 745), sag("500.00(-)", 400, 745),
    p("06/09/2025", 40, 730), p("MONSTER (65,599.00 TL) 12/12.taksit", 110, 730), sag("1,000.00", 400, 730), sag("(9)", 470, 730),
    p("07/08/2026", 40, 715), p("METAL TUKETIM", 110, 715), sag("176.00", 400, 715), sag("0.88", 540, 715),
    p("22/08/2026", 40, 700), p("HEPSIPAY Kullanılan chip-para", 110, 700), sag("2.38(-)", 540, 700),
  ];
  it("tutar sütunundaki hücreyi okur; sağdaki taksit/chip sütunlarını ve sütun dışı üstbilgiyi yok sayar", () => {
    const { rows, dogrulama } = parseStatement(pdfSatirlariKurKonumlu(parcalar), "kart");
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ["2026-08-11", 500], ["2025-09-06", -1000], ["2026-08-07", -176],
    ]);
    expect(dogrulama).toEqual({ tur: "donem", tamam: true, belge: 1176, okunan: 1176 });
  });
  it("aynı satırlar düz metin olarak verilse 'son sayı' kuralı yanlış sütunu okurdu (farkın kanıtı)", () => {
    const { rows } = parseStatement(pdfSatirlariKur(parcalar).join("\n"), "kart");
    expect(rows.find((r) => r.date === "2026-08-07")?.amount).not.toBe(-176);
  });
  it("hesap dökümü: neredeyse her satırda dolu iki sayı sütunundan sağdaki bakiyedir", () => {
    const d = [
      p("03.03.2026", 40, 700), p("A", 110, 700), sag("-100,00", 400, 700), sag("900,00", 500, 700),
      p("02.03.2026", 40, 685), p("B", 110, 685), sag("+500,00", 400, 685), sag("1.000,00", 500, 685),
      p("01.03.2026", 40, 670), p("C", 110, 670), sag("-50,00", 400, 670), sag("500,00", 500, 670),
    ];
    const { rows, dogrulama } = parseStatement(pdfSatirlariKurKonumlu(d));
    expect(rows.map((r) => r.amount)).toEqual([-100, 500, -50]);
    expect(dogrulama).toMatchObject({ tur: "bakiye", tamam: true });
  });
});

describe("yapışık tarih/tutar", () => {
  it("OCR'ın tarihe yapıştırdığı açıklama ayrılır, baştaki çizgi addan atılır", () => {
    const { rows } = parseStatement("06/09/2025 — MONSTER A.Ş.\t5,466.58", "kart");
    expect(rows).toEqual([{ date: "2025-09-06", name: "MONSTER A.Ş.", amount: -5466.58 }]);
  });
  it("tek boşlukla yapıştırılmış satır da çözülür", () => {
    const { rows } = parseStatement("12.03.2026 MIGROS ATASEHIR -450,25\n13.03.2026 MAAS +35.000,00");
    expect(rows).toEqual([
      { date: "2026-03-12", name: "MIGROS ATASEHIR", amount: -450.25 },
      { date: "2026-03-13", name: "MAAS", amount: 35000 },
    ]);
  });
});

describe("saatli tarih", () => {
  it("tarihin ardından saat geliyorsa ayrılmaz (aracı kurum emir satırı kayıt olmasın)", () => {
    expect(parseStatement("31/07/26 10:25:24\tLimit Emri\tQUICK\tAlış\t3830,00").rows).toEqual([]);
  });
});
