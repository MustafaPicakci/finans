import type { AllData, Currency } from "./types.js";
import type { Day } from "./projection.js";
import { convert, qtyDelta, type Rates } from "./portfolio.js";

/* ————— PARA PİYASASI FONU: "ÖDEME ÖNCESİ BOZ" ÖNERİSİ (Faz 17) —————
   Kullanıcının gerçek ritüeli: maaşı fona park et, her ödemeden bir gün önce ihtiyacı kadarını boz.
   Bu modül o ritüeli projeksiyondan okur: önümüzdeki pencerede **saf nakit** (bal) eksiye düşüyorsa
   ne kadar bozulması gerektiğini ve en geç ne zaman bozulacağını söyler.

   Neden `bal` (saf nakit), `bal + cashFunds` (etkin nakit) değil: fonu bozmanın amacı zaten fondaki
   parayı nakde çevirmek. Etkin nakde bakarsak "sorun yok, fonda paran var" der ve öneri hiç çıkmaz —
   oysa kullanıcının yapması gereken tam olarak o çevirme işlemi.

   Neden penceredeki EN DÜŞÜK nokta, ilk eksi gün değil: bal kümülatiftir; bugün X bozarsan sonraki
   tüm günler +X kayar. Açığı gerçekten kapatan tutar pencerenin en derin noktasıdır — ilk eksi güne
   göre bozarsan iki gün sonra yine açık verirsin ve ritüeli iki kez yaparsın. */

/** `settings.cash_funds` = "AFA,TTE,…" → nakit sayılan fon sembolleri (büyük harfe normalize) */
export function cashFundSymbols(settings: AllData["settings"]): Set<string> {
  return new Set(
    (settings.cash_funds || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  );
}

/** Nakit sayılan fonlardan elde tutulanlar, TRY değerine göre büyükten küçüğe */
export type CashFundHolding = { symbol: string; qty: number; price: number; valueTry: number };
export function cashFundHoldings(data: AllData, rates: Rates = { usdTry: 0 }): CashFundHolding[] {
  const wanted = cashFundSymbols(data.settings);
  if (wanted.size === 0) return [];
  const qty = new Map<string, number>();
  for (const t of data.trades) {
    if (t.asset_type !== "FON") continue;
    const sym = t.symbol.toUpperCase();
    if (!wanted.has(sym)) continue;
    qty.set(sym, (qty.get(sym) || 0) + qtyDelta(t)); // TEMETTÜ adedi değiştirmez, BEDELSİZ artırır
  }
  const out: CashFundHolding[] = [];
  qty.forEach((q, symbol) => {
    if (q <= 0) return;
    const p = data.prices.find((x) => x.asset_type === "FON" && x.symbol.toUpperCase() === symbol);
    if (!p || !(p.price > 0)) return; // fiyatı bilinmeyen fon için tutar önerilemez
    out.push({ symbol, qty: q, price: p.price, valueTry: convert(q * p.price, (p.currency as Currency) ?? "TRY", "TRY", rates) });
  });
  return out.sort((a, b) => b.valueTry - a.valueTry);
}

/** Pencerede saf nakitin en derin noktası. `amount` açığı kapatan tutar (pozitif), `firstNegative`
    sıkıntının başladığı gün — mesajda "ne zaman" bunu söyler, tutar ise en derin noktadan gelir. */
export type CashGap = { amount: number; firstNegative: Day; deepest: Day };
export function cashGap(days: Day[], withinDays = 7): CashGap | null {
  const win = days.slice(0, Math.max(0, withinDays) + 1); // days[0] = bugün → +1 gün dahil
  let deepest: Day | null = null, firstNegative: Day | null = null;
  for (const d of win) {
    if (d.bal >= 0) continue;
    if (!firstNegative) firstNegative = d;
    if (!deepest || d.bal < deepest.bal) deepest = d;
  }
  if (!deepest || !firstNegative) return null;
  return { amount: -deepest.bal, firstNegative, deepest };
}

/** Öneri: hangi fondan ne kadar, en geç ne zaman bozulmalı.
    `sellBy` = açığın başladığı günden bir gün önce (bugünden geriye gitmez — geçmişe satış olmaz).
    `covered` false ise fon açığı tamamen kapatmıyor; tutar yine de fonun tamamıyla sınırlanır,
    çünkü olmayan parayı önermek kullanıcıyı yanlış işleme sürükler. */
export type FundSellSuggestion = {
  amount: number; fund: CashFundHolding; gap: CashGap; sellBy: Date; covered: boolean;
};
export function fundSellSuggestion(
  days: Day[], data: AllData, rates: Rates = { usdTry: 0 }, withinDays = 7,
): FundSellSuggestion | null {
  const gap = cashGap(days, withinDays);
  if (!gap) return null;
  const fund = cashFundHoldings(data, rates)[0];
  if (!fund || fund.valueTry <= 0) return null;
  const sellBy = new Date(gap.firstNegative.date);
  sellBy.setDate(sellBy.getDate() - 1);
  const today = days[0]?.date;
  if (today && sellBy < today) sellBy.setTime(today.getTime());
  return {
    amount: Math.min(gap.amount, fund.valueTry),
    fund, gap, sellBy, covered: fund.valueTry >= gap.amount,
  };
}
