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

/** `tablo`: aşama 6'da zarfın AAD'si olacak (şifreli zarf başka bir tabloya taşınırsa açılmasın). */
function zarfKur(_tablo: ZarfliTablo, alanlar: Satir): string {
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

/** Yol → zarflı tablo, JENERİK rotalar için (tek tablo, yan etkisiz ya da yan etkisi hassas olmayan). */
const ROTA: Record<string, ZarfliTablo> = {
  categories: "categories", portfolios: "portfolios", oneoffs: "oneoffs", loans: "loans",
  cards: "cards", cardtxs: "card_txs", accounts: "accounts", recurring: "recurring",
};

/** Boru hattındaki bir kural ihlali (eskiden sunucunun 400'üydü). `yaz()` bunu 400 yanıtına
    çevirir: formlar, asistan ve otomatik gerçekleştirme istemci reddini sunucu reddinden AYIRT
    ETMEZ — kural nerede uygulanırsa uygulansın kullanıcı aynı hatayı görür. */
export class ZarfHatasi extends Error {}
const sayi = (v: unknown) => Number(v);
const bos = (v: unknown) => v === undefined || v === null || v === "";

/** Tablonun hassas alanlarını gövdeden ayırır; kısmi PUT'ta eksikleri mevcut satırdan tamamlar. */
function ayir(tablo: ZarfliTablo, body: Satir, data: AllData | null, id?: number): { duz: Satir; hassas: Satir | null } {
  const alanlar = ZARF[tablo] as readonly string[];
  const hassas: Satir = {}, duz: Satir = {};
  for (const [k, v] of Object.entries(body)) (alanlar.includes(k) ? hassas : duz)[k] = v;
  if (!Object.keys(hassas).length) return { duz, hassas: null };
  if (id !== undefined) {
    const mevcut = ((data as any)?.[tablo] as Satir[] | undefined)?.find((r) => r.id === id);
    if (!mevcut) throw new ZarfHatasi(`${tablo} #${id} bulunamadı — kısmi güncellemede zarf yeniden kurulamaz`);
    for (const a of alanlar) if (!(a in hassas)) hassas[a] = mevcut[a] ?? null;
  } else {
    for (const a of alanlar) if (!(a in hassas)) hassas[a] = null;
  }
  return { duz, hassas };
}

/* ————— Defter hareketi —————
   Sunucu eskiden hareketi (`account_entries`) kendisi kuruyordu: tutar + not. İkisi de
   hassas (bakiye, işyeri adı) — artık istemci kurar, sunucu yalnız yazar. NOTLAR sunucunun
   ürettiklerinin BİREBİR aynısı (hesap hareketleri ekranı onları gösteriyor). Tutar 0 ise
   hareket yazılmaz (sunucudaki "0 tutar defteri kirletmez" kuralı). */
const hareket = (amount: number, note: string): string | undefined =>
  amount ? zarfKur("account_entries", { amount, note }) : undefined;
const hesapAdi = (data: AllData | null, id: unknown) =>
  (data?.accounts.find((a) => a.id === Number(id)) as any)?.name ?? "";

type Isleyici = { method: string; yol: RegExp; fn: (m: RegExpMatchArray, b: Satir, d: AllData | null) => Satir };

/** Yan etkili uçlar: kaydın zarfı + onun doğurduğu defter hareketlerinin zarfları. */
const OZEL: Isleyici[] = [
  { method: "POST", yol: /^\/accounts$/, fn: (_, b) => {
    const { balance, name, ...kalan } = b;
    return { ...kalan, enc: zarfKur("accounts", { name, last_recon_balance: null }), entry_enc: hareket(sayi(balance ?? 0), "Açılış bakiyesi") };
  } },
  /* Mutabakat: hesabın zarfı gerçek bakiyeyle yeniden kurulur (sunucu zarfa alan ekleyemez). */
  { method: "POST", yol: /^\/accounts\/(\d+)\/reconcile$/, fn: (m, b, d) => {
    const { balance, diff, note, ...kalan } = b;
    const { hassas } = ayir("accounts", { last_recon_balance: sayi(balance) }, d, Number(m[1]));
    const not = note ? `Mutabakat: ${String(note).slice(0, 120)}` : "Mutabakat farkı";
    return { ...kalan, enc: zarfKur("accounts", hassas!), entry_enc: hareket(sayi(diff), not) };
  } },
  /* Virman: TEK kayıt, İKİ hareket. Not verilmemişse karşı hesabın adı (sunucudaki "→ X" / "← Y"). */
  { method: "*", yol: /^\/transfers(?:\/(\d+))?$/, fn: (_, b, d) => {
    const { amount, note, ...kalan } = b;
    const tutar = sayi(amount);
    if (!(tutar > 0)) throw new ZarfHatasi("tutar 0'dan büyük olmalı");
    const n = note ? String(note).slice(0, 200) : null;
    return {
      ...kalan, enc: zarfKur("transfers", { amount: tutar, note: n }),
      entry_from_enc: hareket(-tutar, n ?? `→ ${hesapAdi(d, b.to_account_id)}`),
      entry_to_enc: hareket(tutar, n ?? `← ${hesapAdi(d, b.from_account_id)}`),
    };
  } },
  /* Düzenli kalem: ad kalemin zarfında, ilk tutar zaman çizelgesinin zarfında. */
  { method: "POST", yol: /^\/recurring$/, fn: (_, b) => {
    const { name, amount, ...kalan } = b;
    if (!(sayi(amount) > 0)) throw new ZarfHatasi("tutar 0'dan büyük olmalı");
    return { ...kalan, enc: zarfKur("recurring", { name }), amount_enc: zarfKur("recurring_amounts", { amount: sayi(amount) }) };
  } },
  { method: "POST", yol: /^\/recurring\/(\d+)\/amount$/, fn: (_, b) => {
    const { amount, ...kalan } = b;
    if (!(sayi(amount) > 0)) throw new ZarfHatasi("tutar 0'dan büyük olmalı");
    return { ...kalan, enc: zarfKur("recurring_amounts", { amount: sayi(amount) }) };
  } },
  /* Gerçekleştirme: sunucu kaydı kalemden KURUYORDU (ad + o ayın tutarı). Dal ayrımı
     sunucudakiyle aynı: karta düşen gider → kart harcaması, gerisi → işlem + hareket. */
  { method: "POST", yol: /^\/recurring\/(\d+)\/realize$/, fn: (m, b, d) => {
    const r = d?.recurring.find((x) => x.id === Number(m[1]));
    if (!r) throw new ZarfHatasi("kalem bulunamadı");
    if (bos(b.amount)) throw new ZarfHatasi("tutar gerekli (o ay için tanımlı tutar yoksa gerçekleştirilemez)");
    const { amount, ...kalan } = b;
    const tutar = sayi(amount);
    const kart = r.card_id != null && r.kind === "expense";
    return {
      ...kalan,
      kayit_enc: kart ? zarfKur("card_txs", { name: r.name, amount: tutar, installments: 1 }) : zarfKur("transactions", { name: r.name, amount: tutar }),
      entry_enc: kart ? undefined : hareket(tutar, r.name),
    };
  } },
  /* Portföy işlemi: adet/fiyat/komisyon zarfta; hesap etkisi (tutar.ts'in hesapladığı) hareketin zarfında. */
  { method: "*", yol: /^\/trades(?:\/(\d+))?$/, fn: (m, b, d) => {
    const { entry_amount, ...govde } = b;
    const { duz, hassas } = ayir("trades", govde, d, m[1] ? Number(m[1]) : undefined);
    /* Eskiden sunucunun `validateSide`'ıydı; adet ve fiyat zarfa girince sunucu göremez oldu.
       Formlar bunu zaten denetliyor ama ASİSTAN denetlemiyordu — sunucunun reddi onu koruyordu.
       Kural burada, yani her yazma yolu için hâlâ geçerli. */
    if (hassas) {
      const qty = sayi(hassas.qty), price = sayi(hassas.price);
      if (!Number.isFinite(qty) || qty <= 0) throw new ZarfHatasi("adet 0'dan büyük olmalı");
      if (!Number.isFinite(price) || price < 0) throw new ZarfHatasi("geçersiz fiyat");
      if (b.side === "BEDELSİZ" && price !== 0) throw new ZarfHatasi("bedelsizde birim fiyat 0 olmalı");
      if (b.side !== "BEDELSİZ" && !(price > 0)) throw new ZarfHatasi("birim fiyat 0'dan büyük olmalı");
      hassas.fee = sayi(hassas.fee ?? 0) || 0;
    }
    return { ...duz, ...(hassas ? { enc: zarfKur("trades", hassas) } : {}),
      entry_enc: bos(entry_amount) ? undefined : hareket(sayi(entry_amount), `${b.symbol} ${b.side}`) };
  } },
  { method: "*", yol: /^\/deposits(?:\/(\d+))?$/, fn: (m, b, d) => {
    const { entry_amount, ...govde } = b;
    const { duz, hassas } = ayir("deposits", govde, d, m[1] ? Number(m[1]) : undefined);
    /* Eskiden sunucudaki değer kuralları — alanlar zarfa girince buraya taşındı. */
    if (hassas) {
      const principal = sayi(hassas.principal), rate = sayi(hassas.rate), gun = Math.trunc(sayi(hassas.term_days));
      const stopaj = sayi(hassas.withholding ?? 0);
      if (!(principal > 0) || !(gun >= 1) || !(rate >= 0) || !(stopaj >= 0 && stopaj <= 100)) throw new ZarfHatasi("geçersiz değer");
      Object.assign(hassas, { principal, rate, term_days: gun, withholding: stopaj });
    }
    return { ...duz, ...(hassas ? { enc: zarfKur("deposits", hassas) } : {}),
      entry_enc: bos(entry_amount) ? undefined : hareket(sayi(entry_amount), `${hassas?.name ?? ""} (vadeli açılış)`) };
  } },
  /* Ekstre ödemesi: sunucu "X ekstresi" adlı bir gider kuruyordu. */
  { method: "POST", yol: /^\/cards\/(\d+)\/pay-statement$/, fn: (m, b, d) => {
    const card = d?.cards.find((c) => c.id === Number(m[1]));
    if (!card) throw new ZarfHatasi("kart bulunamadı");
    if (bos(b.amount)) throw new ZarfHatasi("ekstre tutarı hesaplanamadı");
    const { amount, ...kalan } = b;
    if (!(sayi(amount) > 0)) throw new ZarfHatasi("bu tarihte ekstre yok");
    const ad = `${card.name} ekstresi`, tutar = -sayi(amount);
    return { ...kalan, kayit_enc: zarfKur("transactions", { name: ad, amount: tutar }), entry_enc: hareket(tutar, ad) };
  } },
  /* Gerçekleşen işlem: hesaba bağlıysa hareketi (not = işlemin adı). */
  { method: "*", yol: /^\/transactions(?:\/(\d+))?$/, fn: (m, b, d) => {
    const { duz, hassas } = ayir("transactions", b, d, m[1] ? Number(m[1]) : undefined);
    if (!hassas) return b;
    return { ...duz, enc: zarfKur("transactions", hassas), entry_enc: hareket(sayi(hassas.amount), String(hassas.name ?? "")) };
  } },
  { method: "POST", yol: /^\/transactions\/bulk$/, fn: (_, b) => ({
    rows: (b.rows as Satir[]).map((r) => {
      const { name, amount, ...kalan } = r;
      return { ...kalan, enc: zarfKur("transactions", { name, amount }), entry_enc: hareket(sayi(amount), String(name ?? "")) };
    }),
  }) },
];

/** Gövdenin hassas alanlarını zarfa taşır. `data`: kısmi güncellemede eksik alanların ve
    kayıttan türetilen adların (kalem adı, kart adı, hesap adı) kaynağı. */
/* ————— Asistan deposu (aşama 5d) —————
   Sunucu bu metinleri artık GÖRMÜYOR, yani eskiden orada yapılan kırpma ve biçim
   doğrulaması buraya taşındı (sınırlar birebir aynı: kullanıcı mesajı 4.000, asistan
   8.000, başlık 120 karakter, plan 1–12 satır). */
export const baslikTemizle = (t: unknown): string => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

const AI: Isleyici[] = [
  { method: "PUT", yol: /^\/ai\/conversations\/(\d+)$/, fn: (_, b) => {
    const title = baslikTemizle(b.title);
    if (!title) throw new ZarfHatasi("başlık boş olamaz");
    return { enc: zarfKur("ai_conversations", { title }) };
  } },
  { method: "POST", yol: /^\/ai\/messages$/, fn: (_, b) => {
    const { content, title, ...kalan } = b;
    const metin = typeof content === "string" ? content.trim().slice(0, b.role === "user" ? 4000 : 8000) : "";
    if (!metin) throw new ZarfHatasi("mesaj yok");
    /* Başlık yalnız YENİ konuşmada gider; verilmemişse "Yeni sohbet" (sunucu eskiden
       içerikten türetiyordu — artık içeriği göremiyor, türetme çağıranın işi). */
    const baslik = kalan.conversationId == null ? baslikTemizle(title) || "Yeni sohbet" : null;
    return {
      ...kalan, enc: zarfKur("ai_messages", { content: metin }),
      ...(baslik ? { title_enc: zarfKur("ai_conversations", { title: baslik }) } : {}),
    };
  } },
  { method: "POST", yol: /^\/ai\/plans$/, fn: (_, b) => {
    const { actions, ...kalan } = b;
    if (!Array.isArray(actions) || !actions.length || actions.length > 12) throw new ZarfHatasi("geçersiz plan");
    if (!actions.every((a: any) => typeof a?.tool === "string" && a.args && typeof a.args === "object" && typeof a.summary === "string"))
      throw new ZarfHatasi("geçersiz plan satırı");
    return { ...kalan, enc: zarfKur("ai_plans", { actions }) };
  } },
  /* Günlük satırı: araç adı ve geri alma yolu (tür + id) düz, özet ("Migros 450 TL") zarfta. */
  { method: "POST", yol: /^\/ai\/plans\/[^/]+\/actions$/, fn: (_, b) => {
    const items = Array.isArray(b.items) ? b.items : [];
    return { items: items.map(({ summary, ...x }: Satir) => ({ ...x, enc: zarfKur("ai_actions", { summary: String(summary ?? "") }) })) };
  } },
];

/** Planın işlemleri. Göçle zarfa taşınan eski satırlarda `actions` bir JSON METNİDİR (kolon
    text'ti), yeni yazılanlarda dizi — ikisi de aynı listeye açılır. */
export const planIslemleri = (v: unknown): any[] => (typeof v === "string" ? JSON.parse(v) : Array.isArray(v) ? v : []);

export function zarfla(method: string, path: string, body: Satir, data: AllData | null): Satir {
  if (method !== "POST" && method !== "PUT") return body;
  for (const o of [...OZEL, ...AI]) {
    if (o.method !== "*" && o.method !== method) continue;
    const m = path.match(o.yol);
    if (m) return o.fn(m, body, data);
  }
  const m = path.match(/^\/([a-z_]+)(?:\/(\d+))?$/);
  if (!m) return body;
  const tablo = ROTA[m[1]];
  if (!tablo) return body;
  const { duz, hassas } = ayir(tablo, body, data, method === "PUT" && m[2] ? Number(m[2]) : undefined);
  return hassas ? { ...duz, enc: zarfKur(tablo, hassas) } : body;
}
