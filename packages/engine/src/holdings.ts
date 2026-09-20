import type { AssetType, Currency, Trade } from "./types.js";
import { tradeLedger, cashDelta, convert, type Rates, type TradeEntry } from "./portfolio.js";

/* ————— POZİSYON DÖNEMLERİ ve AKIŞ (Faz 31) —————
   `positions()` "şu an elimde ne var" der, `tradeLedger()` "tek tek ne oldu" der. Aradaki
   soru cevapsızdı: **bu varlık portföye ne zaman girdi, ne zaman çıktı, sonuçta ne oldu?**
   Kullanıcı bunu göremediği için satılmış bir hisse ile hâlâ tutulan biri aynı listede,
   ayırt edilemez duruyordu.

   Doğru birim SEMBOL DEĞİL, POZİSYON DÖNEMİDİR. Ocak'ta alınıp Mart'ta tamamen satılan ve
   Temmuz'da yeniden alınan THYAO, iki ayrı iştir: ayrı giriş/çıkış tarihi, ayrı maliyet,
   ayrı sonuç. Motor zaten böyle davranıyor (pozisyon kapanıp yeniden açılınca ortalama
   maliyet sıfırlanır) ama bu gerçek hiçbir ekrana yansımıyordu.

   BURADA YENİ MATEMATİK YOKTUR — ve bu bilinçlidir. Ortalama maliyet + gerçekleşen K/Z
   mantığının kod tabanında zaten iki kopyası var (`positions` ve `tradeLedger`); üçüncüsünü
   yazmak, bu projenin defalarca bedelini ödediği hatayı tekrarlamak olurdu (yeni bir olay
   türü eklendiğinde kopyalardan biri sessizce ayrışır). Bu dosya `tradeLedger()` çıktısının
   saf bir GRUPLAMASIDIR: her işlemin öncesi/sonrası adedi, ortalama maliyeti ve gerçekleşen
   K/Z'si oradan hazır gelir. Testte ayrışma kapanı var: dönemlerin toplamı `positions()` ile
   birebir tutmak zorunda. */

/** Adet karşılaştırma eşiği — float artığı ("tümünü sat" sonrası 1e-12) pozisyonu açık
    göstermesin. `heldSymbols` ile aynı eşik. */
const EPS = 1e-9;

/** Bir varlığın portföyde tutulduğu KESİNTİSİZ dönem: açılışından kapanışına (ya da bugüne). */
export type PositionPeriod = {
  type: AssetType;
  sym: string;
  /** dönemin para birimi — tutarların hepsi bu birimdedir */
  currency: Currency;
  /** pozisyonu sıfırdan açan işlemin tarihi */
  openedAt: string;
  /** pozisyonun tamamen kapandığı tarih; hâlâ elde tutuluyorsa `null` */
  closedAt: string | null;
  /** hâlâ elde tutulan adet (kapalı dönemde 0) */
  qty: number;
  /** ortalama maliyet (kapalı dönemde 0 — pozisyon bitmiştir) */
  avg: number;
  /** dönem boyunca ulaşılan en yüksek adet — "ne kadar büyüttüm" */
  peakQty: number;
  /** döneme konan para: ALIŞ'ların toplamı, komisyon dahil (pozitif) */
  invested: number;
  /** dönemden çıkan para: SATIŞ neti + TEMETTÜ neti (pozitif) */
  returned: number;
  /** gerçekleşen K/Z — satış kârı + temettü (`positions().realized` ile aynı matematik) */
  realized: number;
  /** `realized`'ın içindeki temettü kısmı; ayrıca raporlanır (farklı bir getiri kalitesi) */
  dividend: number;
  /** dönemdeki işlem sayısı */
  count: number;
};

/** Ledger girdisinin adede etkisi — `qtyAfter - qtyBefore`; `qtyDelta`'yı yeniden hesaplamaya gerek yok. */
const deltaOf = (e: TradeEntry) => e.qtyAfter - e.qtyBefore;

/**
 * İşlemleri pozisyon dönemlerine böler (Faz 31). Kapsam çağıranındır: tüm işlemleri verirsen
 * birleşik, tek portföyün işlemlerini verirsen o grubun dönemleri çıkar — `tradeLedger` ve
 * `positions` ile aynı kapsam kuralı (bkz. `groupTradesByPortfolio`).
 *
 * Sıra: açılış tarihine göre YENİDEN ESKİYE (ekranlar en son işi en üstte ister).
 */
export function positionPeriods(trades: Trade[]): PositionPeriod[] {
  /** anahtar başına o sembolün dönemleri; sonuncusu "açık olabilecek" olandır */
  const byKey = new Map<string, PositionPeriod[]>();
  const out: PositionPeriod[] = [];

  for (const e of tradeLedger(trades)) {
    const t = e.trade;
    const k = `${t.asset_type}:${t.symbol}`;
    let list = byKey.get(k);
    if (!list) byKey.set(k, (list = []));
    const last = list.at(-1);
    /* Açık dönem = henüz kapanmamış olan. Kapalıysa (ya da hiç yoksa) yeni dönem gerekir —
       ama yalnız adedi ARTIRAN bir olay pozisyon açabilir: adet sıfırken gelen TEMETTÜ
       (satış sonrası ödenen kâr payı) yeni bir pozisyon değildir, geçmiş dönemin sonucudur. */
    let p = last && last.closedAt == null ? last : null;
    if (!p) {
      /* Adet artırmayan bir olay (kapanıştan SONRA ödenen temettü) yeni pozisyon açmaz —
         geçmiş dönemin sonucudur, son döneme yazılır. Ama hiç dönem yoksa yine de bir tane
         açılır: aksi halde o olayın `realized`'ı sessizce DÜŞERDİ ve dönem toplamları
         `positions()` ile ayrışırdı (ayrışma kapanı testi tam bunu yakalıyor). */
      if (deltaOf(e) <= EPS && last) {
        p = last;
      } else {
        p = {
          type: t.asset_type, sym: t.symbol, currency: t.currency ?? "TRY",
          openedAt: t.date, closedAt: null, qty: 0, avg: 0, peakQty: 0,
          invested: 0, returned: 0, realized: 0, dividend: 0, count: 0,
        };
        list.push(p);
        out.push(p);
      }
    }

    p.count++;
    p.realized += e.realized;
    if (t.side === "ALIŞ") p.invested += e.cash;
    else if (t.side === "SATIŞ") p.returned += e.cash;
    else if (t.side === "TEMETTÜ") { p.returned += e.cash; p.dividend += e.cash; }

    /* Adet ve ortalama maliyet ledger'dan OLDUĞU GİBİ alınır (yeniden hesaplanmaz).
       Kapalı dönemde ikisi de 0'dır — `tradeLedger` kapanışta zaten sıfırlar. */
    p.qty = e.qtyAfter;
    p.avg = e.avgAfter;
    if (e.qtyAfter > p.peakQty) p.peakQty = e.qtyAfter;
    /* Kapanış: adet eşiğin altına indiyse dönem bitmiştir. `deltaOf <= 0` koşulu, adedi
       ARTIRAN bir olayın (yeni dönemi açan ALIŞ) kapanış sayılmasını engeller; aşırı satışta
       adet negatife düşse de kapanış aynı kuralla yakalanır. Zaten kapanmış bir döneme
       sonradan yazılan temettü kapanış tarihini DEĞİŞTİRMEZ (`closedAt == null` koşulu). */
    if (p.closedAt == null && e.qtyAfter <= EPS && deltaOf(e) <= EPS) {
      p.closedAt = t.date;
      p.qty = 0;
      p.avg = 0;
    }
  }

  return out.sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.sym.localeCompare(b.sym, "tr"));
}

/* ————— DÖNEM AKIŞI —————
   "Bu ay portföye ne girdi, ne çıktı?" Dönem listesi varlık odaklıdır (bir varlığın hikâyesi),
   bu ise zaman odaklıdır (bir ayın hikâyesi). İkisi aynı olaylara iki farklı eksenden bakar. */

/** Bir olayın portföye etkisinin CİNSİ — rozet metni ve rengi buradan gelir */
export type FlowKind = "acildi" | "artti" | "azaldi" | "kapandi" | "temettu" | "bedelsiz";

export type FlowEvent = {
  kind: FlowKind;
  sym: string;
  type: AssetType;
  currency: Currency;
  date: string;
  /** işlemin adedi (temettüde kâr payı ödenen adet) */
  qty: number;
  /** işlemin nakit büyüklüğü, kendi para biriminde — işaretsiz (yönü `kind` söyler) */
  cash: number;
  /** yalnız SATIŞ/TEMETTÜ'de anlamlı: o işlemde gerçekleşen K/Z */
  realized: number;
  /** olaydan sonra elde kalan adet */
  qtyAfter: number;
};

export type FlowMonth = {
  /** `'YYYY-MM'` */
  ym: string;
  /** o ayın olayları, yeniden eskiye */
  events: FlowEvent[];
  /** o ay portföye konan NET para (TRY): ALIŞ +, SATIŞ −, TEMETTÜ −, BEDELSİZ 0 */
  netTry: number;
};

/** Ledger girdisini akış olayına çevirir — `kind` kararı tek yerde. */
function flowKindOf(e: TradeEntry): FlowKind {
  switch (e.trade.side) {
    case "TEMETTÜ": return "temettu";
    case "BEDELSİZ": return "bedelsiz";
    case "ALIŞ": return e.qtyBefore <= EPS ? "acildi" : "artti";
    case "SATIŞ": return e.qtyAfter <= EPS ? "kapandi" : "azaldi";
  }
}

/**
 * İşlemleri aya göre gruplanmış akış olaylarına çevirir (yeniden eskiye).
 *
 * `netTry` tanımı `walkValueHistory`'nin `contributed`'ı ile BİREBİR AYNIDIR (`-cashDelta`,
 * güncel FX ile TRY'ye çevrili) — grafikteki "yatırdığın para" çizgisiyle bu ekranın rakamı
 * çelişmesin diye. Ayrı bir "konan para" tanımı uydurmak, aynı soruya iki farklı cevap veren
 * iki ekran demek olurdu.
 */
export function portfolioFlow(trades: Trade[], rates: Rates): FlowMonth[] {
  const by = new Map<string, FlowMonth>();
  for (const e of tradeLedger(trades)) {
    const t = e.trade;
    const ym = t.date.slice(0, 7);
    let m = by.get(ym);
    if (!m) by.set(ym, (m = { ym, events: [], netTry: 0 }));
    m.events.push({
      kind: flowKindOf(e), sym: t.symbol, type: t.asset_type, currency: t.currency ?? "TRY",
      date: t.date, qty: t.qty, cash: Math.abs(e.cash), realized: e.realized, qtyAfter: e.qtyAfter,
    });
    m.netTry += convert(-cashDelta(t), t.currency ?? "TRY", "TRY", rates);
  }
  return [...by.values()]
    .map((m) => ({ ...m, events: m.events.reverse() })) // ay içinde de yeniden eskiye
    .sort((a, b) => b.ym.localeCompare(a.ym));
}
