import type { KonumluSatir } from "@finans/engine";
import type { OkuIstegi, OkuyucuMesaji } from "../../okuyucu/protokol";

/* ————— BELGE OKUMA: KAPALI OKUYUCUYA GÖNDER (Faz 45.6) —————
   PDF'i ve ekran görüntüsünü bu sayfa OKUMAZ. Dosyanın baytları ayrı bir sayfaya
   (`/okuyucu.html`, src/okuyucu/) gönderilir; o sayfa `sandbox="allow-scripts"` ile, yani opak
   kökenle gömülüdür — veri anahtarına (IndexedDB), çereze ve uygulamanın belleğine erişemez.
   pdf.js ve Tesseract (OCR) yalnız orada yüklenir; geri dönen tek şey konumlu metin satırlarıdır.
   Dosya bu cihazdan çıkmaz: okuyucu da tarayıcıda çalışır, ağa yalnız kendi dosyaları için çıkar.

   Geliştirmede (Vite, :5173) okuyucu `allow-same-origin` ile açılır: Vite geliştirme sunucusu
   opak köken ("null") isteklerine CORS vermiyor (güvenlik gereği) ve modüller yüklenemezdi. Kod
   yolu aynıdır, yalnız yalıtım prod'dadır — yalıtımı denemek için build + :8787. */

/** Belge parolalı: `yanlis` true ise girilen parola tutmadı */
export class PdfParolaGerekli extends Error {
  constructor(public yanlis: boolean) { super(yanlis ? "Parola yanlış" : "Bu PDF parolalı"); }
}

export type OkumaSonucu = { satirlar: KonumluSatir[]; sayfa: number; ocrSayfa: number };

let cerceve: Promise<HTMLIFrameElement> | null = null;
/** Okuyucu tek kez açılır ve sayfa açık kaldıkça yaşar (OCR motorunun yeniden yüklenmesin diye). */
function okuyucu(): Promise<HTMLIFrameElement> {
  return (cerceve ??= new Promise((coz, reddet) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", import.meta.env.DEV ? "allow-scripts allow-same-origin" : "allow-scripts");
    f.setAttribute("aria-hidden", "true");
    f.style.display = "none";
    f.src = "/okuyucu.html";
    const zaman = setTimeout(() => { cerceve = null; f.remove(); reddet(new Error("Belge okuyucu açılamadı")); }, 20_000);
    const dinle = (e: MessageEvent<OkuyucuMesaji>) => {
      if (e.source !== f.contentWindow || e.data?.tip !== "hazir") return;
      clearTimeout(zaman); window.removeEventListener("message", dinle); coz(f);
      /* Yalıtımın SINIRI: opak köken anahtara ve veriye erişemez, CSP ağı kapatır — ama bir çerçeve
         KENDİNİ başka adrese yönlendirebilir ve bunu CSP engellemez. Ele geçirilmiş bir kütüphane
         böylece o an okuduğu belgeyi adres satırında taşıyabilir. Bunu önleyemiyoruz; önlediğimiz,
         SONRAKİ dosyanın oraya gitmesi: ilk yüklemeden sonra çerçeve yeniden yüklenirse yok edilir. */
      f.addEventListener("load", () => { cerceve = null; f.remove(); });
    };
    window.addEventListener("message", dinle);
    document.body.appendChild(f);
  }));
}

let sayac = 0;
/** Dosyayı (PDF ya da resim) okuyucuya gönderir, konumlu satırları döndürür. */
export async function belgeOku(dosya: File, parola?: string, ilerleme?: (m: string) => void): Promise<OkumaSonucu> {
  const f = await okuyucu();
  const id = ++sayac;
  const mime = dosya.type || (dosya.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png");
  const veri = await dosya.arrayBuffer();
  return new Promise((coz, reddet) => {
    const dinle = (e: MessageEvent<OkuyucuMesaji>) => {
      const m = e.data;
      if (e.source !== f.contentWindow || !m || !("id" in m) || m.id !== id) return;
      if (m.tip === "ilerleme") { ilerleme?.(m.metin); return; }
      window.removeEventListener("message", dinle);
      if (m.tip === "sonuc") coz({ satirlar: m.satirlar, sayfa: m.sayfa, ocrSayfa: m.ocrSayfa });
      else if (m.kod === "parola" || m.kod === "parola-yanlis") reddet(new PdfParolaGerekli(m.kod === "parola-yanlis"));
      else reddet(new Error(m.mesaj || "Belge okunamadı"));
    };
    window.addEventListener("message", dinle);
    const istek: OkuIstegi = { id, tur: "oku", mime, veri, parola };
    f.contentWindow!.postMessage(istek, "*", [veri]); // opak kökene hedef köken verilemez; bayt aktarılır, kopyalanmaz
  });
}
