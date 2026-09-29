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

/** Bir sayfanın parçalarını yukarıdan aşağıya satırlara dizer. Boş satırlar atılır. */
export function pdfSatirlariKur(parcalar: PdfParca[]): string[] {
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
      let metin = satir[0].s;
      for (let i = 1; i < satir.length; i++) {
        const onceki = satir[i - 1], p = satir[i];
        const bosluk = p.x - (onceki.x + onceki.w);
        const harf = onceki.w / Math.max(onceki.s.length, 1) || p.h * 0.5;
        const ayrac = bosluk > harf * SUTUN_KAT ? "\t" : bosluk > harf * 0.2 && !/\s$/.test(metin) && !/^\s/.test(p.s) ? " " : "";
        metin += ayrac + p.s;
      }
      return metin.replace(/[  ]+/g, " ").replace(/ ?\t ?/g, "\t").trim();
    })
    .filter((m) => m !== "");
}
