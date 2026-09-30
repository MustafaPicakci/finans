/* ————— OKUYUCU MESAJ SÖZLEŞMESİ (Faz 45.6) —————
   Uygulama (ebeveyn) ile kapalı okuyucu iframe'i arasındaki TEK kanal `postMessage`'dır. İçeri
   dosyanın baytları girer, dışarı yalnız konumlu metin satırları çıkar — okuyucu uygulamanın
   verisine, anahtarına, çerezine erişemez (bkz. okuyucu/index.ts başındaki gerekçe). */

import type { KonumluSatir } from "@finans/engine";

/** Ebeveyn → okuyucu */
export type OkuIstegi = { id: number; tur: "oku"; mime: string; veri: ArrayBuffer; parola?: string };

/** Okuyucu → ebeveyn */
export type OkuyucuMesaji =
  | { tip: "hazir" }
  | { id: number; tip: "ilerleme"; metin: string }
  /** `ocrSayfa`: metin katmanı olmadığı için OCR'la okunan sayfa sayısı (0 = hiç OCR yok) */
  | { id: number; tip: "sonuc"; satirlar: KonumluSatir[]; sayfa: number; ocrSayfa: number }
  | { id: number; tip: "hata"; kod: "parola" | "parola-yanlis" | "okunamadi"; mesaj?: string };
