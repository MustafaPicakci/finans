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
   RapidAPI üzerindeki resmi olmayan bir aracı kullanılıyor (opsiyonel, RAPIDAPI_KEY /
   RAPIDAPI_KEY_2 gerekir). `funds/historical` (tarih aralığı) yerine `funds/returns-by-date`
   (tek gün) kullanılıyor: historical, aralıktaki HER GÜN için ayrı satır döndüğünden bir
   fon türü tek başına 8500+ satır/35 sayfaya çıkıyordu. returns-by-date tek bir güne ait
   TÜM fon türlerini TEK istekte döner (tür başına ayrı istek gerekmez) ve
   lastBusinessDay=true ile hafta sonu/tatili otomatik son iş gününe çevirir. */
const TEFAS_HOST = "tefas-api.p.rapidapi.com";

async function fetchTefasSnapshot(neededCodes: Set<string>): Promise<Map<string, number>> {
  /* iki anahtar da tanımlıysa: birinci kota/hız sınırına takılırsa (429) istek ikinciyle tekrar denenir */
  const keys = [process.env.RAPIDAPI_KEY, process.env.RAPIDAPI_KEY_2].filter((k): k is string => !!k);
  const map = new Map<string, number>();
  if (!keys.length || !neededCodes.size) return map;

  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const today = fmt(new Date());
  const url = `https://${TEFAS_HOST}/api/v1/funds/returns-by-date?date=${today}&lastBusinessDay=true`;

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    try {
      const r = await fetch(url, { headers: { "x-rapidapi-host": TEFAS_HOST, "x-rapidapi-key": keys[keyIndex] } });
      if (r.status === 429) {
        console.error(`[prices] TEFAS anahtarı kota/hız sınırına takıldı${keyIndex + 1 < keys.length ? ", ikinci anahtara geçiliyor" : ", başka anahtar yok"}.`);
        continue;
      }
      if (!r.ok) { console.error(`[prices] TEFAS returns-by-date HTTP=${r.status}`); break; }
      const j: any = await r.json();
      const groups: { fund_type?: string; funds?: { fund_code?: string; price?: number }[] }[] = j?.data ?? [];
      groups.forEach((g) => (g.funds ?? []).forEach((f) => { if (f.fund_code && typeof f.price === "number") map.set(f.fund_code, f.price); }));
      console.error(`[prices] TEFAS returns-by-date: ${groups.length} tür, toplam ${map.size} fon fiyatı; aranan ${[...neededCodes].filter((c) => map.has(c)).length}/${neededCodes.size} bulundu.`);
      break;
    } catch (e) {
      console.error("[prices] TEFAS returns-by-date hata:", e);
      break;
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
  const neededCodes = new Set(heldFon.map((h) => h.symbol));
  const alreadySucceededToday = lastFetch === today;
  const tefasMap = heldFon.length && !alreadySucceededToday ? await fetchTefasSnapshot(neededCodes) : null;
  /* bugün için gerçekten denendi ama (kota/hız sınırı, ağ hatası vb.) başarısız oldu —
     bu durumda prices tablosundaki bayat (önceki günden kalma) fiyatı "başarılı" gibi
     göstermek yanıltıcı olur; diğer varlık türleriyle tutarlı şekilde ok:false dönülür */
  const tefasAttemptFailed = heldFon.length > 0 && !alreadySucceededToday && (!tefasMap || tefasMap.size === 0);
  if (tefasMap && tefasMap.size > 0) {
    db.prepare("INSERT INTO settings (key,value) VALUES ('tefas_last_fetch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);
    /* aranan fonları bulana kadar taranan sayfalarda görülen TÜM fonlar (bedavaya gelen
       yan veri) saklanır, sadece tuttuklarımız değil — aynı gün yeni bir fon eklenirse
       fiyatı zaten hazır olabilir. */
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
      if (tefasAttemptFailed) {
        out.push({ symbol: h.symbol, asset_type: h.asset_type, ok: false });
        continue;
      }
      /* bugün başarıyla çekildi (bu çağrıda ya da daha önce) — prices tablosundan oku */
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
