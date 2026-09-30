/* ————— KAPALI OKUYUCU (Faz 45.6) —————
   Ekstre PDF'ini ve ekran görüntüsünü okuyan iki büyük dış kütüphane — pdf.js ve Tesseract
   (OCR) — BURADA, uygulamadan ayrı bir sayfada çalışır. Sayfa `sandbox="allow-scripts"` ile
   (allow-same-origin OLMADAN) gömülür: kökeni opaktır, yani uygulamanın IndexedDB'sindeki veri
   anahtarına, çerezine, bellekteki çözülmüş veriye ERİŞEMEZ. Kendi CSP'si (sunucu,
   `/okuyucu.html`) ağı yalnız kendi dosyalarına açar. Ele geçirilmiş bir kütüphanenin
   yapabileceği en kötü şey, kendisine verilen dosyayı yanlış okumaktır — o da belgeyle
   doğrulanır (statement.ts `dogrulama`).

   Önceden pdf.js veri anahtarının bulunduğu sayfada çalışıyordu (park edilmiş tedarik zinciri
   kaygısı); OCR için ~3 MB'lık bir WebAssembly motoru daha eklemek bunu büyütecekti. İkisi de
   buraya taşındı.

   Akış: PDF'in her sayfası önce metin katmanından okunur; katman yoksa (bazı bankalar her harfi
   resim olarak çizer) sayfa çizilip OCR'lanır. Resim dosyası doğrudan OCR'lanır. İki yol da
   aynı koordinatlı parçayı üretir ve `pdfSatirlariKurKonumlu`ya gider — ayrıştırma tek yerde. */

import * as pdfjs from "pdfjs-dist";
import isciUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, type Worker as OcrIsci } from "tesseract.js";
import { pdfSatirlariKurKonumlu, type KonumluSatir, type PdfParca } from "@finans/engine";
import type { OkuIstegi, OkuyucuMesaji } from "./protokol";

const gonder = (m: OkuyucuMesaji) => window.parent.postMessage(m, "*"); // ebeveynin kökeni sabit değil (dev/prod); içerik yalnız konumlu metin

/* pdf.js işçisi: opak kökenli sayfa ne sunucunun adresinden ne de kendi bloğundan MODÜL işçisi
   açabiliyor (Chrome: "Refused to cross-origin redirects of the top-level worker script" — denendi).
   Üstelik işçiyi DENEMEK bile zararlı: başarısızlık gecikmeli geliyor, pdf.js yedeğe düşüyor ama
   sayfa çizimi (OCR için) sonsuza dek bekliyordu (denendi). Bu yüzden işçi kodu önceden bu sayfaya
   içe aktarılır (`globalThis.pdfjsWorker`): pdf.js onu görünce işçi açmayı hiç denemez, işi bu
   sayfanın iş parçacığında yapar — uygulamanın değil okuyucunun, arayüz donmaz. Tesseract'ın
   KLASİK blok işçisi ise çalışıyor (OCR ayrı iş parçacığında). */
const isciAdres = new URL(isciUrl, location.href).href;
pdfjs.GlobalWorkerOptions.workerSrc = isciAdres;
const pdfHazir = import(/* @vite-ignore */ isciAdres);

/** OCR dosyaları sunucudan (vite.config.ts `okuyucuVeri`): işçi, motor (SIMD desteğine göre
    birini seçer), Türkçe dil verisi. Opak kökende IndexedDB yok → önbellek kapalı (HTTP önbelleği yeter). */
const VERI = new URL("/okuyucu-veri/", location.href).href;
let ocr: Promise<OcrIsci> | null = null;
let ocrIlerleme: (m: string) => void = () => {};
const ocrAc = () => (ocr ??= createWorker("tur", 1, {
  workerPath: VERI + "worker.min.js", corePath: VERI, langPath: VERI, cacheMethod: "none", workerBlobURL: true,
  logger: (m) => { if (m.status === "recognizing text") ocrIlerleme(`%${Math.round(m.progress * 100)}`); else ocrIlerleme("OCR hazırlanıyor…"); },
}));

/** Bir görüntüyü OCR'lar; kelimeler koordinatlı parçaya çevrilir (y yukarı doğru artsın diye eksi). */
async function ocrParcalari(goruntu: HTMLCanvasElement | Blob): Promise<PdfParca[]> {
  const isci = await ocrAc();
  const { data } = await isci.recognize(goruntu, {}, { blocks: true });
  const out: PdfParca[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
    const { x0, y0, x1, y1 } = w.bbox;
    out.push({ s: w.text, x: x0, y: -y1, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/** OCR için hedef genişlik (px): küçük punto rakamların doğru okunması için sayfa büyütülerek çizilir. */
const OCR_GENISLIK = 2400;

async function pdfOku(veri: ArrayBuffer, parola: string | undefined, ilerle: (m: string) => void) {
  await pdfHazir;
  const gorev = pdfjs.getDocument({ data: new Uint8Array(veri), password: parola, useWasm: false, disableFontFace: true });
  const belge = await gorev.promise;
  try {
    const satirlar: KonumluSatir[] = [];
    let ocrSayfa = 0;
    for (let i = 1; i <= belge.numPages; i++) {
      const sayfa = await belge.getPage(i);
      const icerik = await sayfa.getTextContent();
      const parcalar: PdfParca[] = [];
      for (const o of icerik.items) {
        if (!("str" in o) || !o.str.trim()) continue;
        parcalar.push({ s: o.str, x: o.transform[4], y: o.transform[5], w: o.width, h: o.height || Math.abs(o.transform[3]) });
      }
      if (parcalar.length >= 3) {
        satirlar.push(...pdfSatirlariKurKonumlu(parcalar));
      } else {
        // metin katmanı yok: sayfayı çiz, OCR'la
        ocrSayfa++;
        ocrIlerleme = (m) => ilerle(`Sayfa ${i}/${belge.numPages} metin olarak okunuyor (OCR) ${m}`);
        ilerle(`Sayfa ${i}/${belge.numPages} çiziliyor…`);
        const bir = sayfa.getViewport({ scale: 1 });
        const vp = sayfa.getViewport({ scale: Math.min(4, OCR_GENISLIK / bir.width) });
        const tuval = document.createElement("canvas");
        tuval.width = Math.ceil(vp.width); tuval.height = Math.ceil(vp.height);
        const ctx = tuval.getContext("2d")!;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tuval.width, tuval.height);
        /* `print`: ekran çizimi işi requestAnimationFrame ile parçalar ve Chrome görünmeyen başka
           kökenli çerçevede (opak köken öyle sayılır) rAF'ı durdurur — çizim hiç bitmiyordu (denendi).
           Baskı amaçlı çizim rAF kullanmaz; OCR'ın istediği de ekran değil, tam bir görüntü. */
        await sayfa.render({ canvas: tuval, canvasContext: ctx, viewport: vp, intent: "print" }).promise;
        satirlar.push(...pdfSatirlariKurKonumlu(await ocrParcalari(tuval)));
      }
      sayfa.cleanup();
    }
    return { satirlar, sayfa: belge.numPages, ocrSayfa };
  } finally {
    await gorev.destroy();
  }
}

window.addEventListener("message", async (e: MessageEvent<OkuIstegi>) => {
  if (e.source !== window.parent || e.data?.tur !== "oku") return;
  const { id, mime, veri, parola } = e.data;
  const ilerle = (metin: string) => gonder({ id, tip: "ilerleme", metin });
  try {
    if (mime === "application/pdf") {
      gonder({ id, tip: "sonuc", ...(await pdfOku(veri, parola, ilerle)) });
    } else {
      ocrIlerleme = (m) => ilerle(`Görüntü metin olarak okunuyor (OCR) ${m}`);
      ilerle("OCR hazırlanıyor…");
      const satirlar = pdfSatirlariKurKonumlu(await ocrParcalari(new Blob([veri], { type: mime })));
      gonder({ id, tip: "sonuc", satirlar, sayfa: 1, ocrSayfa: 1 });
    }
  } catch (err) {
    if (err instanceof pdfjs.PasswordException) {
      gonder({ id, tip: "hata", kod: err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "parola-yanlis" : "parola" });
    } else {
      gonder({ id, tip: "hata", kod: "okunamadi", mesaj: err instanceof pdfjs.InvalidPDFException ? "Bu dosya okunabilir bir PDF değil." : String((err as Error)?.message ?? err) });
    }
  }
});

gonder({ tip: "hazir" });
