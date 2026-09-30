/* ————— PDF METİN PARÇALARINDAN SATIR KURMA (Faz 45) —————
   PDF'te "satır" diye bir şey yoktur: sayfa, koordinatı verilmiş metin parçalarından oluşur
   (pdf.js `getTextContent`). Bir ekstre satırı çoğu zaman birkaç parçadır — tarih, açıklama,
   tutar ayrı ayrı çizilir, uzun bir açıklama bile ikiye bölünebilir. Burada parçalar aynı
   yükseklikte olanlar bir araya getirilerek satırlara dizilir; aralarındaki boşluk genişse
   SEKME konur. Böylece çıktı, Excel'den kopyalanmış bir tablo gibi `parseStatement`'a verilir
   ve ekstreyi anlama işi tek yerde kalır (yapıştırılan metinle aynı ayrıştırıcı).
   Saf fonksiyon — pdf.js'e bağlı değil, testlerle korunur. */

/** Tek metin parçası: `x`,`y` sol-alt köşe (PDF koordinatı: y YUKARI doğru artar), `w` genişlik, `h` yükseklik */
export type PdfParca = { s: string; x: number; y: number; w: number; h: number };

/** Parçalar arası boşluk, harf genişliğinin bu katından büyükse sütun ayrımı sayılır (sekme) */
const SUTUN_KAT = 2;

/** Konumlu hücre: metin + yatay aralığı (sayfa koordinatında). Faz 45.5: sütunlar metinden değil
    KONUMDAN bulunur — "tutar satırdaki son sayıdır" varsayımı, tutarın sağında taksit/puan/chip
    sütunu olan belgelerde yanlış sütunu okuyordu (bkz. statement.ts `sutunlar`). */
export type Hucre = { s: string; x0: number; x1: number };
export type KonumluSatir = Hucre[];

/** Bir sayfanın parçalarını yukarıdan aşağıya satırlara, satırları hücrelere dizer; hücre, aralarında
    geniş boşluk olmayan parçaların birleşimidir. Boş satırlar atılır. */
export function pdfSatirlariKurKonumlu(parcalar: PdfParca[]): KonumluSatir[] {
  const dolu = parcalar.filter((p) => p.s.trim() !== "");
  if (!dolu.length) return [];
  // yukarıdan aşağıya (y büyükten küçüğe), aynı yükseklikte soldan sağa
  const sirali = [...dolu].sort((a, b) => b.y - a.y || a.x - b.x);
  const satirlar: PdfParca[][] = [];
  for (const p of sirali) {
    const son = satirlar[satirlar.length - 1];
    /* Aynı satır: taban çizgileri yazı yüksekliğinin yarısından yakın. Sabit bir tolerans
       olmaz — 7 punto dipnot ile 12 punto tablo aynı sayfada durur. */
    if (son && Math.abs(son[0].y - p.y) <= Math.max(son[0].h, p.h, 1) * 0.5) son.push(p);
    else satirlar.push([p]);
  }
  return satirlar
    .map((satir) => {
      satir.sort((a, b) => a.x - b.x);
      const hucreler: Hucre[] = [{ s: satir[0].s, x0: satir[0].x, x1: satir[0].x + satir[0].w }];
      for (let i = 1; i < satir.length; i++) {
        const onceki = satir[i - 1], p = satir[i], h = hucreler[hucreler.length - 1];
        const bosluk = p.x - (onceki.x + onceki.w);
        const harf = onceki.w / Math.max(onceki.s.length, 1) || p.h * 0.5;
        if (bosluk > harf * SUTUN_KAT) { hucreler.push({ s: p.s, x0: p.x, x1: p.x + p.w }); continue; }
        const ayrac = bosluk > harf * 0.2 && !/\s$/.test(h.s) && !/^\s/.test(p.s) ? " " : "";
        h.s += ayrac + p.s;
        h.x1 = Math.max(h.x1, p.x + p.w);
      }
      return hucreler
        .map((h) => ({ ...h, s: h.s.replace(/[\s\u00a0]+/g, " ").trim() }))
        .filter((h) => h.s !== "");
    })
    .filter((h) => h.length > 0);
}

/** Aynısının düz metni: hücreler sekmeyle ayrılır — yapıştırılmış bir tablo gibi. */
export function pdfSatirlariKur(parcalar: PdfParca[]): string[] {
  return pdfSatirlariKurKonumlu(parcalar).map((satir) => satir.map((h) => h.s).join("\t"));
}
