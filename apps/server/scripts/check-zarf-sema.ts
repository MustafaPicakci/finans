/* ============================================================================
   Derleme kapısı: zarfa taşınmış bir kolon şemaya GERİ EKLENEMEZ (E2EE aşama 5)
   ----------------------------------------------------------------------------
   initDb her açılışta `ALTER TABLE x ADD COLUMN IF NOT EXISTS y` satırlarını çalıştırır.
   `y` zarfa taşınmış (alan haritasında) bir kolonsa, göç onu düşürdükten sonra bu satır
   onu her açılışta BOŞ olarak geri ekler. Göçün birleştirmesi artık yıkıcı değil ama bu
   hâlâ bir hatadır: kolon düş-ekle döngüsüne girer ve niyeti belirsizleşir. Somut örnek
   hazırda bekliyordu: `accounts.last_recon_balance` — accounts zarfa girdiği gün
   mutabakat bakiyesi her yeniden başlatmada ezilirdi (birleştirme yıkıcıyken).

   Ayrıca alan haritasındaki her tablonun sınıflandırması TAM olmalı: CREATE TABLE'daki her
   kolon ya zarfta ya DUZ'de (gerekçesiyle) ya da ortak kolonlardan biri. Sınıflandırılmamış
   yeni bir kolon — "kolon ekledim, şifrelemeyi unuttum" — derlemede durur. */
import { readFileSync } from "node:fs";
import { ZARF, DUZ, ORTAK_DUZ } from "@finans/crypto/map";

const db = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
const hatalar: string[] = [];

for (const m of db.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)) {
  const [, tablo, kolon] = m;
  if ((ZARF as Record<string, readonly string[]>)[tablo]?.includes(kolon))
    hatalar.push(`GERİ EKLEME  ${tablo}.${kolon} zarfta ama db.ts onu ADD COLUMN ile geri ekliyor`);
}

for (const tablo of Object.keys(ZARF) as (keyof typeof ZARF)[]) {
  const cr = db.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tablo} \\(([\\s\\S]*?)\\n\\);`));
  if (!cr) { hatalar.push(`TABLO YOK    ${tablo} (haritada var, db.ts'te CREATE TABLE bulunamadı)`); continue; }
  const kolonlar = new Set<string>();
  for (const satir of cr[1].split("\n")) {
    const k = satir.trim().match(/^([a-z_]+)\s+(?:integer|text|double|boolean|int|real)/);
    if (k) kolonlar.add(k[1]);
  }
  for (const k of db.matchAll(new RegExp(`ALTER TABLE ${tablo} ADD COLUMN IF NOT EXISTS (\\w+)`, "g"))) kolonlar.add(k[1]);
  for (const k of kolonlar) {
    const siniflandi = (ZARF[tablo] as readonly string[]).includes(k) || k in DUZ[tablo] || k in ORTAK_DUZ;
    if (!siniflandi) hatalar.push(`SINIFSIZ     ${tablo}.${k} — zarfa mı girecek, düz mü kalacak? map.ts'e yaz (düzse GEREKÇESİYLE)`);
  }
  for (const k of Object.keys(DUZ[tablo])) if (!kolonlar.has(k)) hatalar.push(`ARTIK        ${tablo}.${k} map.ts DUZ'de var ama şemada yok`);
}

if (hatalar.length) {
  console.error("[zarf] Şema ile alan haritası uyuşmuyor:");
  for (const h of hatalar) console.error("  " + h);
  process.exit(1);
}
console.log(`[zarf] Şema ile alan haritası tutarlı ✓ (${Object.keys(ZARF).length} zarflı tablo)`);
