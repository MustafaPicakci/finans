/* ============================================================================
   Zarf codec'i — hassas kolonlar tek bir `enc` alanında (E2EE aşama 5)
   ----------------------------------------------------------------------------
   OKUMA: `/api/all` satırları `enc` taşır; burada açılıp alanlar satıra geri yerleştirilir.
   Uygulamanın geri kalanı `t.amount`, `c.name` görmeye DEVAM EDER — zarf yalnız bu
   dosyanın ve sunucunun bildiği bir şeydir, yani ekranların hiçbiri değişmez.

   YAZMA: gövdenin hassas alanları `enc`e taşınır. Kısmi güncellemede (örn. yalnız ad
   değişiyor) zarf BÜTÜN olarak yeniden kurulur: sunucu şifreli bir zarfın içine alan
   ekleyemez, yani eksik alanlar mevcut satırdan tamamlanır.

   Biçim şimdilik `p1:` — DÜZ METİN zarf. Tesisat şifrelemeden ÖNCE uçtan uca çalışsın ve
   psql ile okunabilsin diye. Aşama 6'da `zarfla`/`zarfAc` AES-GCM (`v1:`) kullanacak;
   çağıranlar değişmez. */

import { ZARF, SIRA, ZARF_DUZ, type ZarfliTablo } from "@finans/crypto/map";
import type { AllData } from "@finans/engine";

type Satir = Record<string, unknown>;

function zarfKur(alanlar: Satir): string {
  return ZARF_DUZ + JSON.stringify(alanlar);
}

/** Bir satırın zarfını açar ve alanları satıra yerleştirir. Zarfsız satır (göç öncesi
    sunucu, eski PWA önbelleği) olduğu gibi döner. Bilinmeyen biçim SESSİZCE yutulmaz. */
export function zarfAc(satir: Satir): Satir {
  const enc = satir.enc;
  if (typeof enc !== "string") return satir;
  const { enc: _, ...kalan } = satir;
  if (enc.startsWith(ZARF_DUZ)) return { ...kalan, ...JSON.parse(enc.slice(ZARF_DUZ.length)) };
  throw new Error(`tanınmayan zarf biçimi: ${enc.slice(0, 4)}`);
}

/** `/api/all` yanıtındaki tüm zarflı tabloları açar ve sunucunun artık yapamadığı sıralamayı kurar. */
export function veriAc(d: AllData): AllData {
  const out: any = { ...d };
  for (const tablo of Object.keys(ZARF) as ZarfliTablo[]) {
    const satirlar = (d as any)[tablo];
    if (!Array.isArray(satirlar)) continue;
    let acik = satirlar.map(zarfAc);
    const alan = SIRA[tablo];
    if (alan) acik = [...acik].sort((a, b) => String(a[alan] ?? "").localeCompare(String(b[alan] ?? ""), "tr"));
    out[tablo] = acik;
  }
  return out as AllData;
}

/** Yol → zarflı tablo. Yalnız jenerik CRUD rotaları; özel uçlar (ödeme, gerçekleştirme…) ayrı ele alınır. */
const ROTA: Record<string, ZarfliTablo> = {
  categories: "categories", portfolios: "portfolios", oneoffs: "oneoffs", loans: "loans",
};

/** Gövdenin hassas alanlarını zarfa taşır. `data`: kısmi güncellemede eksik alanların kaynağı. */
export function zarfla(method: string, path: string, body: Satir, data: AllData | null): Satir {
  if (method !== "POST" && method !== "PUT") return body;
  const m = path.match(/^\/([a-z_]+)(?:\/(\d+))?$/);
  if (!m) return body;
  const tablo = ROTA[m[1]];
  if (!tablo) return body;
  const alanlar = ZARF[tablo] as readonly string[];
  const hassas: Satir = {}, duz: Satir = {};
  for (const [k, v] of Object.entries(body)) (alanlar.includes(k) ? hassas : duz)[k] = v;
  if (!Object.keys(hassas).length) return body; // örn. yalnız kategori rengi değişiyor → zarfa dokunma
  if (method === "PUT") {
    const id = Number(m[2]);
    const mevcut = ((data as any)?.[tablo] as Satir[] | undefined)?.find((r) => r.id === id);
    if (!mevcut) throw new Error(`${tablo} #${id} bulunamadı — kısmi güncellemede zarf yeniden kurulamaz`);
    for (const a of alanlar) if (!(a in hassas)) hassas[a] = mevcut[a] ?? null;
  } else {
    for (const a of alanlar) if (!(a in hassas)) hassas[a] = null;
  }
  return { ...duz, enc: zarfKur(hassas) };
}
