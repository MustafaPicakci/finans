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

/* TEFAS'ın resmi API'si bot korumasının (F5) arkasında — bkz. docs/PLAN.md. Bunun yerine
   RapidAPI üzerindeki resmi olmayan bir aracı kullanılıyor (opsiyonel, RAPIDAPI_KEY gerekir).
   Tek fon kodu sorgulayan bir uç sunmuyor: fon türü başına (1-5) tüm fonların listesini
   döner — dönen TÜM fonlar saklanır (sadece tuttuklarımız değil), aynı istek maliyetiyle
   kota israf edilmez. NAV günde bir hesaplandığından refreshAll() bunu günde bir kez
   çağırır (bkz. aşağıdaki tefas_last_fetch throttle'ı). */
const TEFAS_HOST = "tefas-api.p.rapidapi.com";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchTefasSnapshot(): Promise<Map<string, number>> {
  const key = process.env.RAPIDAPI_KEY;
  const map = new Map<string, number>();
  if (!key) return map;
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const end = fmt(new Date());
  const start = fmt(new Date(Date.now() - 4 * 864e5)); // hafta sonu/tatil boşluğuna karşı birkaç gün geriye
  for (let fundType = 1; fundType <= 5; fundType++) {
    for (let page = 1; page <= 5; page++) {
      try {
        const url = `https://${TEFAS_HOST}/api/v1/funds/historical/${page}?fundType=${fundType}&startDate=${start}&endDate=${end}&size=250`;
        const r = await fetch(url, { headers: { "x-rapidapi-host": TEFAS_HOST, "x-rapidapi-key": key } });
        if (r.status === 429) {
          /* günlük/saniyelik kota aşıldı — diğer fon türlerini denemek de boşuna, sessizce vazgeç */
          console.error("[prices] TEFAS (RapidAPI) kotası doldu, bu tazelemede fon fiyatı alınamadı.");
          return map;
        }
        if (!r.ok) break;
        const j: any = await r.json();
        const rows: { fund_code?: string; price?: number; date?: string }[] = j?.data ?? [];
        /* aynı fon birden fazla günle gelebilir; artan tarihe göre işleyip en güncel fiyatı bırak */
        [...rows]
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .forEach((row) => { if (row.fund_code && typeof row.price === "number") map.set(row.fund_code, row.price); });
        const hasMore = j?.meta?.has_more;
        await sleep(300); // aynı türün sayfaları arasında küçük bekleme (olası saniyelik kotayı zorlamamak için)
        if (!hasMore) break;
      } catch {
        break;
      }
    }
  }
  return map;
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
    case "ETF": {
      /* ABD/global borsada işlem gören ETF (VOO, QQQ...) — Yahoo sembolü ek son ek istemez */
      const usd = await yahoo(symbol);
      return usd && usdTry ? usd * usdTry : null;
    }
    /* FON burada değil: refreshAll() içinde ayrıca, günde bir kez toplu çekilir (bkz. fetchTefasSnapshot) */
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

  /* TEFAS NAV'ı günde bir hesaplandığından fetchTefasSnapshot() da günde bir kez çağrılır
     (RapidAPI ücretsiz kotasını korumak için) — tefas_last_fetch bugüne eşitse atlanır. */
  const today = (db.prepare("SELECT date('now','localtime') as d").get() as { d: string }).d;
  const lastFetch = (db.prepare("SELECT value FROM settings WHERE key='tefas_last_fetch'").get() as { value: string } | undefined)?.value;
  const heldFon = held.filter((h) => h.asset_type === "FON");
  const tefasMap = heldFon.length && lastFetch !== today ? await fetchTefasSnapshot() : null;
  if (tefasMap && tefasMap.size > 0) {
    db.prepare("INSERT INTO settings (key,value) VALUES ('tefas_last_fetch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);
    /* API zaten fon türü başına TÜM fonların listesini döndürüyor — aynı istek maliyetiyle
       sadece tuttuğumuz sembolleri değil, dönen her fonu saklıyoruz. Böylece kota israf
       edilmiyor ve aynı gün içinde yeni bir fon eklenirse fiyatı zaten hazır olur. */
    db.exec("BEGIN");
    try {
      tefasMap.forEach((price, code) => {
        upsert.run(code, "FON", price, "auto");
        upsertHistory.run(code, "FON", price);
      });
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }
  }

  const out: RefreshResult[] = [];
  for (const h of held) {
    let p: number | null;
    if (h.asset_type === "FON") {
      /* prices tablosu artık (taze çekildiyse ya da önbellekten) güncel — doğrudan oradan oku */
      const existing = db.prepare("SELECT price FROM prices WHERE symbol=? AND asset_type='FON'").get(h.symbol) as { price: number } | undefined;
      out.push({ symbol: h.symbol, asset_type: h.asset_type, ok: existing != null, price: existing?.price });
      continue;
    } else {
      p = await fetchPrice(h.asset_type, h.symbol, usdTry);
    }
    if (p != null) { upsert.run(h.symbol, h.asset_type, p, "auto"); upsertHistory.run(h.symbol, h.asset_type, p); }
    out.push({ symbol: h.symbol, asset_type: h.asset_type, ok: p != null, price: p ?? undefined });
  }
  return out;
}
