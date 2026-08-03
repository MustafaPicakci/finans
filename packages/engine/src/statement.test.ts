import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseStatement } from "./statement.js";

describe("parseDate", () => {
  it("TR gün.ay.yıl biçimini çözer", () => {
    expect(parseDate("12.03.2026")).toBe("2026-03-12");
    expect(parseDate("01/02/2026")).toBe("2026-02-01");
    expect(parseDate("5.7.26")).toBe("2026-07-05");
  });
  it("ISO biçimini olduğu gibi kabul eder", () => {
    expect(parseDate("2026-03-12")).toBe("2026-03-12");
  });
  it("geçersiz tarihe null döner", () => {
    expect(parseDate("Migros")).toBeNull();
    expect(parseDate("32.01.2026")).toBeNull();
    expect(parseDate("12.13.2026")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("TR binlik/ondalık ayırıcısını çözer", () => {
    expect(parseAmount("1.234,56")).toBeCloseTo(1234.56);
    expect(parseAmount("450")).toBe(450);
    expect(parseAmount("1.234")).toBe(1234); // 3 hane → binlik, ondalık değil
  });
  it("US biçimini de çözer", () => {
    expect(parseAmount("1,234.56")).toBeCloseTo(1234.56);
  });
  it("negatif gösterimleri tanır", () => {
    expect(parseAmount("-1.234,56")).toBeCloseTo(-1234.56);
    expect(parseAmount("(1.234,56)")).toBeCloseTo(-1234.56);
    expect(parseAmount("1.234,56-")).toBeCloseTo(-1234.56);
  });
  it("para birimi eklerini yok sayar", () => {
    expect(parseAmount("1.234,56 TL")).toBeCloseTo(1234.56);
    expect(parseAmount("₺450")).toBe(450);
  });
  it("sayı olmayana null döner", () => {
    expect(parseAmount("Migros")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("parseStatement", () => {
  it("sekmeyle ayrılmış ekstreyi çözer, başlığı atlar", () => {
    const { rows } = parseStatement("Tarih\tAçıklama\tTutar\n12.03.2026\tMIGROS ATASEHIR\t-450,25\n13.03.2026\tMAAS\t+35.000,00");
    expect(rows).toEqual([
      { date: "2026-03-12", name: "MIGROS ATASEHIR", amount: -450.25 },
      { date: "2026-03-13", name: "MAAS", amount: 35000 },
    ]);
  });

  it("noktalı virgüllü CSV'yi çözer", () => {
    const { rows } = parseStatement("12.03.2026;Benzin;-1.200,00");
    expect(rows).toEqual([{ date: "2026-03-12", name: "Benzin", amount: -1200 }]);
  });

  it("bakiye sütunu varsa tutarı bakiyeden ayırır", () => {
    const txt = [
      "12.03.2026\tMIGROS\t-450,25\t10.000,00",
      "13.03.2026\tBENZIN\t-1.200,00\t8.800,00",
      "14.03.2026\tMAAS\t35.000,00\t43.800,00",
    ].join("\n");
    const { rows } = parseStatement(txt);
    expect(rows.map((r) => r.amount)).toEqual([-450.25, -1200, 35000]);
  });

  it("işaretsiz tutarları varsayılan yöne göre imzalar", () => {
    expect(parseStatement("12.03.2026\tMigros\t450").rows[0].amount).toBe(-450);
    expect(parseStatement("12.03.2026\tMaaş\t450", "gelir").rows[0].amount).toBe(450);
  });

  it("tarihi veya tutarı olmayan satırları atlar", () => {
    const { rows, skipped } = parseStatement("12.03.2026\tMigros\t-450\nara toplam\nNOT: bilgilendirme");
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(2);
  });

  it("boşlukla hizalanmış metni de çözer", () => {
    const { rows } = parseStatement("12.03.2026   MIGROS ATASEHIR   -450,25");
    expect(rows).toEqual([{ date: "2026-03-12", name: "MIGROS ATASEHIR", amount: -450.25 }]);
  });
});
