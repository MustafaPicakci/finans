import { pdfSatirlariKur, type PdfParca } from "@finans/engine";

/* ————— PDF EKSTRE OKUMA (Faz 45) —————
   Dosya tarayıcıdan ÇIKMAZ: pdf.js onu burada açar, metnini okur, satırlar yapıştırılmış metin
   gibi var olan ayrıştırıcıya gider ve kayıtlar her zamanki gibi şifrelenip yazılır. OCR yok —
   bankaların e-ekstrelerinde metin katmanı var ve rakamı tahmin etmek yerine birebir okuyoruz.

   pdf.js büyük bir dış kütüphane ve veri anahtarının bulunduğu sayfada çalışıyor, bu yüzden:
   - sürümü package.json'da TAM sabit (yükseltme bilinçli bir iş olsun),
   - yalnız kullanıcı PDF seçince yüklenir (ayrı parça; açılış paketine ve servis çalışanı
     önbelleğine girmez — vite.config.ts `globIgnores`),
   - `useWasm: false`: WebAssembly yalnız resim çözmek içindir, metin için gerekmez (CSP'miz
     `wasm-unsafe-eval` vermiyor). pdf.js 6'da `eval` hiç yok (eski `isEvalSupported` kalktı).
   Metin çıkarmak için ne yazı tipi ne resim çözülür; sayfa çizilmez. */

/** Ekstre parolalı: `yanlis` true ise girilen parola tutmadı */
export class PdfParolaGerekli extends Error {
  constructor(public yanlis: boolean) { super(yanlis ? "Parola yanlış" : "Bu PDF parolalı"); }
}

/** PDF dosyasının tüm sayfalarını metin satırlarına çevirir (sayfa sırasıyla, yukarıdan aşağıya). */
export async function pdfSatirlari(dosya: File, parola?: string): Promise<string[]> {
  const [pdfjs, isci] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = isci.default;
  const gorev = pdfjs.getDocument({
    data: new Uint8Array(await dosya.arrayBuffer()),
    password: parola,
    useWasm: false,
    disableFontFace: true,
  });
  let belge;
  try {
    belge = await gorev.promise;
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) throw new PdfParolaGerekli(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (e instanceof pdfjs.InvalidPDFException) throw new Error("Bu dosya okunabilir bir PDF değil.");
    throw e;
  }
  try {
    const satirlar: string[] = [];
    for (let i = 1; i <= belge.numPages; i++) {
      const sayfa = await belge.getPage(i);
      const icerik = await sayfa.getTextContent();
      const parcalar: PdfParca[] = [];
      for (const o of icerik.items) {
        if (!("str" in o)) continue; // işaretli içerik başlıkları, metin değil
        parcalar.push({ s: o.str, x: o.transform[4], y: o.transform[5], w: o.width, h: o.height || Math.abs(o.transform[3]) });
      }
      satirlar.push(...pdfSatirlariKur(parcalar));
      sayfa.cleanup();
    }
    return satirlar;
  } finally {
    await gorev.destroy();
  }
}
