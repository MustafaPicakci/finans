import type { AllData, Currency } from "./types.js";
import { keyOf, hits, ymOf } from "./date.js";
import { recActiveOn } from "./recurring.js";
import { loanPayDay, loanRemaining, loanActiveOn } from "./loans.js";
import { cardInfos } from "./cards.js";
import { convert, type Rates } from "./portfolio.js";
import { depositValueOn } from "./deposits.js";

/** `cashFunds` = o gün elde tutulan para piyasası fonlarının TRY değeri (assets'in bir alt kümesi);
    nakit gibi likit sayılır. Etkin nakit = `bal + cashFunds`.
    `deposits` = o gün vadeli mevduatların TRY değeri (anapara + biriken net faiz); vade sonuna dek
    kilitli sayıldığından `bal`'a (harcanabilir nakit) girmez, yalnız `total`'a (net varlık) eklenir. */
export type Day = { date: Date; k: string; net: number; bal: number; assets: number; cashFunds: number; deposits: number; total: number; ev: { n: string; a: number }[] };

/** Nakit projeksiyonu (hepsi TRY). `rates` USD-doğal varlıkları TRY'ye çevirmek için — verilmezse USD çevrilmez.
    Para piyasası (nakit sayılan) fon sembolleri `settings.cash_funds`'tan (virgülle ayrık) okunur. */
export function project(data: AllData, months: number, rates: Rates = { usdTry: 0 }): Day[] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setMonth(end.getMonth() + months);
  /* gerçekleşmiş (kalem, ay) çiftleri: o ay artık gerçek kayıt (transaction/card_tx) olduğundan
     recurring döngüsünde tekrar EKLENMEZ — aksi halde tahmin çift sayardı */
  const realized = new Set((data.recurring_realized ?? []).map((r) => `${r.recurring_id}:${r.ym}`));
  const oneMap = new Map<string, { n: string; a: number }[]>();
  data.oneoffs.forEach((o) => {
    if (!oneMap.has(o.date)) oneMap.set(o.date, []);
    oneMap.get(o.date)!.push({ n: o.name, a: o.amount });
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
      qty.set(k, (qty.get(k) || 0) + (t.side === "ALIŞ" ? t.qty : -t.qty));
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
  const stmtMap = new Map<string, { n: string; a: number }[]>();
  cardInfos(data.cards, data.card_txs, start, paidStmts).forEach((ci) => {
    ci.statements.forEach((s) => {
      if (s.paid) return;
      const k = keyOf(s.due);
      if (!stmtMap.has(k)) stmtMap.set(k, []);
      stmtMap.get(k)!.push({ n: `${ci.card.name} ekstresi`, a: -s.amount });
    });
  });
  const days: Day[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ev: { n: string; a: number }[] = [];
    data.recurring.forEach((r) => {
      if (recActiveOn(r, d) && hits(d, r.day) && !realized.has(`${r.id}:${ymOf(d)}`))
        ev.push({ n: r.name, a: r.kind === "income" ? r.amount : -r.amount });
    });
    data.loans.forEach((l) => {
      if (loanActiveOn(l, d) && hits(d, loanPayDay(l)))
        ev.push({ n: `${l.name} (kalan ${loanRemaining(l, d)})`, a: -l.amount });
    });
    (stmtMap.get(keyOf(d)) || []).forEach((e) => ev.push(e));
    (oneMap.get(keyOf(d)) || []).forEach((e) => ev.push(e));
    const net = ev.reduce((s, e) => s + e.a, 0);
    bal += net;
    const k = keyOf(d);
    const { assets, cashFunds } = assetsOn(k);
    /* vadeli mevduat: o günkü değeri (anapara + biriken net faiz); kilitli varlık → yalnız total'a */
    const deposits = data.deposits.reduce((s, dep) => s + depositValueOn(dep, d), 0);
    days.push({ date: new Date(d), k, net, bal, assets, cashFunds, deposits, total: bal + assets + deposits, ev });
  }
  return days;
}
