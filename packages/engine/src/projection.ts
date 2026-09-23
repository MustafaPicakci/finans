import type { AllData, Currency } from "./types.js";
import { keyOf, hits, ymOf } from "./date.js";
import { recActiveOn, recurringAmountIndex, recAmountOn } from "./recurring.js";
import { loanPayDay, loanRemaining, loanActiveOn } from "./loans.js";
import { cardInfos, stmtKey } from "./cards.js";
import { convert, qtyDelta, positions, portfolioValueTry, type Rates } from "./portfolio.js";
import { depositValueOn } from "./deposits.js";

/** `cashFunds` = o gün elde tutulan para piyasası fonlarının TRY değeri (assets'in bir alt kümesi);
    nakit gibi likit sayılır. Etkin nakit = `bal + cashFunds`.
    `deposits` = o gün vadeli mevduatların TRY değeri (anapara + biriken net faiz); vade sonuna dek
    kilitli sayıldığından `bal`'a (harcanabilir nakit) girmez, yalnız `total`'a eklenir.
    `total` = o günkü TOPLAM VARLIK (bal + assets + deposits), borç düşülmemiş hâli.
    `debt` = o gün hâlâ duran borç: ödenmemiş kart ekstreleri + kredilerin kalan taksit tutarı.
    `worth` = NET VARLIK (`total - debt`) — App.tsx'teki hero rakamıyla **aynı tanım**: gün 0'da
    `cash + portföy + vadeli − kart borcu − kredi borcu`. Aynı soruya iki ekranın iki farklı cevap
    vermemesi için tanım tek yerde (burada) durur. Borç, projeksiyonda ödeme nakitten çıktığı GÜN
    düşer — yoksa ödenen ekstre hem bakiyeden hem borçtan iki kez sayılırdı. */
/** Bir günün planlı hareketinin KAYNAĞI (Faz 37). Tutar+ad yetmiyordu: olaylar takvimi
    "hangi tür" sorusunu soruyor ve cevabı burada zaten biliniyor — dışarıda yeniden türetmek
    (ada bakıp "ekstresi" ile bitiyorsa kart demek gibi) aynı kuralın ikinci, kırılgan kopyası
    olurdu. `takvim.ts` bunu okur, `nakit` sekmesi görmezden gelir. */
export type EvTur = "duzenli" | "kredi" | "ekstre" | "plan";
export type DayEv = { n: string; a: number; t: EvTur };
export type Day = { date: Date; k: string; net: number; bal: number; assets: number; cashFunds: number; deposits: number; total: number; debt: number; worth: number; ev: DayEv[] };

/** Nakit projeksiyonu (hepsi TRY). `rates` USD-doğal varlıkları TRY'ye çevirmek için — verilmezse USD çevrilmez.
    Para piyasası (nakit sayılan) fon sembolleri `settings.cash_funds`'tan (virgülle ayrık) okunur. */
export function project(data: AllData, months: number, rates: Rates = { usdTry: 0 }): Day[] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setMonth(end.getMonth() + months);
  /* gerçekleşmiş (kalem, ay) çiftleri: o ay artık gerçek kayıt (transaction/card_tx) olduğundan
     recurring döngüsünde tekrar EKLENMEZ — aksi halde tahmin çift sayardı */
  const realized = new Set((data.recurring_realized ?? []).map((r) => `${r.recurring_id}:${r.ym}`));
  /* tutar zaman çizelgesi: kalemin o aydaki tutarı buradan çözülür */
  const amountIdx = recurringAmountIndex(data.recurring_amounts);
  const oneMap = new Map<string, DayEv[]>();
  data.oneoffs.forEach((o) => {
    if (!oneMap.has(o.date)) oneMap.set(o.date, []);
    oneMap.get(o.date)!.push({ n: o.name, a: o.amount, t: "plan" });
  });
  /* güncel fiyat haritası; geçmiş günlerde de bugünkü fiyatla değerlenir (fiyat geçmişi tutulmuyor) */
  const priceMap = new Map(data.prices.map((p) => [`${p.asset_type}:${p.symbol}`, p.price]));
  const curOf = new Map<string, Currency>(data.trades.map((t) => [`${t.asset_type}:${t.symbol}`, t.currency ?? "TRY"]));
  /* nakit sayılan (para piyasası) fon anahtarları: settings.cash_funds = "AFA,TTE,..." */
  const cashFundKeys = new Set(
    (data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => `FON:${s}`),
  );
  /* o güne dek elde tutulan miktarı çıkarmak için işlemleri tarihe göre sırala */
  const sortedTrades = [...data.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const assetsOn = (dayKey: string) => {
    const qty = new Map<string, number>();
    for (const t of sortedTrades) {
      if (t.date > dayKey) break;
      const k = `${t.asset_type}:${t.symbol}`;
      qty.set(k, (qty.get(k) || 0) + qtyDelta(t)); // TEMETTÜ adedi değiştirmez, BEDELSİZ artırır
    }
    let assets = 0, cashFunds = 0;
    qty.forEach((q, k) => {
      const p = priceMap.get(k);
      if (!p || q <= 0) return;
      const v = convert(q * p, curOf.get(k) ?? "TRY", "TRY", rates);
      assets += v;
      if (cashFundKeys.has(k)) cashFunds += v;
    });
    return { assets, cashFunds };
  };
  let bal = data.accounts.reduce((s, a) => s + a.balance, 0);
  /* kart ekstre ödemeleri: son ödeme tarihine gider olarak düşer; ödendi işaretlenen ekstre atlanır
     (ödeme zaten transactions'a yazıldı → başlangıç bakiyesinde; tekrar düşmek çift sayım olurdu) */
  const paidStmts = new Set((data.statement_payments ?? []).map((p) => `${p.card_id}:${p.due}`));
  const stmtMap = new Map<string, DayEv[]>();
  /* kalan kart borcu: bugün itibarıyla ödenmemiş ekstrelerin toplamı (cardInfos zaten
     `due >= bugün` olanları verir) — döngüde her ekstre kendi son ödeme gününde düşülür */
  let cardDebt = 0;
  cardInfos(data.cards, data.card_txs, start, paidStmts).forEach((ci) => {
    ci.statements.forEach((s) => {
      if (s.paid) return;
      cardDebt += s.amount;
      const k = keyOf(s.due);
      if (!stmtMap.has(k)) stmtMap.set(k, []);
      stmtMap.get(k)!.push({ n: `${ci.card.name} ekstresi`, a: -s.amount, t: "ekstre" });
    });
  });
  const days: Day[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ev: DayEv[] = [];
    const ym = ymOf(d);
    data.recurring.forEach((r) => {
      if (recActiveOn(r, d) && hits(d, r.day) && !realized.has(`${r.id}:${ym}`)) {
        const a = recAmountOn(amountIdx.get(r.id), ym); // tutarı tanımsız kalem event üretmez
        if (a != null) ev.push({ n: r.name, a: r.kind === "income" ? a : -a, t: "duzenli" });
      }
    });
    data.loans.forEach((l) => {
      if (loanActiveOn(l, d) && hits(d, loanPayDay(l)))
        ev.push({ n: `${l.name} (kalan ${loanRemaining(l, d)})`, a: -l.amount, t: "kredi" });
    });
    /* ekstre ödemesi aynı gün hem nakitten çıkar hem borçtan düşer (a negatif) */
    (stmtMap.get(keyOf(d)) || []).forEach((e) => { ev.push(e); cardDebt += e.a; });
    (oneMap.get(keyOf(d)) || []).forEach((e) => ev.push(e));
    const net = ev.reduce((s, e) => s + e.a, 0);
    bal += net;
    const k = keyOf(d);
    const { assets, cashFunds } = assetsOn(k);
    /* vadeli mevduat: o günkü değeri (anapara + biriken net faiz); kilitli varlık → yalnız total'a */
    const deposits = data.deposits.reduce((s, dep) => s + depositValueOn(dep, d), 0);
    /* kredi borcu tarihten hesaplanır (loanRemaining): taksit ödendiği gün hem bakiyeden
       hem kalan borçtan düşer, biten kredi kendiliğinden sıfırlanır */
    const loanDebt = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, d), 0);
    const debt = cardDebt + loanDebt;
    const total = bal + assets + deposits;
    days.push({ date: new Date(d), k, net, bal, assets, cashFunds, deposits, total, debt, worth: total - debt, ev });
  }
  return days;
}

/* ————— NET VARLIK KIRILIMI (Faz 35) —————
   `Day.worth` net varlığı TEK bir sayı olarak verir; "neyden oluşuyor" sorusunun cevabı ise
   App.tsx'in içinde, hero'yu besleyen dört ayrı `useMemo`'da duruyordu — yani ekranın dışından
   (asistan) sorulabilir bir yerde değildi. Kopyalamak yerine tanım buraya taşınıyor.

   ÇAPA BUGÜNÜN GERÇEK BAKİYESİDİR (`Σ accounts.balance`), `project(...)[0].bal` DEĞİL: gün 0
   bugüne düşen PLANLI hareketleri (bugün ödeme günü olan bir maaş/kira) zaten işlemiştir, oysa
   "ne kadar nakdim var" sorusunun cevabı bankanın şu an söylediği rakamdır. İkisi çoğu gün
   eşittir, bugüne bir hareket düştüğünde ayrışır — hangisinin hangisi olduğu testte yazılı. */
export type NetVarlik = {
  /** Σ hesap bakiyesi (harcanabilir nakit) */
  nakit: number;
  /** portföyün TRY değeri (USD-doğal pozisyonlar `rates` ile çevrilir) */
  portfoy: number;
  /** vadeli mevduatların o günkü değeri (anapara + biriken net faiz) */
  vadeli: number;
  /** nakit + portföy + vadeli (borç DÜŞÜLMEMİŞ) */
  toplam: number;
  /** ödenmemiş kart ekstreleri */
  kartBorcu: number;
  /** kredilerin kalan taksit tutarı */
  krediBorcu: number;
  borc: number;
  /** toplam − borç */
  net: number;
};

/** Net varlığın bileşenleri (hepsi TRY). `Day.worth` ile aynı tanım — testli. */
export function netWorthBreakdown(data: AllData, rates: Rates = { usdTry: 0 }): NetVarlik {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nakit = data.accounts.reduce((s, a) => s + a.balance, 0);
  const portfoy = portfolioValueTry(positions(data.trades, data.prices), rates);
  const vadeli = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  const paid = new Set((data.statement_payments ?? []).map((p) => stmtKey(p.card_id, p.due)));
  /* Kart ve kredi borcu AYRI AYRI hesaplanır, biri diğerinden çıkarılarak bulunmaz: çıkarma
     kullanılsa projeksiyona üçüncü bir borç türü eklendiği gün o tutar sessizce "kart borcu"
     etiketiyle görünürdü. Şimdi bileşenlerin toplamı `Day.debt`'e eşit olmak ZORUNDA (test). */
  const kartBorcu = cardInfos(data.cards, data.card_txs, today, paid).reduce((s, c) => s + c.debt, 0);
  const krediBorcu = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, today), 0);
  const toplam = nakit + portfoy + vadeli;
  const borc = kartBorcu + krediBorcu;
  return { nakit, portfoy, vadeli, toplam, kartBorcu, krediBorcu, borc, net: toplam - borc };
}
