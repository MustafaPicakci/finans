import type { AllData } from "./types.js";
import type { KonumluSatir } from "./pdfSatir.js";
import { parseStatement } from "./statement.js";
import { parseIslemler } from "./islemTablosu.js";
import { dokumKarsilastir, hesapDefteri, kartDefteri } from "./dokum.js";
import { metinSadelestir } from "./kayitlar.js";

/* ————— İÇE AKTARMA HEDEFİ: BELGEDEN TAHMİN —————
   Toplu içe aktarmada "Nereye" sorusunu kullanıcıya sormak yanlış hatalara açıktı: Axess kart
   ekstresi Akbank HESABINA seçildi, ödeme gelir, harcamalar hesaptan çıkmış gibi göründü. Cevap
   belgenin içinde var, iki adımda okunur — bankaya özel kural OLMADAN (Faz 45.3):
   1. TÜR — aracı kurum ekstresi işlem tablosu taşır (`parseIslemler` başlık sözcükleriyle bulur);
      kart ekstresi dönem özeti taşır (kart kipinde "önceki dönem + harcamalar − ödemeler = dönem
      borcu" bulunur) ya da kart ekstrelerinin ortak sözcüklerini (hesap kesim / son ödeme / asgari
      ödeme); hiçbiri yoksa hesap dökümüdür.
   2. HANGİSİ — her aday (o türdeki kart/hesap) belgeyle karşılaştırılır ve defterinde EN ÇOK satırı
      eşleşen seçilir (`dokumKarsilastir`, ada bakmadan tutar + ±3 gün). Hesapta belgenin son
      bakiyesi o günkü defter bakiyesine eşitse bu kesin kanıttır. Kanıt yoksa (hiç eşleşme, yeni
      kullanıcı) tek aday varsa o, yoksa ilk aday seçilir ve `emin: false` döner — arayüz seçimi
      gösterir ve değiştirtir, sessizce yazmaz. */

export type HedefTuru = "hesap" | "kart" | "islem";
/** `hedef`: ImportForm'un değeri — "a:<hesap>" | "c:<kart>" | "t:<hesap>" | "t:" | "" (yalnız defter) */
export type HedefTahmini = { tur: HedefTuru; hedef: string; eslesen: number; emin: boolean };

const KART_SOZCUK = /hesap kesim|son odeme tarihi|asgari odeme|donem borcu/;

export function hedefTahmin(girdi: string | KonumluSatir[], data: AllData): HedefTahmini {
  if (parseIslemler(girdi).islemler.length > 0) {
    const araci = data.accounts.filter((a) => a.kind === "araci");
    // birden çok aracı kurum hesabı: işlemleri en çok bağlanmış olan
    const say = (id: number) => data.trades.filter((t) => t.account_id === id).length;
    const en = [...araci].sort((a, b) => say(b.id) - say(a.id))[0];
    return { tur: "islem", hedef: en ? `t:${en.id}` : "t:", eslesen: 0, emin: araci.length <= 1 };
  }

  const metin = typeof girdi === "string" ? girdi : girdi.map((s) => s.map((h) => h.s).join(" ")).join("\n");
  const kartca = parseStatement(girdi, "kart");
  if (kartca.dogrulama.tur === "donem" || KART_SOZCUK.test(metinSadelestir(metin))) {
    const adaylar = data.cards.map((c) => ({
      id: c.id,
      puan: dokumKarsilastir(kartca.rows, kartDefteri(data, c.id), { kart: true }).satirlar.filter((s) => s.durum === "eslesti").length,
    }));
    return sec("kart", "c", adaylar);
  }

  const hesapca = parseStatement(girdi, "gider");
  const son = hesapca.dogrulama.tur === "bakiye" ? hesapca.dogrulama.son : null;
  const adaylar = data.accounts.map((a) => {
    const { defter, acilis } = hesapDefteri(data, a.id);
    let puan = dokumKarsilastir(hesapca.rows, defter, { acilis }).satirlar.filter((s) => s.durum === "eslesti").length;
    if (son) {
      const bakiye = data.account_entries.filter((e) => e.account_id === a.id && e.date <= son.tarih).reduce((s, e) => s + e.amount, 0);
      if (Math.abs(bakiye - son.bakiye) < 0.005) puan += 1000; // belgenin bakiyesi bu hesabınki: kesin kanıt
    }
    return { id: a.id, puan };
  });
  return sec("hesap", "a", adaylar);
}

function sec(tur: HedefTuru, onek: string, adaylar: { id: number; puan: number }[]): HedefTahmini {
  if (!adaylar.length) return { tur, hedef: "", eslesen: 0, emin: false };
  const sirali = [...adaylar].sort((a, b) => b.puan - a.puan);
  const [ilk, ikinci] = sirali;
  const emin = adaylar.length === 1 || (ilk.puan > 0 && ilk.puan > (ikinci?.puan ?? 0));
  return { tur, hedef: `${onek}:${ilk.id}`, eslesen: ilk.puan % 1000, emin };
}
