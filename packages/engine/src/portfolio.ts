import type { AssetType, Trade, AllData, PriceHistoryEntry } from "./types.js";

export type Position = {
  type: AssetType; sym: string; qty: number; avg: number; realized: number;
  cur: number | null; value: number | null; unreal: number | null; updated: string | null; source: string | null;
};

/** Ağırlıklı ortalama maliyetli portföy; pozisyon kapanıp yeniden açılınca maliyet sıfırlanır */
export function positions(trades: Trade[], prices: AllData["prices"]): Position[] {
  const pm = new Map(prices.map((p) => [`${p.asset_type}:${p.symbol}`, p]));
  const by = new Map<string, { type: AssetType; sym: string; qty: number; cost: number; realized: number }>();
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).forEach((t) => {
    const k = `${t.asset_type}:${t.symbol}`;
    if (!by.has(k)) by.set(k, { type: t.asset_type, sym: t.symbol, qty: 0, cost: 0, realized: 0 });
    const p = by.get(k)!;
    if (t.side === "ALIŞ") { p.qty += t.qty; p.cost += t.qty * t.price + (t.fee || 0); }
    else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      p.realized += t.qty * (t.price - avg) - (t.fee || 0);
      p.cost -= Math.min(t.qty, p.qty) * avg;
      p.qty -= t.qty;
    }
  });
  return [...by.values()].map((p) => {
    const price = pm.get(`${p.type}:${p.sym}`);
    const cur = price?.price ?? null;
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    return {
      type: p.type, sym: p.sym, qty: p.qty, avg, realized: p.realized, cur,
      value: cur != null ? p.qty * cur : null,
      unreal: cur != null && p.qty > 0 ? p.qty * (cur - avg) : null,
      updated: price?.updated_at ?? null,
      source: price?.source ?? null,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

export type ValuePoint = { date: string; value: number };

/**
 * Fiyat geçmişine göre portföy değerinin gün gün seyri — sadece en az bir sembolün
 * fiyatının kaydedildiği günler için üretilir (fiyat geçmişi birikmeden geriye dönük
 * uydurma veri yok). Her sembol için o günden önceki (dahil) en yakın bilinen fiyat
 * kullanılır (forward-fill); hiç fiyatı olmayan sembol o güne katkı vermez.
 */
export function portfolioValueHistory(trades: Trade[], priceHistory: PriceHistoryEntry[]): ValuePoint[] {
  const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const histBySymbol = new Map<string, { date: string; price: number }[]>();
  priceHistory.forEach((h) => {
    const k = `${h.asset_type}:${h.symbol}`;
    if (!histBySymbol.has(k)) histBySymbol.set(k, []);
    histBySymbol.get(k)!.push({ date: h.date, price: h.price });
  });
  histBySymbol.forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));

  const dates = [...new Set(priceHistory.map((h) => h.date))].sort();

  return dates.map((date) => {
    const qty = new Map<string, number>();
    for (const t of sortedTrades) {
      if (t.date > date) break;
      const k = `${t.asset_type}:${t.symbol}`;
      qty.set(k, (qty.get(k) || 0) + (t.side === "ALIŞ" ? t.qty : -t.qty));
    }
    let value = 0;
    qty.forEach((q, k) => {
      if (q <= 0) return;
      const hist = histBySymbol.get(k);
      if (!hist) return;
      let price: number | null = null;
      for (const h of hist) {
        if (h.date > date) break;
        price = h.price;
      }
      if (price != null) value += q * price;
    });
    return { date, value };
  });
}
