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

/** Bir işlemin, gerçekleştiği andaki pozisyona etkisi — işlem geçmişi ekranının satır modeli.
    Tutarlar işlemin kendi para birimindedir (`trade.currency`). */
export type TradeEntry = {
  trade: Trade;
  /** işlemden ÖNCEKİ adet ve ağırlıklı ortalama maliyet (aynı sembol+tür, aynı portföy kapsamında) */
  qtyBefore: number; avgBefore: number;
  /** işlemden SONRAKİ adet ve ortalama maliyet — "ort. 250 → 265" gösterimi buradan gelir */
  qtyAfter: number; avgAfter: number;
  /** ALIŞ'ta ödenen toplam (adet×fiyat + komisyon), SATIŞ'ta ele geçen (adet×fiyat − komisyon) */
  cash: number;
  /** yalnız SATIŞ'ta: adet × (satış − o anki ort. maliyet) − komisyon; ALIŞ'ta 0 */
  realized: number;
  /** SATIŞ pozisyonu tamamen kapattıysa (sonrasında adet 0) — "pozisyon kapandı" rozeti için */
  closed: boolean;
};

/**
 * İşlemleri kronolojik işleyip her birinin pozisyona etkisini çıkarır (Faz 12 — hareket geçmişi).
 * `positions()` ile **aynı** maliyet matematiğini kullanır (ağırlıklı ortalama, kapanınca sıfırlanma),
 * farkı: sonucu değil ara adımları verir — "hangi hisse ne zaman eklendi/çıkarıldı, ortalama nasıl değişti".
 *
 * Kapsam çağıranındır: tüm işlemleri verirsen birleşik defter, tek portföyün işlemlerini verirsen
 * o portföyün defteri çıkar (grup başına ayrı ortalama maliyet — bkz. `groupTradesByPortfolio`).
 * Dönüş sırası **kronolojiktir** (eski → yeni); ekranda ters çevrilir.
 */
export function tradeLedger(trades: Trade[]): TradeEntry[] {
  const st = new Map<string, { qty: number; cost: number }>();
  return [...trades]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((t) => {
      const k = `${t.asset_type}:${t.symbol}`;
      if (!st.has(k)) st.set(k, { qty: 0, cost: 0 });
      const p = st.get(k)!;
      const qtyBefore = p.qty;
      const avgBefore = p.qty > 0 ? p.cost / p.qty : 0;
      const fee = t.fee || 0;
      let realized = 0;
      let cash: number;
      if (t.side === "ALIŞ") {
        cash = t.qty * t.price + fee;
        p.qty += t.qty;
        p.cost += cash;
      } else {
        cash = t.qty * t.price - fee;
        realized = t.qty * (t.price - avgBefore) - fee;
        p.cost -= Math.min(t.qty, p.qty) * avgBefore;
        p.qty -= t.qty;
      }
      return {
        trade: t, qtyBefore, avgBefore, qtyAfter: p.qty,
        avgAfter: p.qty > 0 ? p.cost / p.qty : 0,
        cash, realized, closed: t.side === "SATIŞ" && p.qty <= 0,
      };
    });
}

/** Bir işlem kümesinin dönem özeti — geçmiş ekranının başlık rakamları (tek para biriminde toplanır) */
export type TradeSummary = { buy: number; sell: number; fee: number; realized: number; count: number };

/** `entries` tek para birimi içindir (ekran birime göre süzer); TRY/USD karışımı çağıran tarafta ayrılır. */
export function summarizeTrades(entries: TradeEntry[]): TradeSummary {
  return entries.reduce<TradeSummary>((s, e) => ({
    buy: s.buy + (e.trade.side === "ALIŞ" ? e.cash : 0),
    sell: s.sell + (e.trade.side === "SATIŞ" ? e.cash : 0),
    fee: s.fee + (e.trade.fee || 0),
    realized: s.realized + e.realized,
    count: s.count + 1,
  }), { buy: 0, sell: 0, fee: 0, realized: 0, count: 0 });
}

/** Portföy grubu anahtarı: grup id'si, gruplanmamış işlemler için `null` */
export type PortfolioKey = number | null;

/**
 * İşlemleri portföy grubuna göre ayırır (Faz 11). Pozisyonlar grup başına **ayrı** hesaplanır:
 * aynı sembol iki portföyde tutuluyorsa iki bağımsız pozisyondur (ayrı ortalama maliyet, ayrı K/Z) —
 * kullanıcı onları farklı kurumda/stratejide tuttuğu için ayırmıştır, tek pozisyona katlamak yanıltır.
 * Toplam (net varlık) tarafında bir şey değişmez: tüm işlemler tek listede değerlenmeye devam eder.
 */
export function groupTradesByPortfolio(trades: Trade[]): Map<PortfolioKey, Trade[]> {
  const by = new Map<PortfolioKey, Trade[]>();
  for (const t of trades) {
    const k: PortfolioKey = t.portfolio_id ?? null;
    const list = by.get(k);
    if (list) list.push(t); else by.set(k, [t]);
  }
  return by;
}

/** Bir portföy grubunun güncel TRY değeri — grup başlıklarındaki toplam için. */
export function portfolioGroupValueTry(trades: Trade[], prices: AllData["prices"], rates: Rates): number {
  return portfolioValueTry(positions(trades, prices), rates);
}

/** Pozisyon değerlerini (her biri kendi biriminde) TRY'ye çevirip toplar — net varlık ve alokasyon için. */
export function portfolioValueTry(pos: Position[], rates: Rates): number {
  return pos.reduce((s, p) => s + (p.value != null ? convert(p.value, p.currency, "TRY", rates) : 0), 0);
}

export type ValuePoint = { date: string; value: number };

/* ————— DEĞER GRAFİĞİ ARALIKLARI (Faz 13) —————
   Fiyat geçmişi günde bir anlık görüntü tutar (`price_history`), dolayısıyla en küçük çözünürlük
   GÜNDÜR — "1H/1A/1Y" pencereyi daraltır, veriyi sıklaştırmaz. Uzun pencerelerde nokta sayısı
   `bucketValueHistory` ile seyreltilir (her kovanın SON değeri = o haftanın/ayın kapanışı). */

/** Grafik zaman aralığı; `"TÜM"` = eldeki tüm geçmiş */
export type HistoryRange = "1H" | "1A" | "3A" | "6A" | "1Y" | "TÜM";

/** Aralığın gün karşılığı (takvim ayı değil sabit gün — grafik penceresi için yeterli) */
const RANGE_DAYS: Record<Exclude<HistoryRange, "TÜM">, number> = {
  "1H": 7, "1A": 30, "3A": 90, "6A": 180, "1Y": 365,
};

/** `points`'i son N güne kısar (kronolojik sırayı korur). `today` verilmezse bugün. */
export function sliceValueHistory(points: ValuePoint[], range: HistoryRange, today = new Date()): ValuePoint[] {
  if (range === "TÜM") return points;
  const from = new Date(today);
  from.setDate(from.getDate() - RANGE_DAYS[range]);
  const iso = from.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= iso);
}

/**
 * Nokta sayısını en çok `maxPoints`'e indirir: seri eşit kovalara bölünür, her kovadan o kovanın
 * **son** noktası alınır (kapanış mantığı). İlk ve son nokta her zaman korunur — aralık başı/sonu
 * kayarsa "dönem değişimi" yanlış çıkardı.
 */
export function bucketValueHistory(points: ValuePoint[], maxPoints: number): ValuePoint[] {
  if (maxPoints < 2 || points.length <= maxPoints) return points;
  const size = points.length / maxPoints;
  const out: ValuePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const end = Math.min(points.length - 1, Math.floor((i + 1) * size) - 1);
    const p = points[Math.max(end, 0)];
    if (p && out.at(-1)?.date !== p.date) out.push(p);
  }
  if (out.at(-1)?.date !== points.at(-1)!.date) out.push(points.at(-1)!);
  if (out[0]?.date !== points[0].date) out.unshift(points[0]);
  return out;
}

/** Aralığın ilk → son değişimi (mutlak + yüzde). Nokta yoksa/başlangıç 0 ise `pct` null. */
export function historyChange(points: ValuePoint[]): { abs: number; pct: number | null } {
  if (points.length < 2) return { abs: 0, pct: null };
  const first = points[0].value, last = points.at(-1)!.value;
  return { abs: last - first, pct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null };
}

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
