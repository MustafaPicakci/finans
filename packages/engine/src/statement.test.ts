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

  it("belge yalnız eksi işareti kullanıyorsa işaretsiz satır artıdır — varsayılan 'gider' olsa bile", () => {
    const txt = "12.03.2026\tMIGROS\t-450,25\n14.03.2026\tÖDEME - TEŞEKKÜRLER\t5.000,00";
    expect(parseStatement(txt, "gider").rows.map((r) => r.amount)).toEqual([-450.25, 5000]);
  });

  it("belge yalnız artı işareti kullanıyorsa işaretsiz satır eksidir", () => {
    const txt = "12.03.2026\tMAAS\t+35.000,00\n14.03.2026\tMIGROS\t450,25";
    expect(parseStatement(txt, "gelir").rows.map((r) => r.amount)).toEqual([35000, -450.25]);
  });

  it("belge iki işareti de kullanıyorsa ya da hiç kullanmıyorsa işaretsiz satırda karar varsayılanındır", () => {
    const ikisi = "12.03.2026\tA\t-1\n13.03.2026\tB\t+2\n14.03.2026\tC\t3";
    expect(parseStatement(ikisi, "gider").rows.map((r) => r.amount)).toEqual([-1, 2, -3]);
    expect(parseStatement(ikisi, "gelir").rows.map((r) => r.amount)).toEqual([-1, 2, 3]);
    expect(parseStatement("12.03.2026\tA\t1\n13.03.2026\tB\t2", "gider").rows.map((r) => r.amount)).toEqual([-1, -2]);
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

/* ————— Faz 45.3: gerçek e-ekstrelerde bulunan durum TÜRLERİ —————
   Satırlar uydurmadır; yapıları gerçek belgelerden alındı (banka adı geçmez, kural genel). */

describe("parseDate — ay adıyla yazılan tarih", () => {
  it("Türkçe ay adını ve kısaltmasını tanır", () => {
    expect(parseDate("30 Ağustos 2026")).toBe("2026-08-30");
    expect(parseDate("03 Eylül 2026")).toBe("2026-09-03");
    expect(parseDate("7 EKİM 2026")).toBe("2026-10-07");
    expect(parseDate("12 Ara 2025")).toBe("2025-12-12");
    expect(parseDate("1 Şub. 2026")).toBe("2026-02-01");
    expect(parseDate("14 Eylül 2026, Pazartesi")).toBe("2026-09-14");
  });
  it("ay olmayan kelimede null döner", () => {
    expect(parseDate("30 Kasa 2026")).toBeNull();
    expect(parseDate("30 Ma 2026")).toBeNull(); // Mart mı Mayıs mı belli değil
  });
});

describe("parseAmount — binlik gruplar 3 hanedir", () => {
  it("virgülden sonra 3'ten çok hane ondalıktır", () => {
    expect(parseAmount("4,17552660 TRY")).toBeCloseTo(4.1755266);
    expect(parseAmount("67848.640000")).toBeCloseTo(67848.64);
  });
  it("gruplaması bozuk sayı tutar değildir (tarih tutar sanılmasın)", () => {
    expect(parseAmount("10.02.2026")).toBeNull();
    expect(parseAmount("1.23.456")).toBeNull();
    expect(parseAmount("1.234.567")).toBe(1234567);
    expect(parseAmount("1.234.567,5")).toBeCloseTo(1234567.5);
  });
  it("OCR'ın rakam okuduğu '(' ile yarım kalan (-) eki: kuruştan sonraki fazla hane atılır", () => {
    expect(parseAmount("19,394.544-)")).toBeCloseTo(-19394.54);
    expect(parseAmount("1.234,56-)")).toBeCloseTo(-1234.56);
    expect(parseAmount("450-)")).toBeNull(); // kuruşsuz, belirsiz: tutar sayılmaz
  });
  it("sondaki (-) / (+) işaretini tanır", () => {
    expect(parseAmount("19.394,54(-)")).toBeCloseTo(-19394.54);
    expect(parseAmount("2,38(+)")).toBeCloseTo(2.38);
  });
});

describe("parseStatement — kart ekstresi (harcama işaretsiz)", () => {
  it("ödemeyi '+' ile yazan belgede işaretli satır ödemedir", () => {
    const txt = [
      "03 Eylül 2026\tÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ\t7.630,53+",
      "30 Ağustos 2026\tSIGORTA\t1.320,00",
      "22 Eylül 2026\tYEMEK\t240,00",
    ].join("\n");
    expect(parseStatement(txt, "kart").rows.map((r) => r.amount)).toEqual([7630.53, -1320, -240]);
  });
  it("ödemeyi '−' ile yazan belgede de işaretli satır ödemedir", () => {
    const txt = "11/08/2026\tOdeme - Tesekkur Ederiz -\t-5,000.00\n21/07/2026\tNakit Avans\t5,000.00\t2/3";
    expect(parseStatement(txt, "kart").rows.map((r) => r.amount)).toEqual([5000, -5000]);
  });
  it("bütün satırlar işaretliyse çoğunluk harcamadır", () => {
    const txt = "01.09.2026\tA\t-100,00\n02.09.2026\tB\t-200,00\n03.09.2026\tÖDEME\t+300,00";
    expect(parseStatement(txt, "kart").rows.map((r) => r.amount)).toEqual([-100, -200, 300]);
    const ters = "01.09.2026\tA\t+100,00\n02.09.2026\tB\t+200,00\n03.09.2026\tÖDEME\t-300,00";
    expect(parseStatement(ters, "kart").rows.map((r) => r.amount)).toEqual([-100, -200, 300]);
  });
  it("puan/döviz sütunu tutarı şaşırtmaz: tutar satırın son sayısıdır", () => {
    const txt = [
      "23 Eylül 2026\tIYZICO *AMAZON\t0,18\t359,90",
      "24 Eylül 2026\tYAZILIM ABONELIGI\t24,00 USD\t1.207,41",
      "17 Eylül 2026\tVIDEO\t239,99 TL\t239,99",
    ].join("\n");
    expect(parseStatement(txt, "kart").rows.map((r) => r.amount)).toEqual([-359.9, -1207.41, -239.99]);
  });
  it("adında 'işlem' geçen satır başlık sanılmaz", () => {
    expect(parseStatement("05.09.2026\tISLEM UCRETI\t12,50", "kart").rows).toHaveLength(1);
  });
});

describe("parseStatement — hesap dökümünde iki satıra bölünen kayıt", () => {
  /* Açıklama iki satıra taşınca PDF tarihi ve tutarı ayrı satırlara çizer (hücreler dikeyde
     ortalı). Tarihli-tutarsız satır, komşusundaki tarihsiz tutar+bakiye parçasıyla birleşir. */
  const txt = [
    "10.02.2026\tHAVALE\t-381.000,00 TL\t742,74 TL",
    "+380.415,78 TL\t381.742,74 TL",
    "10.02.2026\tPara Transferi",
    "05.02.2026\tFATURA\t-200,00 TL\t1.326,96 TL",
    "FAST123-UZUN BIR ACIKLAMA\t+220,00 TL\t1.526,96 TL",
    "04.02.2026\tPara Transferi",
    "tarafında",
    "03.02.2026\tMAAS\t+1.000,00 TL\t1.306,96 TL",
  ].join("\n");
  it("parçaları birleştirir, satır kaybolmaz", () => {
    const { rows } = parseStatement(txt);
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ["2026-02-10", -381000], ["2026-02-10", 380415.78], ["2026-02-05", -200],
      ["2026-02-04", 220], ["2026-02-03", 1000],
    ]);
    expect(rows[3].name).toBe("FAST123-UZUN BIR ACIKLAMA Para Transferi"); // bölünmemiş satırla aynı sıra: açıklama, etiket
  });
  it("bakiye sütunu yoksa birleştirme yapılmaz (üstbilgi satırı kayda dönüşmesin)", () => {
    const { rows } = parseStatement("Nakit Avans Limiti\t25.000,00 TL\nHesap Kesim Tarihi\t27 Eylül 2026\n28.09.2026\tMARKET\t-50,00", "gider");
    expect(rows).toHaveLength(1);
  });
});

describe("parseStatement — belgeyle doğrulama", () => {
  it("bakiye zinciri: tam okunan döküm tutar (yeniden eskiye sıralı)", () => {
    const txt = [
      "03.03.2026\tA\t-100,00\t900,00",
      "02.03.2026\tB\t+500,00\t1.000,00",
      "01.03.2026\tC\t-50,00\t500,00",
    ].join("\n");
    expect(parseStatement(txt).dogrulama).toEqual({ tur: "bakiye", tamam: true, kopukluklar: [], son: { tarih: "2026-03-03", bakiye: 900 } });
  });
  it("bakiye zinciri: eskiden yeniye sıralı döküm de tanınır", () => {
    const txt = "01.03.2026\tC\t-50,00\t500,00\n02.03.2026\tB\t+500,00\t1.000,00\n03.03.2026\tA\t-100,00\t900,00";
    expect(parseStatement(txt).dogrulama).toMatchObject({ tur: "bakiye", tamam: true, son: { tarih: "2026-03-03", bakiye: 900 } });
  });
  it("bakiye zinciri: kayıp satırın yerini ve tutarını söyler", () => {
    const txt = [
      "03.03.2026\tA\t-100,00\t900,00",
      // 02.03.2026 +500,00 → 1.000,00 satırı okunamadı
      "01.03.2026\tC\t-50,00\t500,00",
    ].join("\n");
    expect(parseStatement(txt).dogrulama).toEqual({
      tur: "bakiye", tamam: false, kopukluklar: [{ once: "2026-03-03", sonra: "2026-03-01", eksik: 500 }], son: { tarih: "2026-03-03", bakiye: 900 },
    });
  });
  it("kart: önceki dönem + harcamalar − ödemeler = dönem borcu", () => {
    const txt = [
      "Dönem Borcunuz\t5.984,30 TL",
      "ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR\t7.630,53",
      "03 Eylül 2026\tÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ\t7.630,53+",
      "30 Ağustos 2026\tSIGORTA\t5.000,00",
      "22 Eylül 2026\tYEMEK\t984,30",
    ].join("\n");
    expect(parseStatement(txt, "kart").dogrulama).toEqual({ tur: "donem", tamam: true, belge: 5984.3, okunan: 5984.3 });
    const eksik = txt.split("\n").slice(0, 4).join("\n");
    expect(parseStatement(eksik, "kart").dogrulama).toMatchObject({ tur: "donem", tamam: false, okunan: 5000 });
  });
  it("dayanak yoksa doğrulama yapılmadığını söyler, uydurmaz", () => {
    expect(parseStatement("12.03.2026\tMigros\t-450").dogrulama).toEqual({ tur: "yok" });
    // önceki dönem satırı okunamadıysa (ör. bozuk yazı tipi) sıfır varsayılmaz
    expect(parseStatement("Dönem Borcu\t5,000.00\n21/07/2026\tA\t5,000.00", "kart").dogrulama).toEqual({ tur: "yok" });
  });
});

describe("parseStatement — ad ve yazı tipi (Faz 45.3)", () => {
  it("tarih ile tutar arasındaki metin hücreleri birleşir", () => {
    expect(parseStatement("23 Eylül 2026\tIYZICO\t*AMAZON.COM.T\t0,18\t359,90", "kart").rows[0].name).toBe("IYZICO *AMAZON.COM.T");
    // tarihten önceki gizli/boş hücre ada karışmaz
    expect(parseStatement("bosluk\t03 Eylül 2026\tÖDEME\t7.630,53+", "kart").rows[0].name).toBe("ÖDEME");
  });
  it("arada metin yoksa en uzun metin hücresi ad olur", () => {
    expect(parseStatement("-450,25\tMIGROS ATASEHIR\t12.03.2026\tX").rows[0].name).toBe("MIGROS ATASEHIR");
  });
  it("Türkçe harfleri çözülememiş belgeyi işaretler, temiz belgeyi işaretlemez", () => {
    const bozuk = "D#nem Borcu\t5,000.00\nM!\"teri Numarası\t123\n11/08/2026\t%deme - Tesekk!r Ederiz -\t-5,000.00";
    expect(parseStatement(bozuk, "kart").bozukHarf).toBe(true);
    const temiz = "Dönem Borcu\t5.000,00\n11.08.2026\tÖdeme - Teşekkür Ederiz\t-5.000,00\n12.08.2026\tAT&T ROAMING\t10,00\nAylık faiz %3,25";
    expect(parseStatement(temiz, "kart").bozukHarf).toBe(false);
  });
});
