import { db } from "./db.js";

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };

/** "4.350,25" → 4350.25 */
function parseTr(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

async function yahoo(sym: string): Promise<number | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
      { headers: UA },
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

async function tefas(code: string): Promise<number | null> {
  try {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    const body = new URLSearchParams({
      fontip: "YAT",
      fonkod: code,
      bastarih: fmt(new Date(Date.now() - 10 * 864e5)),
      bittarih: fmt(new Date()),
    });
    const r = await fetch("https://www.tefas.gov.tr/api/DB/BindHistoryInfo", {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const rows: any[] = j?.data ?? [];
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const p = last?.FIYAT ?? last?.fiyat;
    return typeof p === "number" ? p : parseTr(p);
  } catch {
    return null;
  }
}

/** GRAM, CEYREK, YARIM, TAM, ONS, GUMUS → TRY satış fiyatı */
async function gold(sym: string): Promise<number | null> {
  try {
    const r = await fetch("https://finans.truncgil.com/today.json", { headers: UA });
    if (!r.ok) return null;
    const j: any = await r.json();
    const map: Record<string, string[]> = {
      GRAM: ["gram-altin", "GRA", "Gram Altın"],
      CEYREK: ["ceyrek-altin", "CEY", "Çeyrek Altın"],
      YARIM: ["yarim-altin", "YAR", "Yarım Altın"],
      TAM: ["tam-altin", "TAM", "Tam Altın"],
      ONS: ["ons", "ONS", "Ons"],
      GUMUS: ["gumus", "GUM", "Gümüş"],
    };
    for (const key of map[sym] ?? [sym]) {
      const e = j[key];
      if (!e) continue;
      const p = parseTr(e["Satış"] ?? e["Satis"] ?? e.selling ?? e.Selling);
      if (p) return p;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchPrice(assetType: string, symbol: string, usdTry: number | null): Promise<number | null> {
  switch (assetType) {
    case "BIST":
      return yahoo(`${symbol}.IS`);
    case "DOVIZ":
      return symbol === "USD" && usdTry ? usdTry : yahoo(`${symbol}TRY=X`);
    case "KRIPTO": {
      const usd = await yahoo(`${symbol}-USD`);
      return usd && usdTry ? usd * usdTry : null;
    }
    case "FON":
      return tefas(symbol);
    case "ALTIN":
      return gold(symbol);
    default:
      return null;
  }
}

export type RefreshResult = { symbol: string; asset_type: string; ok: boolean; price?: number };

export async function refreshAll(): Promise<RefreshResult[]> {
  const held = db
    .prepare("SELECT DISTINCT asset_type, symbol FROM trades")
    .all() as { asset_type: string; symbol: string }[];
  if (!held.length) return [];
  const usdTry = await yahoo("USDTRY=X");
  const upsert = db.prepare(
    `INSERT INTO prices (symbol, asset_type, price, source, updated_at) VALUES (?,?,?,?,datetime('now','localtime'))
     ON CONFLICT(symbol, asset_type) DO UPDATE SET price=excluded.price, source=excluded.source, updated_at=excluded.updated_at`,
  );
  /* günde bir satır: aynı gün içindeki tekrar tazelemeler o günün fiyatını günceller, geçmişi çoğaltmaz */
  const upsertHistory = db.prepare(
    `INSERT INTO price_history (symbol, asset_type, date, price) VALUES (?,?,date('now','localtime'),?)
     ON CONFLICT(symbol, asset_type, date) DO UPDATE SET price=excluded.price`,
  );
  const out: RefreshResult[] = [];
  for (const h of held) {
    const p = await fetchPrice(h.asset_type, h.symbol, usdTry);
    if (p != null) { upsert.run(h.symbol, h.asset_type, p, "auto"); upsertHistory.run(h.symbol, h.asset_type, p); }
    out.push({ symbol: h.symbol, asset_type: h.asset_type, ok: p != null, price: p ?? undefined });
  }
  return out;
}
