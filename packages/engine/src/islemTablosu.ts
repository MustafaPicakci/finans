/* ————— ARACI KURUM EKSTRESİ: İŞLEM TABLOSU (Faz 45.9) —————
   Aracı kurum ekstresindeki alım-satım satırlarını portföy işlemine (`trades`) çevirir. Banka
   dökümünden farkı: bir satırda TEK tutar yoktur — sembol, yön, adet, fiyat, ücret ayrı sütunlardır;
   "tutar = son sayı" gibi bir kural anlamsızdır. Bu yüzden sütunlar BAŞLIK SÖZCÜKLERİNDEN bulunur
   (sembol/kıymet/araç, adet/miktar/lot, fiyat, ücret/komisyon). Bu bir kurumun düzeni değil,
   aracı kurum ekstrelerinin ortak dilidir — bankaya özel şablon yok ilkesi burada da geçerli.
   Yön hücre DEĞERİNDEN okunur (alış/satış/alım/satım/buy/sell), çünkü yön sütununun başlığı
   kurumdan kuruma değişir ("İşlem Tipi", "Yön", "A/S") ama değerleri değişmez.

   Aynı belgede bir PORTFÖY ÖZETİ tablosu varsa (sembol + adet, tarih ve fiyat yok) o da okunur:
   dönem sonundaki adet, uygulamadaki adetle karşılaştırılır — belgenin kendini doğrulaması
   (banka dökümündeki bakiye zinciri gibi, bkz. statement.ts `dogrulama`).

   Saf fonksiyon, testli. Kayıt YAZMAZ. */

import { metinSadelestir } from "./kayitlar.js";
import { parseAmount, parseDate } from "./statement.js";
import type { KonumluSatir } from "./pdfSatir.js";
import type { Currency, Trade } from "./types.js";
import { qtyDelta } from "./portfolio.js";

export type AyrisanIslem = {
  date: string; symbol: string; side: "ALIŞ" | "SATIŞ"; qty: number; price: number; fee: number; currency: Currency;
  /** satırda "fon" geçiyor (ör. "Fon Emri") — varlık türü tahmini için ipucu, karar değil */
  fonIpucu: boolean;
};
export type OzetSatiri = { symbol: string; qty: number };
/** `ozetTarih`: portföy özetinin "itibarıyla" tarihi (başlığındaki tarih, "PORTFÖY ÖZETİ (31/08/26)");
    özet o günün adedidir — sonraki işlemler karşılaştırmaya girmemeli. Bulunamazsa null. */
export type IslemSonucu = { islemler: AyrisanIslem[]; ozet: OzetSatiri[]; ozetTarih: string | null; skipped: string[] };

type H = { s: string; x: [number, number] | null };
type Rol = "tarih" | "sembol" | "adet" | "fiyat" | "ucret" | "para";

const ROL: Record<Rol, RegExp> = {
  tarih: /tarih/,
  sembol: /sembol|kiymet|menkul|hisse kodu|varlik|enstruman|arac|kod/,
  adet: /adet|miktar|lot|nominal/,
  fiyat: /fiyat/,
  ucret: /ucret|komisyon|masraf/,
  para: /para birimi|doviz cinsi|currency/,
};
/** Aynı rol için birden çok sütun varsa tercih edilen (ör. "Emir Adedi" değil "Gerçekleşen Adet") */
const TERCIH: Partial<Record<Rol, RegExp>> = { adet: /gerceklesen|gercek/, fiyat: /ortalama|gerceklesen|islem fiyat/ };
const KACIN: Partial<Record<Rol, RegExp>> = { adet: /emir/, fiyat: /emir|maliyet/ };

/** Başlık hücresi → rolü (yoksa null). "Hisse Başı Ortalama Maliyet" fiyat DEĞİLDİR (maliyet). */
function rolu(hucre: string): Rol | null {
  const t = metinSadelestir(hucre);
  for (const r of ["tarih", "fiyat", "ucret", "para", "adet", "sembol"] as Rol[]) if (ROL[r].test(t)) return r;
  return null;
}

type Baslik = { tur: "islem" | "ozet"; sutun: Partial<Record<Rol, number>>; hucreler: H[] };

/** Satır bir tablo başlığı mı: en az iki hücresi bir role karşılık gelir ve hiç sayı yoktur. */
function baslikMi(h: H[]): Baslik | null | "baska" {
  if (h.some((c) => parseAmount(c.s) !== null && !/[a-zçğıöşü]/i.test(c.s))) return null;
  const roller = h.map((c) => rolu(c.s));
  if (roller.filter(Boolean).length < 2) return null;
  const sutun: Partial<Record<Rol, number>> = {};
  roller.forEach((r, i) => {
    if (!r) return;
    const once = sutun[r];
    if (once === undefined) { sutun[r] = i; return; }
    const t = metinSadelestir(h[i].s), o = metinSadelestir(h[once].s);
    const iyi = (s: string) => (TERCIH[r]?.test(s) ? 1 : 0) - (KACIN[r]?.test(s) ? 1 : 0);
    if (iyi(t) > iyi(o)) sutun[r] = i;
  });
  if (sutun.sembol !== undefined && sutun.adet !== undefined && sutun.fiyat !== undefined && sutun.tarih !== undefined) return { tur: "islem", sutun, hucreler: h };
  if (sutun.sembol !== undefined && sutun.adet !== undefined && sutun.fiyat === undefined && sutun.tarih === undefined) return { tur: "ozet", sutun, hucreler: h };
  return "baska"; // başka bir tablonun başlığı (ör. hesap hareketleri): etkin tablo biter
}

/** Başlıktaki bir sütuna karşılık gelen veri hücresi: konum varsa merkezi en yakın hücre, yoksa aynı sıradaki. */
function hucreBul(b: Baslik, satir: H[], rol: Rol): string | null {
  const i = b.sutun[rol];
  if (i === undefined) return null;
  const bh = b.hucreler[i];
  if (bh.x && satir.every((c) => c.x)) {
    const merkez = (x: [number, number]) => (x[0] + x[1]) / 2;
    const m = merkez(bh.x);
    // yalnız o sütunun komşularından daha yakın olan hücre (başka sütunun değerini almasın)
    const komsuMesafe = Math.min(...b.hucreler.filter((_, k) => k !== i && b.hucreler[k].x).map((c) => Math.abs(merkez(c.x!) - m)), Infinity);
    let en: H | null = null, enD = Infinity;
    for (const c of satir) { const d = Math.abs(merkez(c.x!) - m); if (d < enD) { en = c; enD = d; } }
    return en && enD < komsuMesafe / 2 + 1 ? en.s : null;
  }
  return satir[i]?.s ?? null;
}

/** "31/07/26 10:25:24" → "2026-07-31" (işlem tablosunda saatli tarih yaygındır) */
const tarihOku = (s: string | null) => (s ? parseDate(s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "")) : null);
/** "KHA - Pardus Portföy..." → "KHA"; "QUICK" → "QUICK" */
const sembolOku = (s: string | null) => {
  const m = s?.trim().match(/^([A-Z0-9][A-Z0-9.]{1,11})(?:\s|$|\s*-)/);
  return m ? m[1] : null;
};
const YON: [RegExp, "ALIŞ" | "SATIŞ"][] = [[/^(alis|alim|al|buy|a)$/, "ALIŞ"], [/^(satis|satim|sat|sell|s)$/, "SATIŞ"]];
const GERCEKLESMEDI = /iptal|reddedil|gerceklesmedi|beklemede|bekliyor/;

export function parseIslemler(girdi: string | KonumluSatir[]): IslemSonucu {
  const satirlar: H[][] = typeof girdi === "string"
    ? girdi.split(/\r?\n/).map((l) => l.split(/\t| {2,}/).map((s) => s.trim()).filter(Boolean).map((s) => ({ s, x: null })))
    : girdi.map((satir) => satir.map((h) => ({ s: h.s, x: [h.x0, h.x1] as [number, number] })));
  const islemler: AyrisanIslem[] = [], ozet: OzetSatiri[] = [], skipped: string[] = [];
  let etkin: Baslik | null = null;
  let ozetTarih: string | null = null;
  for (const h of satirlar) {
    if (!h.length) continue;
    /* Özetin tarihi kendi başlık satırındadır ("PORTFÖY ÖZETİ (31/08/26)"); tek tarih taşıyan satır
       aranır — dönem başlığı ("… (01/08/26 - 31/08/26)") iki tarih taşır, onun SON tarihi alınır. */
    if (/ozet/.test(metinSadelestir(h.map((c) => c.s).join(" ")))) {
      const t = [...h.map((c) => c.s).join(" ").matchAll(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g)].map((m) => parseDate(m[0])).filter(Boolean);
      if (t.length) ozetTarih = t[t.length - 1]!;
    }
    const b = baslikMi(h);
    if (b) { etkin = b === "baska" ? null : b; continue; }
    if (!etkin) continue;
    const metin = h.map((c) => c.s).join(" ");
    if (etkin.tur === "ozet") {
      const symbol = sembolOku(hucreBul(etkin, h, "sembol")), qty = parseAmount(hucreBul(etkin, h, "adet") ?? "");
      if (symbol && qty != null) ozet.push({ symbol, qty });
      continue;
    }
    const date = tarihOku(hucreBul(etkin, h, "tarih"));
    const symbol = sembolOku(hucreBul(etkin, h, "sembol"));
    const qty = parseAmount(hucreBul(etkin, h, "adet") ?? "");
    const price = parseAmount(hucreBul(etkin, h, "fiyat") ?? "");
    const yon = h.map((c) => metinSadelestir(c.s)).map((t) => YON.find(([re]) => re.test(t))?.[1]).find(Boolean);
    if (!date || !symbol || qty == null || price == null || !yon || GERCEKLESMEDI.test(metinSadelestir(metin)) || !(qty > 0) || !(price > 0)) {
      skipped.push(metin); continue;
    }
    const fee = Math.abs(parseAmount(hucreBul(etkin, h, "ucret") ?? "") ?? 0);
    const para = (hucreBul(etkin, h, "para") ?? metin).toUpperCase();
    islemler.push({ date, symbol, side: yon, qty, price, fee, currency: /\bUSD\b/.test(para) ? "USD" : "TRY", fonIpucu: /\bfon\b/.test(metinSadelestir(metin)) });
  }
  return { islemler, ozet, ozetTarih: ozet.length ? ozetTarih : null, skipped };
}

/** Uygulamada zaten var mı: aynı sembol, yön ve adet, en fazla ±1 gün (emir gece geçebilir) — fiyat da
    aynıysa (%0,5) ±5 gün: kullanıcı işlemi emir günü yerine takas/valör gününe girmiş olabilir (gerçek
    ekstrede Cuma 31.07 alışı uygulamada Pazartesi 03.08'deydi; aynı adet, aynı fiyat — ±1 günlük kural
    onu "eksik" sayıp ikinci kez yazdıracaktı). Eşleşme birebirdir (aynı gün aynı adetle iki alım iki
    ayrı işlemdir); önce en yakın gün aranır. */
export function islemKarsilastir(islemler: AyrisanIslem[], trades: Trade[]): ("eksik" | "eslesti")[] {
  const kullanildi = new Set<number>();
  const gun = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  return islemler.map((r) => {
    const uyar = (t: Trade, k: number) => !kullanildi.has(k) && t.symbol === r.symbol && t.side === r.side && Math.abs(t.qty - r.qty) < 1e-9;
    const ayniFiyat = (t: Trade) => r.price > 0 && Math.abs(t.price - r.price) / r.price < 0.005;
    let j = trades.findIndex((t, k) => uyar(t, k) && gun(t.date, r.date) <= 1);
    if (j < 0) j = trades.findIndex((t, k) => uyar(t, k) && ayniFiyat(t) && gun(t.date, r.date) <= 5);
    if (j < 0) return "eksik";
    kullanildi.add(j);
    return "eslesti";
  });
}

/** Portföy özeti doğrulaması: belgenin dönem sonu adedi ile uygulamadaki adet, özet TARİHİ itibarıyla.
    Çağıran kullanıcının TÜM işlemlerini + eklenecekleri verir — hesaba göre SÜZÜLMEZ: işlemin hesabı
    parasının nereden ödendiğidir, varlığın nerede saklandığı değil (gerçek veride Midas'taki 3245 MAC
    = 464 hesapsız + 2781 Garanti'den ödenmiş; hesapla süzmek "uygulama 0" diye yanlış alarm veriyordu).
    Yalnız tutmayanlar döner. */
export function ozetKarsilastir(ozet: OzetSatiri[], trades: Pick<Trade, "symbol" | "side" | "qty" | "date">[], tarih: string | null = null): { symbol: string; belge: number; uygulama: number }[] {
  const adet = new Map<string, number>();
  // özet tarihinden SONRAKİ işlem sayılmaz (gerçek ekstrede: 31.08 özetinde 2072 PHE, satışı 07.09'da)
  for (const t of trades) if (!tarih || t.date <= tarih) adet.set(t.symbol, (adet.get(t.symbol) ?? 0) + qtyDelta(t));
  return ozet
    .map((o) => ({ symbol: o.symbol, belge: o.qty, uygulama: Math.round((adet.get(o.symbol) ?? 0) * 1e6) / 1e6 }))
    .filter((o) => Math.abs(o.belge - o.uygulama) > 1e-6);
}
