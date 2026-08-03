import type { AllData, AssetType, Currency, Trade } from "@finans/engine";

/* ————— AKILLI HATIRLAMA —————
   Formlar geçmiş kayıtlardan öğrenir: aynı adı ikinci kez girerken tutar/kategori/hesap
   (kartta: kart/taksit) kendiliğinden dolar. Tamamı istemci tarafında `AllData`'dan türetilir —
   sunucuda ek uç yok, ek tablo yok. Sıralama = sıklık × tazelik: son 90 günde geçen kayıt
   iki kat sayılır, böylece "eskiden çok girdiğim ama artık girmediğim" kalemler öne çıkmaz. */

/** Ad eşleştirmesi büyük/küçük harf ve boşluk duyarsızdır ("migros" == "Migros ") */
export const normName = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");

const RECENT_DAYS = 90;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
/** sıklık × tazelik: son 90 gündeki her geçiş 2, daha eskisi 1 puan */
const scoreOf = (dates: string[]) => {
  const cut = daysAgo(RECENT_DAYS);
  return dates.reduce((s, d) => s + (d >= cut ? 2 : 1), 0);
};

/** Bir gelir/gider kaleminin hatırlanan hali: son kullanılan tutar/kategori/hesap */
export type KalemSuggestion = {
  name: string; type: "gider" | "gelir"; amount: number;
  category_id: number | null; account_id: number | null;
  count: number; score: number; last: string;
};

/** `transactions` defterinden ada göre gruplanmış öneriler (en yüksek puan önce) */
export function kalemSuggestions(data: AllData): KalemSuggestion[] {
  const by = new Map<string, { s: KalemSuggestion; dates: string[] }>();
  for (const t of data.transactions) {
    const key = normName(t.name);
    if (!key) continue;
    const e = by.get(key);
    if (!e) {
      by.set(key, {
        dates: [t.date],
        s: {
          name: t.name.trim(), type: t.amount < 0 ? "gider" : "gelir", amount: Math.abs(t.amount),
          category_id: t.category_id, account_id: t.account_id, count: 1, score: 0, last: t.date,
        },
      });
      continue;
    }
    e.dates.push(t.date);
    e.s.count++;
    // en son tarihli kayıt "hatırlanan" değerleri belirler (tutar/kategori/hesap güncel kalsın)
    if (t.date >= e.s.last) {
      e.s = { ...e.s, name: t.name.trim(), type: t.amount < 0 ? "gider" : "gelir", amount: Math.abs(t.amount), category_id: t.category_id, account_id: t.account_id, last: t.date };
    }
  }
  return [...by.values()]
    .map(({ s, dates }) => ({ ...s, score: scoreOf(dates) }))
    .sort((a, b) => b.score - a.score || b.last.localeCompare(a.last));
}

/** Kart harcamalarının hatırlanan hali */
export type CardTxSuggestion = {
  name: string; amount: number; card_id: number; installments: number;
  count: number; score: number; last: string;
};

export function cardTxSuggestions(data: AllData): CardTxSuggestion[] {
  const by = new Map<string, { s: CardTxSuggestion; dates: string[] }>();
  for (const t of data.card_txs) {
    const key = normName(t.name);
    if (!key) continue;
    const e = by.get(key);
    if (!e) {
      by.set(key, { dates: [t.date], s: { name: t.name.trim(), amount: t.amount, card_id: t.card_id, installments: t.installments || 1, count: 1, score: 0, last: t.date } });
      continue;
    }
    e.dates.push(t.date);
    e.s.count++;
    if (t.date >= e.s.last) e.s = { ...e.s, name: t.name.trim(), amount: t.amount, card_id: t.card_id, installments: t.installments || 1, last: t.date };
  }
  return [...by.values()]
    .map(({ s, dates }) => ({ ...s, score: scoreOf(dates) }))
    .sort((a, b) => b.score - a.score || b.last.localeCompare(a.last));
}

/** Portföyde daha önce işlem görmüş sembol: tür/para birimi hatırlanır, fiyat `prices`'tan gelir */
export type SymbolSuggestion = {
  symbol: string; asset_type: AssetType; currency: Currency;
  price: number | null; account_id: number | null; portfolio_id: number | null; count: number; score: number; last: string;
};

export function symbolSuggestions(data: AllData): SymbolSuggestion[] {
  const by = new Map<string, { s: SymbolSuggestion; dates: string[] }>();
  for (const t of data.trades) {
    const key = `${t.asset_type}:${t.symbol.toUpperCase()}`;
    const e = by.get(key);
    if (!e) {
      by.set(key, { dates: [t.date], s: { symbol: t.symbol.toUpperCase(), asset_type: t.asset_type, currency: t.currency, price: null, account_id: t.account_id ?? null, portfolio_id: t.portfolio_id ?? null, count: 1, score: 0, last: t.date } });
      continue;
    }
    e.dates.push(t.date);
    e.s.count++;
    if (t.date >= e.s.last) e.s = { ...e.s, currency: t.currency, account_id: t.account_id ?? null, portfolio_id: t.portfolio_id ?? null, last: t.date };
  }
  return [...by.values()]
    .map(({ s, dates }) => ({ ...s, score: scoreOf(dates), price: priceOf(data, s.symbol, s.asset_type) }))
    .sort((a, b) => b.score - a.score || b.last.localeCompare(a.last));
}

/** Güncel birim fiyat (`prices` — otomatik veya kullanıcının elle girdiği override) */
export function priceOf(data: AllData, symbol: string, asset_type: AssetType): number | null {
  const p = data.prices.find((x) => x.asset_type === asset_type && x.symbol.toUpperCase() === symbol.trim().toUpperCase());
  return p && p.price > 0 ? p.price : null;
}

/** Sembolün fiyatının doğal para birimi — işlem para birimi bununla eşleşmezse fiyat otomatik doldurulmaz */
export function priceCcyOf(data: AllData, symbol: string, asset_type: AssetType): Currency {
  const p = data.prices.find((x) => x.asset_type === asset_type && x.symbol.toUpperCase() === symbol.trim().toUpperCase());
  return (p?.currency as Currency) ?? (asset_type === "KRIPTO" || asset_type === "ETF" ? "USD" : "TRY");
}

/** Bir sembolde elde tutulan miktar — SATIŞ'ta "tümünü sat" kısayolu için */
export function heldQty(trades: Trade[], symbol: string, asset_type: AssetType): number {
  const key = symbol.trim().toUpperCase();
  return trades
    .filter((t) => t.asset_type === asset_type && t.symbol.toUpperCase() === key)
    .reduce((q, t) => q + (t.side === "ALIŞ" ? t.qty : -t.qty), 0);
}

/** "+ Ekle" ekranındaki tek-tık şablon çipleri: en sık girilen kalemler + kart harcamaları */
export type Shortcut =
  | { kind: "kalem"; label: string; sub: string; sug: KalemSuggestion }
  | { kind: "cardtx"; label: string; sub: string; sug: CardTxSuggestion };

export function shortcuts(data: AllData, limit = 6): Shortcut[] {
  const cardName = (id: number) => data.cards.find((c) => c.id === id)?.name ?? "kart";
  /* Düzenli kalemler (kira/maaş/fatura) gerçekleşince deftere yazılır ve sıklık sıralamasında
     tepeye çıkar — ama bir kez tanımlandıkları için elle girilmezler. Çiplerden elenirler. */
  const recurringNames = new Set(data.recurring.map((r) => normName(r.name)));
  // kart ekstresi ödemeleri de otomatik üretilir ("<kart adı> ekstresi")
  for (const c of data.cards) recurringNames.add(normName(`${c.name} ekstresi`));
  const manual = (name: string) => !recurringNames.has(normName(name));
  const all: (Shortcut & { score: number })[] = [
    ...kalemSuggestions(data).filter((s) => s.count >= 2 && manual(s.name)).map((s) => ({
      kind: "kalem" as const, label: s.name, sub: s.type === "gider" ? "gider" : "gelir", sug: s, score: s.score,
    })),
    ...cardTxSuggestions(data).filter((s) => s.count >= 2 && manual(s.name)).map((s) => ({
      kind: "cardtx" as const, label: s.name, sub: cardName(s.card_id), sug: s, score: s.score,
    })),
  ];
  return all.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...s }) => s as Shortcut);
}

/** En son kullanılan portföy grubu — yeni işlem formunun varsayılanı (art arda giriş kolaylığı) */
export function lastUsedPortfolio(data: AllData): number | null {
  const last = [...data.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).at(-1);
  const pid = last?.portfolio_id ?? null;
  return pid != null && data.portfolios.some((p) => p.id === pid) ? pid : null;
}
