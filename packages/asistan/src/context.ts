/* ============================================================================
   Asistan bağlamı (Faz 22; E2EE aşama 4'te saf fonksiyon oldu)
   ----------------------------------------------------------------------------
   Model "Garanti hesabıma geldi" / "Akbank ekstresini ödedim" cümlelerini ancak
   kullanıcının TANIM kayıtlarını görürse id'ye çevirebilir. Bu dosya o tanımları
   kompakt biçimde toplar — işlem geçmişi DEĞİL (o çok büyük; ona ihtiyaç olursa
   `kayit_ara` okuma aracı var), yalnız ad↔id sözlüğü ve birkaç yön verici sayı.

   Eskiden her mesajda veritabanına 9 sorgu atıyordu. Artık `AllData` alıyor: sunucu
   onu `loadAllData` ile, tarayıcı zaten bellekte tuttuğu kopyadan verir. Şifreli
   dünyada (aşama 6) yalnız ikincisi mümkün — sunucu adları ve tutarları okuyamaz. */

import { balancesByAccount, type AllData } from "@finans/engine";

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
const adSirali = <T extends { name: string }>(xs: readonly T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name, "tr"));

export function buildContext(data: AllData, bugun: string): UserContext {
  const bakiye = balancesByAccount(data.account_entries);
  const fiyat = new Map(data.prices.map((p) => [`${p.asset_type}:${p.symbol}`, Number(p.price)]));
  /* Sembol listesi İŞLEMLERDEN (tutulan her şey); tür + para birimiyle tekilleştirilir. */
  const semboller = new Map<string, { sembol: string; tur: string; para_birimi: string }>();
  for (const t of data.trades) {
    const k = `${t.asset_type}:${t.symbol}`;
    if (!semboller.has(k)) semboller.set(k, { sembol: t.symbol, tur: t.asset_type, para_birimi: t.currency ?? "TRY" });
  }
  const st = data.settings;
  return {
    bugun,
    hesaplar: [...data.accounts].sort((a, b) => a.id - b.id)
      .map((a) => ({ id: a.id, ad: a.name, tur: a.kind ?? "banka", bakiye: r2(bakiye.get(a.id) ?? 0) })),
    kartlar: [...data.cards].sort((a, b) => a.id - b.id)
      .map((c) => ({ id: c.id, ad: c.name, kesim_gunu: c.statement_day, son_odeme_gunu: c.due_day })),
    kategoriler: adSirali(data.categories).map((c) => ({ id: c.id, ad: c.name, tur: c.kind })),
    portfoy_gruplari: adSirali(data.portfolios).map((p) => ({ id: p.id, ad: p.name })),
    duzenli_kalemler: [...data.recurring].sort((a, b) => a.day - b.day)
      .map((r) => ({ id: r.id, ad: r.name, tur: r.kind, gun: r.day })),
    portfoydeki_semboller: [...semboller.entries()].map(([k, s]) => ({
      ...s, guncel_fiyat: fiyat.has(k) ? r2(fiyat.get(k)!) : null,
    })),
    usd_try: st.fx_usd_try ? r2(Number(st.fx_usd_try)) : null,
    nakit_sayilan_fonlar: (st.cash_funds ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

/** Onay kartlarındaki id→ad çözümü de aynı bağlamdan beslenir. */
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
