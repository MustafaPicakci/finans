import type { AllData } from "./types.js";
import { keyOf, parseD, todayStr } from "./date.js";
import { clampDay, firstCutoff } from "./cards.js";
import { depositMaturity, depositMaturityValue } from "./deposits.js";
import { tumKayitlar, type KayitYon } from "./kayitlar.js";
import { makroOlaylar } from "./makro.js";
import type { Day } from "./projection.js";

/* ————— FAZ 37: FİNANSAL OLAYLAR TAKVİMİ —————

   BURADA YENİ MATEMATİK YOKTUR ve bu bilinçlidir (holdings.ts + corporate.ts'in aynı
   gerekçesi): her satır zaten var olan bir hesabın ÇIKTISIDIR — geçmiş `tumKayitlar()`ten,
   gelecek `project()`in `Day.ev`inden, kart kesimi `firstCutoff()`ten, vade `depositMaturity()`
   den, piyasa olayları sunucunun çektiği tablolardan, makro tarihler `makro.ts`ten gelir.
   Bu dosyanın tek işi hepsini TEK BİR ZAMAN EKSENİNDE birleştirmek. Örneğin taksit tutarını
   burada yeniden hesaplamak (`loan.amount`, `loanRemaining`) üçüncü bir kopya olurdu ve yeni
   bir hareket türü eklendiğinde sessizce ayrışırdı.

   NAKİT TAKVİMİNDEN FARKI (kasıtlı iş bölümü — yoksa üçüncü kopya olurdu): Nakit sekmesinin
   takvimi "o gün PARAM VAR MI" sorusuna cevap verir, gün rengini etkin nakitten (`bal +
   cashFunds`) alır ve piyasa olaylarını hiç bilmez. Bu takvim "o gün NE OLUYOR" sorusuna
   cevap verir: gün rengi yoktur, bakiye çizmez, karşılığında defter olaylarının YANINA piyasa
   tarihlerini koyar.

   TOPLAM YOKTUR VE OLMAMALI. `tutar` satır başına bir rakamdır, toplanabilir bir büyüklük
   DEĞİL — `harcama.ts`'in "tüketim vs nakit" tuzağının aynısı buradadır: bir kart harcaması
   (harcandığı gün) ile onun ekstre ödemesi (son ödeme günü) aynı parayı iki kez sayar, virman
   iki bacağıyla net sıfırdır, vade değeri ise net varlıkta zaten duran bir tutarın yer
   değiştirmesidir. Gün hücresinde olay SAYISI ve türü gösterilir, tutarların toplamı değil.
   Toplam isteyen ekran `harcamaOzeti()` çağırır, burada bir tane uydurmaz.  */

/** Olayın cinsi. İlk dördü DEFTER (kullanıcının kendi verisi), son üçü PİYASA (global veri). */
export type TakvimTur =
  /** olmuş kayıt: gelir-gider / kart harcaması / virman / portföy işlemi */
  | "gerceklesen"
  /** projeksiyondan gelen planlı hareket: düzenli kalem / kredi taksidi / ekstre ödemesi / tek seferlik */
  | "planli"
  /** kredi kartı hesap kesim günü — o günden sonraki harcama SONRAKİ ekstreye girer */
  | "kesim"
  /** vadeli mevduatın vade günü */
  | "vade"
  /** şirketin bilanço (finansal sonuç) tarihi */
  | "bilanco"
  /** kurumsal olay ex-date'i: bedelsiz / temettü */
  | "kurumsal"
  /** TCMB / Fed / TÜİK takvimi */
  | "makro";

/** PİYASA türleri — Nakit takviminin "piyasa katmanı" bunu süzgeç olarak geçer (defter
    olayları o ekranda zaten `Day.ev`den ve defterden geliyor; ikinci kez istemek aynı satırı
    iki kez çizerdi). Defter türlerinin karşılığı bir sabit YOK: onları süzgeçsiz isteyen
    bir çağrı yeri yok ve kullanılmayan bir sabit "burada bir simetri var" diye okunurdu. */
export const PIYASA_TURLERI: TakvimTur[] = ["bilanco", "kurumsal", "makro"];

export type TakvimOlay = {
  /** React anahtarı; tür + kaynak id/tarih (id'ler tablolar arasında çakışır) */
  key: string;
  date: string; // YYYY-MM-DD
  tur: TakvimTur;
  /** satırın kimliği */
  baslik: string;
  /** ikincil bağlam (kart adı, sembol, kaynak kurum, "kalan 7 taksit"…) */
  detay: string;
  /** satırda yazılacak MUTLAK tutar; bilgi olaylarında null. İşaret `yon`dan okunur
      (bkz. kayitlar.ts: tek işaretli alan yetmez, virman net sıfırdır). TOPLANAMAZ. */
  tutar: number | null;
  yon: KayitYon;
  /** piyasa tarihlerinde: tarih duyurulmuş mu (false/undefined), bir desenden mi türetildi (true).
      Ekranda "~" ile yazılır — tahmini tarihi kesin göstermek sessiz bir yanlış olurdu. */
  tahmini?: boolean;
  /** piyasa olaylarında ilgili sembol (ekranda monogram + süzgeç için) */
  symbol?: string;
  /** kısa tür etiketi (rozet metni) */
  etiket: string;
};

export type TakvimSecenek = {
  /** dahil, YYYY-MM-DD. Yoksa `days`in ilk günü ya da bugün. */
  from?: string;
  /** dahil, YYYY-MM-DD. Yoksa `days`in son günü. */
  to?: string;
  /** yalnız bu türler (boş/verilmemiş = hepsi) */
  turler?: TakvimTur[];
};

const KART_ETIKET: Record<string, string> = {
  duzenli: "Düzenli",
  kredi: "Kredi taksidi",
  ekstre: "Ekstre ödemesi",
  plan: "Planlı",
};

/**
 * Tek bir zaman ekseninde birleşmiş olay listesi (tarihe göre artan, aynı gün içinde
 * DEFTER olayları önce — para hareketi bilgi tarihinden önce okunmalı).
 *
 * @param data  kullanıcının verisi (geçmiş kayıtlar + tanımlar + piyasa tabloları)
 * @param days  `project()` çıktısı — GELECEK planlı hareketlerin TEK kaynağı; boş verilirse
 *              takvim yalnız geçmişi ve piyasa tarihlerini gösterir (yeniden hesaplanmaz)
 */
export function takvimOlaylari(data: AllData, days: Day[], s: TakvimSecenek = {}): TakvimOlay[] {
  const bugun = todayStr();
  const from = s.from ?? (days[0] ? days[0].k : bugun);
  const to = s.to ?? (days.at(-1)?.k ?? bugun);
  const izin = s.turler && s.turler.length ? new Set(s.turler) : null;
  const ac = (t: TakvimTur) => !izin || izin.has(t);
  const out: TakvimOlay[] = [];
  const ekle = (o: TakvimOlay) => { if (o.date >= from && o.date <= to && ac(o.tur)) out.push(o); };

  /* ————— DEFTER: olmuş kayıtlar —————
     `tumKayitlar` dört tabloyu (transactions/card_txs/transfers/trades) tek listeye indirir ve
     Türkçe arama/yön kuralları orada çözülmüştür. İkinci bir birleştirici yazmak Kayıtlar
     ekranıyla bu takvimin aynı güne farklı satırlar göstermesi demekti. */
  if (ac("gerceklesen"))
    for (const k of tumKayitlar(data))
      ekle({
        key: `g:${k.key}`, date: k.date, tur: "gerceklesen", baslik: k.ad, detay: k.detay,
        tutar: k.tutar, yon: k.yon, etiket: k.etiket,
      });

  /* ————— DEFTER: planlı hareketler —————
     `Day.ev` projeksiyonun kendi çıktısıdır: düzenli kalemin o aydaki tutarı, kredinin kalan
     taksidi, ekstrenin tutarı ve "bu ay zaten gerçekleşti mi" elemesi orada çözülmüş durumda. */
  if (ac("planli"))
    for (const d of days)
      for (const [i, e] of d.ev.entries())
        ekle({
          /* `detay` BOŞ: tür bilgisi zaten `etiket`te ve ikisini birden yazmak satırda
             "Düzenli · Düzenli" üretiyordu (mobil çekimde görüldü). */
          key: `p:${d.k}:${i}`, date: d.k, tur: "planli", baslik: e.n, detay: "",
          tutar: Math.abs(e.a), yon: e.a >= 0 ? "giris" : "cikis", etiket: KART_ETIKET[e.t] ?? "Planlı",
        });

  /* ————— DEFTER: kart hesap kesim günleri —————
     Ekstrenin SON ÖDEME günü projeksiyonda var (para o gün çıkar), KESİM günü hiçbir ekranda
     yoktu — oysa kullanıcının sorduğu soru "bugün harcarsam hangi ekstreye girer". Tarih
     `firstCutoff` ile üretilir (kartın kendi matematiği), tutar YAZILMAZ: kesim günü para
     hareketi değildir. */
  if (ac("kesim"))
    for (const c of data.cards) {
      /* Pencerenin başından say (bugünden değil): geçmiş bir ay görüntülenirken o ayın kesim
         günü de anlamlıdır ("bu harcama hangi ekstreye girdi"). 24 tur, pencere ne kadar
         geniş olursa olsun sonsuz döngüyü keser. */
      let cut = firstCutoff(parseD(from), c.statement_day);
      for (let i = 0; i < 24 && keyOf(cut) <= to; i++) {
        ekle({
          key: `k:${c.id}:${keyOf(cut)}`, date: keyOf(cut), tur: "kesim",
          baslik: `${c.name} hesap kesimi`, detay: "bundan sonraki harcama sonraki ekstreye girer",
          tutar: null, yon: "notr", etiket: "Kesim",
        });
        cut = clampDay(cut.getFullYear(), cut.getMonth() + 1, c.statement_day);
      }
    }

  /* ————— DEFTER: vadeli mevduat vadesi —————
     Vade değeri net varlıkta ZATEN duruyor (projeksiyon mevduatı her gün değerliyor); burada
     yazılan rakam yeni bir para değil, o gün çözülecek tutardır. Toplam olmadığı için çift
     sayım riski yok (bkz. dosya başı). */
  if (ac("vade"))
    for (const dep of data.deposits) {
      const m = depositMaturity(dep);
      ekle({
        key: `v:${dep.id}`, date: keyOf(m), tur: "vade", baslik: `${dep.name} vadesi doluyor`,
        detay: "anapara + net faiz", tutar: depositMaturityValue(dep), yon: "giris", etiket: "Vade",
      });
    }

  /* ————— PİYASA: bilanço tarihleri —————
     `tahmini` Yahoo'nun `isEarningsDateEstimate` bayrağıdır ve AKTARILMAK ZORUNDA: ölçüldü,
     tutulan sembollerin bir kısmında tarih duyurulmuş (THYAO/GARAN), bir kısmında geçen yılın
     tarihinden türetilmiş (ASELS/BIMAS). İkisini aynı biçimde yazmak tahmini kesin göstermek
     olurdu. */
  if (ac("bilanco"))
    for (const ce of data.company_events ?? [])
      ekle({
        key: `b:${ce.asset_type}:${ce.symbol}:${ce.date}`, date: ce.date, tur: "bilanco",
        baslik: `${ce.symbol} bilanço`, detay: ce.tahmini ? "tarih tahmini (geçen yıla göre)" : "tarih açıklandı",
        tutar: null, yon: "notr", tahmini: ce.tahmini, symbol: ce.symbol, etiket: "Bilanço",
      });

  /* ————— PİYASA: kurumsal olaylar (ex-date) —————
     `corporate_actions` GEÇMİŞ olayları taşır (Yahoo ileriye dönük bedelsiz/temettü duyurusu
     vermiyor — ölçüldü, `exDividendDate` çoğu sembolde SON ex-date'i döndürüyor). Takvimde
     geçmişte durmaları yine değerli: "hisse o gün neden yarıya indi" sorusunun cevabı budur
     ve Faz 36'nın "kaçırdığın olay" uyarısıyla aynı satıra bakar. */
  if (ac("kurumsal"))
    for (const ca of data.corporate_actions ?? []) {
      const bedelsiz = ca.kind === "bolunme";
      ekle({
        key: `c:${ca.asset_type}:${ca.symbol}:${ca.date}:${ca.kind}`, date: ca.date, tur: "kurumsal",
        baslik: `${ca.symbol} ${bedelsiz ? "bedelsiz" : "temettü"}`,
        detay: bedelsiz
          ? `adet çarpanı ${ca.value.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`
          : "hisse başına brüt (stopaj düşülmemiş)",
        tutar: bedelsiz ? null : ca.value, yon: "notr", symbol: ca.symbol,
        etiket: bedelsiz ? "Bedelsiz" : "Temettü",
      });
    }

  /* ————— PİYASA: makro takvim ————— */
  if (ac("makro"))
    for (const m of makroOlaylar(from, to))
      ekle({
        /* `detay` BOŞ: kaynak `etiket`te duruyor ve başlık zaten kurumu söylüyor
           ("TCMB faiz kararı (PPK)") — ikisi birlikte "Fed · Fed" oluyordu. */
        key: `m:${m.kaynak}:${m.date}:${m.baslik}`, date: m.date, tur: "makro", baslik: m.baslik,
        detay: "", tutar: null, yon: "notr", tahmini: m.tahmini, etiket: m.kaynak,
      });

  /* Aynı gün içinde DEFTER olayları önce: para hareketi, bilgi tarihinden önce okunmalı. */
  const sira: Record<TakvimTur, number> = {
    gerceklesen: 0, planli: 1, kesim: 2, vade: 3, kurumsal: 4, bilanco: 5, makro: 6,
  };
  return out.sort((a, b) => a.date.localeCompare(b.date) || sira[a.tur] - sira[b.tur] || a.baslik.localeCompare(b.baslik, "tr"));
}

/** Gün anahtarına göre gruplanmış hâli (takvim ızgarası bunu okur). */
export function takvimGunleri(olaylar: TakvimOlay[]): Map<string, TakvimOlay[]> {
  const m = new Map<string, TakvimOlay[]>();
  for (const o of olaylar) {
    if (!m.has(o.date)) m.set(o.date, []);
    m.get(o.date)!.push(o);
  }
  return m;
}
