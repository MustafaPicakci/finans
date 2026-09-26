/* ============================================================================
   Tüm yazmaların TEK boru hattı (E2EE aşama 5)
   ----------------------------------------------------------------------------
   Formlar (`api.post/put`), adlandırılmış uçlar (`payStatement`, `realizeRecurring`…) ve
   asistanın yazma araçları (`features/asistan/istemci.ts`) bu fonksiyondan geçer.
   Tek kapı olmasının sebebi şifreleme: aşama 6'da gövdenin hassas alanları burada
   zarflanacak — kapıyı atlayan her yol şifrelemeyi de atlardı ve bu SESSİZ olurdu
   (düz metin veritabanına yazılır, kimse fark etmez).

   Boru hattı: türetilen tutarları tamamla (tutar.ts) → [aşama 5b+: zarfla] → gönder. */

import type { AllData } from "@finans/engine";
import { tutarTamamla } from "./tutar";

/** Son `/api/all` yanıtı — türetilen tutarlar bu veriden hesaplanır. `api.all()` günceller. */
let sonVeri: AllData | null = null;
export const veriAyarla = (d: AllData) => { sonVeri = d; };

export type Yanit = { status: number; data: any };

/** `path`: `/api` öneksiz ("/trades", "/cards/5/pay-statement"). */
export async function yaz(method: string, path: string, body?: unknown): Promise<Yanit> {
  const govde = body !== undefined && body !== null && typeof body === "object" && !Array.isArray(body)
    ? tutarTamamla(method, path, body as Record<string, unknown>, sonVeri)
    : body;
  const r = await fetch(`/api${path}`, {
    method,
    headers: govde === undefined ? undefined : { "Content-Type": "application/json" },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
