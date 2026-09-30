/* ————— DÖKÜMÜ DEFTERLE KARŞILAŞTIRMA (Faz 45.4) —————
   İçe aktarma "hepsini yaz" değil "farkı göster"dir: banka dökümü ya da kart ekstresi,
   uygulamadaki defterle karşılaştırılır ve her satır bir duruma düşer. Böylece aynı döküm hem
   ilk kurulumda hem aylar sonra EKSİKLERİ TAMAMLAMAK için kullanılabilir, zaten girilmiş kayıt
   ikinci kez yazılmaz, açılış bakiyesinin içinde sayılmış geçmiş bakiyeyi şişirmez.

   NEYLE karşılaştırılır — dikkat: hesap dökümü `transactions` ile değil hesabın DEFTERİYLE
   (`account_entries`) karşılaştırılır. Banka dökümünde hesabın BÜTÜN hareketleri vardır
   (gelir-gider, virman, ekstre ödemesi, portföy alımı, mevduat, otomatik düzenli kalem);
   yalnız `transactions`a bakılsa virman olarak zaten kayıtlı bir "Para Transferi" eksik
   görünürdü. Kart ekstresi o kartın `card_txs`'iyle karşılaştırılır.

   EŞLEŞME: aynı tutar (işaret dahil) ve en fazla ±`gun` gün fark (EFT ertesi iş günü, hafta
   sonu kayması). ADA BAKILMAZ — bankadaki "MOBIL-FAST KIRA" ile uygulamadaki "Kira" aynı
   kayıttır; ad yalnız eşit adaylar arasında sıra belirler. Eşleşme BİREBİRDİR: bütün adaylar
   (gün farkı, ad benzerliği) sırasıyla dizilip açgözlü atanır — aynı gün aynı tutarda iki
   satır varsa biri iki kez sayılmaz.

   Saf fonksiyon, testli. Kayıt YAZMAZ: sonucu arayüz gösterir, kullanıcı seçer. */

import { metinSadelestir } from "./kayitlar.js";
import type { ParsedRow } from "./statement.js";
import type { AllData } from "./types.js";

/** Karşılaştırılacak defter kaydı; `amount` hesap dilinde (gider −). `taksit` > 1 ise `amount`
    TOPLAM tutardır ve ekstrede aylık taksit olarak görünür. */
export type DefterKaydi = { kimlik: string; date: string; amount: number; name: string; taksit?: number };

/** eksik: dökümde var, defterde yok · eslesti: zaten defterde · farkli: adı ve günü tutan bir
    kayıt var ama tutarı farklı · acilis: açılış gününde/öncesinde, açılış bakiyesinin içinde
    sayılmış · odeme: kart ekstresinde karta para giren satır (ekstre ödemesi Kart sekmesinden
    "Ödedim" ile kaydedilir, burada karşılaştırılmaz). */
export type DokumDurum = "eksik" | "eslesti" | "farkli" | "acilis" | "odeme";
export type DokumSatir = { durum: DokumDurum; kayit?: DefterKaydi };
export type DokumKarsilastirma = {
  /** satırlarla aynı sıra */
  satirlar: DokumSatir[];
  /** defterde olup dökümün aralığında dökümde karşılığı olmayan kayıtlar (yanlış/çift giriş olabilir — SİLİNMEZ) */
  fazla: DefterKaydi[];
  aralik: { bas: string; son: string } | null;
};

const GUN_MS = 864e5;
const gunFarki = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / GUN_MS);
const gunEkle = (d: string, n: number) => new Date(Date.parse(d) + n * GUN_MS).toISOString().slice(0, 10);
const kelimeler = (s: string) => new Set(metinSadelestir(s).match(/[a-z0-9]{3,}/g) ?? []);
function benzerlik(a: string, b: string): number {
  const x = kelimeler(a), y = kelimeler(b);
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n;
}
function tutarUyar(r: ParsedRow, k: DefterKaydi): boolean {
  if (Math.abs(r.amount - k.amount) < 0.005) return true;
  // taksit: ekstre aylık payı gösterir; banka payı kuruşa yuvarlar (15.641,73 / 6 → 2.606,95)
  const n = k.taksit ?? 1;
  return n > 1 && Math.sign(r.amount) === Math.sign(k.amount) && Math.abs(r.amount * n - k.amount) <= 0.01 * n;
}

/** Kart ekstresinin kapsadığı dönem: son satırdan geriye bu kadar gün. Ekstre bir aylıktır ama
    eski tarihli TAKSİT satırları (ör. 12/12, alış tarihiyle yazılır) aralığı geriye çekip o
    arada girilmiş her harcamayı "fazla" gösterirdi. */
const KART_DONEM_GUN = 35;

export function dokumKarsilastir(
  rows: ParsedRow[],
  defter: DefterKaydi[],
  secenek: { kart?: boolean; acilis?: string | null; gun?: number } = {},
): DokumKarsilastirma {
  const gun = secenek.gun ?? 3;
  const satirlar: DokumSatir[] = rows.map((r) => ({ durum: secenek.kart && r.amount > 0 ? "odeme" : "eksik" }));
  const aday = rows.map((_, i) => i).filter((i) => satirlar[i].durum !== "odeme");
  if (aday.length === 0) return { satirlar, fazla: [], aralik: null };

  const tarihler = aday.map((i) => rows[i].date).sort();
  const son = tarihler[tarihler.length - 1];
  const bas = secenek.kart ? [tarihler[0], gunEkle(son, -KART_DONEM_GUN)].sort()[1] : tarihler[0];

  /** Açgözlü birebir atama: çiftler (gün farkı ↑, ad benzerliği ↓, satır sırası) dizilir. */
  const kullanildi = new Set<number>();
  const ata = (uygun: (r: ParsedRow, k: DefterKaydi) => boolean, durum: DokumDurum) => {
    const ciftler: { i: number; j: number; g: number; b: number }[] = [];
    for (const i of aday) {
      if (satirlar[i].durum !== "eksik") continue;
      for (let j = 0; j < defter.length; j++) {
        if (kullanildi.has(j)) continue;
        const g = gunFarki(rows[i].date, defter[j].date);
        if (g > gun || !uygun(rows[i], defter[j])) continue;
        ciftler.push({ i, j, g, b: benzerlik(rows[i].name, defter[j].name) });
      }
    }
    ciftler.sort((x, y) => x.g - y.g || y.b - x.b || x.i - y.i || x.j - y.j);
    for (const c of ciftler) {
      if (satirlar[c.i].durum !== "eksik" || kullanildi.has(c.j)) continue;
      satirlar[c.i] = { durum, kayit: defter[c.j] };
      kullanildi.add(c.j);
    }
  };
  ata(tutarUyar, "eslesti");
  // Açılışın içinde kalan satır "farklı" diye eşlenmez: açılıştan önce defterde karşılığı olmaması beklenir.
  for (const i of aday) if (satirlar[i].durum === "eksik" && secenek.acilis && rows[i].date <= secenek.acilis) satirlar[i] = { durum: "acilis" };
  ata((r, k) => Math.sign(r.amount) === Math.sign(k.amount) && benzerlik(r.name, k.name) > 0, "farkli");

  const fazla = defter.filter((k, j) => !kullanildi.has(j) && k.date >= bas && k.date <= son);
  return { satirlar, fazla, aralik: { bas, son } };
}

/** Hesabın defteri: bütün hareket türleri, AÇILIŞ ve mutabakat DÜZELTMESİ hariç — ikisinin de
    bankada tek bir karşılığı yoktur (açılış o güne kadarki her şeyin toplamı, düzeltme de farkın
    kendisi). `acilis`: açılış hareketinin tarihi — o gün ve öncesi açılış bakiyesinin içindedir. */
export function hesapDefteri(data: AllData, accountId: number): { defter: DefterKaydi[]; acilis: string | null } {
  const mine = data.account_entries.filter((e) => e.account_id === accountId);
  const acilislar = mine.filter((e) => e.kind === "acilis").map((e) => e.date).sort();
  return {
    defter: mine
      .filter((e) => e.kind !== "acilis" && e.kind !== "duzeltme")
      .map((e) => ({ kimlik: `e${e.id}`, date: e.date, amount: e.amount, name: e.note })),
    acilis: acilislar[0] ?? null,
  };
}

/** Kartın harcamaları, hesap diline çevrili (harcama −), taksit sayısıyla. */
export function kartDefteri(data: AllData, cardId: number): DefterKaydi[] {
  return data.card_txs
    .filter((t) => t.card_id === cardId)
    .map((t) => ({ kimlik: `c${t.id}`, date: t.date, amount: -t.amount, name: t.name, taksit: t.installments }));
}
