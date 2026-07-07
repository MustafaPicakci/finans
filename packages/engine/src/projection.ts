import type { AllData } from "./types.js";
import { keyOf, hits } from "./date.js";
import { recActiveOn } from "./recurring.js";
import { loanPayDay, loanRemaining, loanActiveOn } from "./loans.js";
import { cardInfos } from "./cards.js";

export type Day = { date: Date; k: string; net: number; bal: number; assets: number; total: number; ev: { n: string; a: number }[] };

export function project(data: AllData, months: number): Day[] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setMonth(end.getMonth() + months);
  const oneMap = new Map<string, { n: string; a: number }[]>();
  data.oneoffs.forEach((o) => {
    if (!oneMap.has(o.date)) oneMap.set(o.date, []);
    oneMap.get(o.date)!.push({ n: o.name, a: o.amount });
  });
  /* güncel fiyat haritası; geçmiş günlerde de bugünkü fiyatla değerlenir (fiyat geçmişi tutulmuyor) */
  const priceMap = new Map(data.prices.map((p) => [`${p.asset_type}:${p.symbol}`, p.price]));
  /* o güne dek elde tutulan miktarı çıkarmak için işlemleri tarihe göre sırala */
  const sortedTrades = [...data.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const assetsOn = (dayKey: string) => {
    const qty = new Map<string, number>();
    for (const t of sortedTrades) {
      if (t.date > dayKey) break;
      const k = `${t.asset_type}:${t.symbol}`;
      qty.set(k, (qty.get(k) || 0) + (t.side === "ALIŞ" ? t.qty : -t.qty));
    }
    let v = 0;
    qty.forEach((q, k) => { const p = priceMap.get(k); if (p && q > 0) v += q * p; });
    return v;
  };
  let bal = data.accounts.reduce((s, a) => s + a.balance, 0);
  /* kart ekstre ödemeleri: son ödeme tarihine gider olarak düşer */
  const stmtMap = new Map<string, { n: string; a: number }[]>();
  cardInfos(data.cards, data.card_txs, start).forEach((ci) => {
    ci.statements.forEach((s) => {
      const k = keyOf(s.due);
      if (!stmtMap.has(k)) stmtMap.set(k, []);
      stmtMap.get(k)!.push({ n: `${ci.card.name} ekstresi`, a: -s.amount });
    });
  });
  const days: Day[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ev: { n: string; a: number }[] = [];
    data.recurring.forEach((r) => {
      if (recActiveOn(r, d) && hits(d, r.day)) ev.push({ n: r.name, a: r.kind === "income" ? r.amount : -r.amount });
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
    const assets = assetsOn(k);
    days.push({ date: new Date(d), k, net, bal, assets, total: bal + assets, ev });
  }
  return days;
}
