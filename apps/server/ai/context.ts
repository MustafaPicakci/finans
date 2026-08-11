/* ============================================================================
   Asistan bağlamı (Faz 22)
   ----------------------------------------------------------------------------
   Model "Garanti hesabıma geldi" / "Akbank ekstresini ödedim" cümlelerini ancak
   kullanıcının TANIM kayıtlarını görürse id'ye çevirebilir. Bu dosya her istekte
   o tanımları kompakt biçimde toplar — işlem geçmişi DEĞİL (o çok büyük; ona
   ihtiyaç olursa `kayit_ara` okuma aracı var), yalnız ad↔id sözlüğü ve birkaç
   yön verici sayı. Bağlam ne kadar küçükse ücretsiz kotalar o kadar uzun yeter. */

import { db, todayLocal } from "../db.js";

export type UserContext = {
  bugun: string;
  hesaplar: { id: number; ad: string; tur: string; bakiye: number }[];
  kartlar: { id: number; ad: string; kesim_gunu: number; son_odeme_gunu: number }[];
  kategoriler: { id: number; ad: string; tur: string }[];
  portfoy_gruplari: { id: number; ad: string }[];
  duzenli_kalemler: { id: number; ad: string; tur: string; gun: number }[];
  portfoydeki_semboller: { sembol: string; tur: string; para_birimi: string; guncel_fiyat: number | null }[];
  usd_try: number | null;
  nakit_sayilan_fonlar: string[];
};

const r2 = (n: number) => Math.round(Number(n) * 100) / 100;

export async function buildContext(uid: number): Promise<UserContext> {
  const [accounts, cards, categories, portfolios, recurring, symbols, autoPrices, userPrices, settings] = await Promise.all([
    db.all<any>("SELECT id, name, kind, balance FROM accounts WHERE user_id=? ORDER BY id", uid),
    db.all<any>("SELECT id, name, statement_day, due_day FROM cards WHERE user_id=? ORDER BY id", uid),
    db.all<any>("SELECT id, name, kind FROM categories WHERE user_id=? ORDER BY name", uid),
    db.all<any>("SELECT id, name FROM portfolios WHERE user_id=? ORDER BY name", uid),
    db.all<any>("SELECT id, name, kind, day FROM recurring WHERE user_id=? ORDER BY day", uid),
    db.all<any>("SELECT DISTINCT symbol, asset_type, currency FROM trades WHERE user_id=?", uid),
    db.all<any>("SELECT symbol, asset_type, price FROM prices"),
    db.all<any>("SELECT symbol, asset_type, price FROM user_prices WHERE user_id=?", uid),
    db.all<{ key: string; value: string }>(
      "SELECT key, value FROM settings UNION ALL SELECT key, value FROM user_settings WHERE user_id=?", uid,
    ),
  ]);
  const pm = new Map<string, number>(autoPrices.map((p) => [`${p.asset_type}:${p.symbol}`, Number(p.price)]));
  for (const p of userPrices) pm.set(`${p.asset_type}:${p.symbol}`, Number(p.price)); // kullanıcının elle fiyatı kazanır
  const st = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return {
    bugun: todayLocal(),
    hesaplar: accounts.map((a) => ({ id: a.id, ad: a.name, tur: a.kind ?? "banka", bakiye: r2(a.balance) })),
    kartlar: cards.map((c) => ({ id: c.id, ad: c.name, kesim_gunu: c.statement_day, son_odeme_gunu: c.due_day })),
    kategoriler: categories.map((c) => ({ id: c.id, ad: c.name, tur: c.kind })),
    portfoy_gruplari: portfolios.map((p) => ({ id: p.id, ad: p.name })),
    duzenli_kalemler: recurring.map((r) => ({ id: r.id, ad: r.name, tur: r.kind, gun: r.day })),
    portfoydeki_semboller: symbols.map((s) => ({
      sembol: s.symbol, tur: s.asset_type, para_birimi: s.currency ?? "TRY",
      guncel_fiyat: pm.has(`${s.asset_type}:${s.symbol}`) ? r2(pm.get(`${s.asset_type}:${s.symbol}`)!) : null,
    })),
    usd_try: st.fx_usd_try ? r2(Number(st.fx_usd_try)) : null,
    nakit_sayilan_fonlar: (st.cash_funds ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

/** Onay kartlarındaki id→ad çözümü de aynı bağlamdan beslenir (agent.ts kullanır). */
export function nameLookup(ctx: UserContext) {
  const find = <T extends { id: number; ad: string }>(list: T[], label: string) => (id: unknown) =>
    list.find((x) => x.id === Number(id))?.ad ?? `${label} #${id}`;
  return {
    account: find(ctx.hesaplar, "hesap"),
    card: find(ctx.kartlar, "kart"),
    category: find(ctx.kategoriler, "kategori"),
    portfolio: find(ctx.portfoy_gruplari, "grup"),
    recurring: find(ctx.duzenli_kalemler, "kalem"),
  };
}
