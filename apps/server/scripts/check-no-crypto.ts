/* ============================================================================
   Derleme kapısı: sunucu kripto paketine LİNK'LENMEZ (E2EE aşama 3)
   ----------------------------------------------------------------------------
   "Sunucu kullanıcının verisini okuyamaz" garantisi bir SÖZ olarak kalmamalı: sunucu
   süreci anahtar üreten/açan koda hiç erişemiyorsa, bir hata ya da ileride yapılacak bir
   "kolaylık" onu sessizce bozamaz. Bu betik apps/server altındaki her .ts dosyasında
   `@finans/crypto` import'u arar ve bulursa build'i durdurur.

   Tek istisna ileride gelecek: alan haritası (`@finans/crypto/map`) — o SAF VERİDİR,
   yalnız tip ve kolon adları taşır, anahtar koduna dokunmaz. Şema kapısı onu okuyacak. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = new URL("..", import.meta.url).pathname;
const IZINLI = /@finans\/crypto\/map["']/;
const YASAK = /from\s+["']@finans\/crypto(\/[^"']*)?["']|import\(\s*["']@finans\/crypto/;

function gez(dizin: string, out: string[] = []): string[] {
  for (const ad of readdirSync(dizin)) {
    if (ad === "node_modules" || ad.startsWith(".")) continue;
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) gez(yol, out);
    else if (/\.(ts|mts|js|mjs)$/.test(ad)) out.push(yol);
  }
  return out;
}

const ihlal: string[] = [];
for (const dosya of gez(KOK)) {
  readFileSync(dosya, "utf8").split("\n").forEach((satir, i) => {
    if (YASAK.test(satir) && !IZINLI.test(satir)) ihlal.push(`${relative(KOK, dosya)}:${i + 1}  ${satir.trim()}`);
  });
}

if (ihlal.length) {
  console.error("[kripto] SUNUCU kripto paketini import ediyor — sıfır bilgi garantisi yapısal olarak bozulur:");
  for (const x of ihlal) console.error("  " + x);
  console.error("Anahtar üreten/açan kod YALNIZ tarayıcıda çalışır. Gerekçe: docs/E2EE.md §7.");
  process.exit(1);
}
console.log("[kripto] Sunucu kripto paketine bağlı değil ✓");
