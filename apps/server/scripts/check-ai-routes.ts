/* ============================================================================
   Asistan ↔ API senkron kapısı (Faz 22)
   ----------------------------------------------------------------------------
   `pnpm build`in parçasıdır. index.ts + ai/index.ts içindeki TÜM /api yazma
   rotalarını (POST/PUT/DELETE, `crud()` fabrikasının ürettikleri dahil) çıkarır
   ve her birinin ya `ai/tools.ts` içinde bir aracı ya da `SKIPPED` içinde
   gerekçesi olmasını şart koşar. İki yönlü çalışır:
     - Yeni/değişen uç tanıtılmamışsa  → build durur ("karar ver").
     - Silinmiş/yeniden adlandırılmış uca ait araç/gerekçe kalmışsa → build durur.
   Asistanın API bilgisi böylece dokümana değil, derleme kapısına bağlıdır. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROUTE_TOOLS, SKIPPED } from "../ai/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const sources = ["../index.ts", "../ai/index.ts"].map((p) => readFileSync(join(here, p), "utf8"));

const routes = new Set<string>();
for (const src of sources) {
  for (const m of src.matchAll(/\bapi\.(post|put|delete)\(\s*[`"']([^`"']+)[`"']/g)) {
    if (m[2].includes("${")) continue; // crud() fabrikasının kendi şablon yolu — aşağıda genişletiliyor
    routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  /* crud("route", "table", [...]) üç uç üretir — fabrika çağrısını da genişlet */
  for (const m of src.matchAll(/\bcrud\(\s*["']([^"']+)["']/g)) {
    routes.add(`POST /${m[1]}`);
    routes.add(`PUT /${m[1]}/:id`);
    routes.add(`DELETE /${m[1]}/:id`);
  }
}

const covered = new Map<string, string>();
for (const t of ROUTE_TOOLS) covered.set(`${t.method} ${t.path}`, `araç: ${t.name}`);
for (const s of SKIPPED) {
  if (covered.has(s.route)) fail(`'${s.route}' hem araç hem SKIPPED listesinde — ikisinden birini kaldır.`);
  covered.set(s.route, `atlandı: ${s.reason}`);
}

const problems: string[] = [];
for (const r of [...routes].sort()) {
  if (!covered.has(r)) problems.push(`  EKSİK   ${r}\n          → ai/tools.ts'e araç ekle ya da SKIPPED'e gerekçesiyle yaz.`);
}
for (const [r, how] of [...covered].sort()) {
  if (!routes.has(r)) problems.push(`  ARTIK   ${r} (${how})\n          → böyle bir uç yok; aracı/gerekçeyi güncelle ya da sil.`);
}

if (problems.length) {
  console.error(`\n[ai] Asistan araç kaydı API ile uyuşmuyor (${problems.length} sorun):\n${problems.join("\n")}\n`);
  process.exit(1);
}
console.log(`[ai] Araç kaydı güncel: ${routes.size} yazma ucu (${ROUTE_TOOLS.length} araç, ${SKIPPED.length} bilinçli atlama).`);

function fail(msg: string): never {
  console.error(`\n[ai] ${msg}\n`);
  process.exit(1);
}
