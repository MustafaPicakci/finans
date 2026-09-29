/* ============================================================================
   Derleme kapısı: gövdeli her istek yazma boru hattından geçer (E2EE aşama 5a)
   ----------------------------------------------------------------------------
   Aşama 6'da hassas alanlar `yaz()` içinde şifrelenecek. Gövde taşıyan ve boru hattını
   ATLAYAN tek bir `fetch` o veriyi düz metin yazar ve bu SESSİZ olur — derleme de geçer,
   uygulama da çalışır, veritabanında düz metin birikir. Bu betik apps/web/src altındaki
   her `fetch(` çağrısına bakar; gövde (`body:`) taşıyorsa ya yazim/ içinde olmalı ya da
   aşağıdaki izin listesinde GEREKÇESİYLE yer almalı.

   Gövdesiz istekler (GET, DELETE, gövdesiz POST) serbest: şifrelenecek bir şeyleri yok. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = new URL("../src", import.meta.url).pathname;
const IZINLI = [
  { url: /\/api\/auth\//, neden: "kimlik malzemesi (auth_token, sarılı anahtar) — kullanıcı verisi değil, zaten türetilmiş/şifreli" },
  { url: /\/api\/account\/delete/, neden: "hesap silme onayı: gövde kimlik kanıtıdır (auth_token), kullanıcı verisi değil" },
  { url: /\/api\/ai\/relay/, neden: "model rölesi: bağlam sağlayıcıya DÜZ METİN gitmek zorunda (model şifreli veriyle çalışamaz), saklanmaz" },
  { url: /\/api\/prices/, neden: "elle girilen piyasa fiyatı (user_prices) — kişisel harcama değil, bilinçli olarak düz (docs/E2EE.md)" },
];

function gez(d, out = []) {
  for (const ad of readdirSync(d)) {
    const y = join(d, ad);
    if (statSync(y).isDirectory()) gez(y, out);
    else if (/\.(ts|tsx)$/.test(ad) && !/\.test\.ts$/.test(ad)) out.push(y);
  }
  return out;
}

const ihlal = [];
for (const dosya of gez(KOK)) {
  const rel = relative(KOK, dosya);
  if (rel.startsWith("yazim/")) continue; // boru hattının kendisi
  const s = readFileSync(dosya, "utf8");
  for (const m of s.matchAll(/fetch\(/g)) {
    /* Çağrının argümanlarını parantez sayarak çıkar (çok satırlı olabilir). */
    let d = 0, i = m.index + 5, son = i;
    for (; i < s.length; i++) { if (s[i] === "(") d++; else if (s[i] === ")") { d--; if (d === 0) { son = i; break; } } }
    const arg = s.slice(m.index + 6, son);
    if (!/\bbody\s*:/.test(arg)) continue;
    const url = (arg.match(/^[\s]*[`"']([^`"']*)/) ?? [, "?"])[1];
    if (IZINLI.some((x) => x.url.test(url))) continue;
    ihlal.push(`${rel}:${s.slice(0, m.index).split("\n").length}  ${url}`);
  }
}
if (ihlal.length) {
  console.error("[yazım] Gövdeli istek yazma boru hattını ATLIYOR — aşama 6'da bu veri şifrelenmeden yazılır:");
  for (const x of ihlal) console.error("  " + x);
  console.error("api.ts'teki `yazJ` / yazim/index.ts'teki `yaz` üzerinden geç, ya da izin listesine GEREKÇESİYLE ekle.");
  process.exit(1);
}
console.log("[yazım] Gövdeli tüm istekler boru hattından geçiyor ✓");
