import type { AssetType, Currency, Trade, AllData, PriceHistoryEntry } from "./types.js";

export type Position = {
  type: AssetType; sym: string; qty: number; avg: number; realized: number;
  cur: number | null; value: number | null; unreal: number | null; updated: string | null; source: string | null;
  /** Pozisyonun doğal (native) para birimi — avg/cur/value/unreal/realized hep bu birimdedir */
  currency: Currency;
};

/** FX kur seti; şimdilik yalnız USD/TRY. TRY taban birimidir (usdTry = 1 USD kaç TRY). */
export type Rates = { usdTry: number };

/** `amount`'ı `from`'dan `to`'ya çevirir (TRY taban). Kur yoksa/0 ise çeviremezse aynı değeri döner. */
export function convert(amount: number, from: Currency, to: Currency, rates: Rates): number {
  if (from === to) return amount;
  const usdTry = rates.usdTry;
  if (!usdTry || usdTry <= 0) return amount; // kur yok — dönüştürme, çağıran tarafta USD gizli/pasif
  if (from === "USD" && to === "TRY") return amount * usdTry;
  if (from === "TRY" && to === "USD") return amount / usdTry;
  return amount;
}

/** Ağırlıklı ortalama maliyetli portföy; pozisyon kapanıp yeniden açılınca maliyet sıfırlanır.
    Her pozisyon kendi doğal para biriminde (o sembolün işlemlerinin currency'si) hesaplanır. */
export function positions(trades: Trade[], prices: AllData["prices"]): Position[] {
  const pm = new Map(prices.map((p) => [`${p.asset_type}:${p.symbol}`, p]));
  const by = new Map<string, { type: AssetType; sym: string; qty: number; cost: number; realized: number; currency: Currency }>();
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).forEach((t) => {
    const k = `${t.asset_type}:${t.symbol}`;
    if (!by.has(k)) by.set(k, { type: t.asset_type, sym: t.symbol, qty: 0, cost: 0, realized: 0, currency: t.currency ?? "TRY" });
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
      type: p.type, sym: p.sym, qty: p.qty, avg, realized: p.realized, cur, currency: p.currency,
      value: cur != null ? p.qty * cur : null,
      unreal: cur != null && p.qty > 0 ? p.qty * (cur - avg) : null,
      updated: price?.updated_at ?? null,
      source: price?.source ?? null,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Pozisyon değerlerini (her biri kendi biriminde) TRY'ye çevirip toplar — net varlık ve alokasyon için. */
export function portfolioValueTry(pos: Position[], rates: Rates): number {
  return pos.reduce((s, p) => s + (p.value != null ? convert(p.value, p.currency, "TRY", rates) : 0), 0);
}

export type ValuePoint = { date: string; value: number };

/**
 * Fiyat geçmişine göre portföy değerinin gün gün seyri (TRY) — sadece en az bir sembolün
 * fiyatının kaydedildiği günler için üretilir (fiyat geçmişi birikmeden geriye dönük
 * uydurma veri yok). Her sembol için o günden önceki (dahil) en yakın bilinen fiyat
 * kullanılır (forward-fill); hiç fiyatı olmayan sembol o güne katkı vermez.
 * USD-doğal semboller **güncel** FX ile TRY'ye çevrilir (tarihsel FX tutulmuyor —
 * "geçmiş günler bugünkü kurla değerlenir", takvimdeki mevcut yaklaşımla tutarlı).
 */
export function portfolioValueHistory(trades: Trade[], priceHistory: PriceHistoryEntry[], rates: Rates): ValuePoint[] {
  const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const curOf = new Map<string, Currency>(trades.map((t) => [`${t.asset_type}:${t.symbol}`, t.currency ?? "TRY"]));
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
      if (price != null) value += convert(q * price, curOf.get(k) ?? "TRY", "TRY", rates);
    });
    return { date, value };
  });
}
