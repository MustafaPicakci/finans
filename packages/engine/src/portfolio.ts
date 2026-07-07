import type { AssetType, Trade, AllData } from "./types.js";

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
