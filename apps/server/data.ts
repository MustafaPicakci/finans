import type { AllData, CompanyEvent, CorporateAction } from "@finans/engine";
import { db, nowLocal } from "./db.js";

/* ============================================================================
   Kullanıcının tüm verisi — TEK yükleyici (Faz 35)
   ----------------------------------------------------------------------------
   `GET /api/all`ın gövdesiydi. Asistan da (net varlık, nakit projeksiyonu) aynı veriyi
   ister ve engine fonksiyonları `AllData` bekler; ikinci bir yükleyici yazmak iki şeyi
   birden bozardı:
     • FİYAT BİRLEŞTİRMESİ tekrarlanırdı. Kural: global `prices` otomatik/piyasa fiyatını,
       `user_prices` kullanıcının elle girdiğini tutar ve ÇAKIŞMADA KULLANICI KAZANIR
       (bkz. prices.ts, Faz 5.2.1). Bu birleştirmenin ikinci kopyası, birinde override
       unutulduğu gün asistanın ekrandan FARKLI bir portföy değeri söylemesi demekti.
     • AYAR BİRLEŞTİRMESİ tekrarlanırdı (global fx/tefas + kullanıcının kendi ayarları;
       `cash_funds` buradan okunur ve nakit sayılan fonları belirler).

   `gecmis` bayrağı fiyat/referans geçmişini opsiyonel yapar: onu yalnız portföy değer
   grafiği kullanır (`/api/all`), asistanın hiçbir aracı bakmaz. Bayrak olmasaydı her
   asistan sorusu yüz binlerce satırlık bir tabloyu boşuna çekerdi — `price_history`
   dersinin (CLAUDE.md) aynısı, yalnız ters yönden. */

/** Bugünden 2 yıl öncesi (YYYY-MM-DD) — referans serilerinin gönderim penceresi. */
export function twoYearsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type LoadOpts = {
  /** fiyat geçmişi + referans endeksleri de gelsin mi (yalnız değer grafiği için) */
  gecmis?: boolean;
};

/** Kullanıcının `AllData` tablosu. Tenant scope'u her sorguda `user_id` ile;
    `prices`/`price_history`/`benchmark_history` global piyasa verisidir. */
export async function loadAllData(uid: number, opts: LoadOpts = {}): Promise<AllData> {
  const gecmis = opts.gecmis ?? false;
  const [
    accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs,
    categories, transactions, deposits, recurring_realized, statement_payments, account_entries,
    transfers, autoPrices, userPrices, price_history, benchmark_history, corporate_actions, company_events,
    globalSettings, userSettings,
  ] = await Promise.all([
    db.all("SELECT * FROM accounts WHERE user_id=? ORDER BY id", uid),
    db.all("SELECT * FROM recurring WHERE user_id=? ORDER BY day, id", uid),
    db.all("SELECT recurring_id, from_month, amount FROM recurring_amounts WHERE user_id=? ORDER BY recurring_id, from_month", uid),
    db.all("SELECT * FROM loans WHERE user_id=? ORDER BY id", uid),
    db.all("SELECT * FROM oneoffs WHERE user_id=? ORDER BY date", uid),
    db.all("SELECT * FROM trades WHERE user_id=? ORDER BY date, id", uid),
    db.all("SELECT * FROM portfolios WHERE user_id=? ORDER BY name", uid),
    db.all("SELECT * FROM cards WHERE user_id=? ORDER BY id", uid),
    db.all("SELECT * FROM card_txs WHERE user_id=? ORDER BY date, id", uid),
    db.all("SELECT * FROM categories WHERE user_id=? ORDER BY name", uid),
    db.all("SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC", uid),
    db.all("SELECT * FROM deposits WHERE user_id=? ORDER BY open_date, id", uid),
    db.all("SELECT recurring_id, ym FROM recurring_realized WHERE user_id=?", uid),
    db.all("SELECT card_id, due FROM statement_payments WHERE user_id=?", uid),
    // Faz 15 — hesap hareket defteri: yeniden eskiye (yürüyen bakiye istemcide bugünden geriye çözülür)
    db.all("SELECT * FROM account_entries WHERE user_id=? ORDER BY date DESC, id DESC", uid),
    db.all("SELECT * FROM transfers WHERE user_id=? ORDER BY date DESC, id DESC", uid),
    db.all<any>("SELECT symbol, asset_type, price, source, updated_at, currency FROM prices"),
    db.all<any>("SELECT symbol, asset_type, price, updated_at, currency FROM user_prices WHERE user_id=?", uid),
    /* price_history GLOBAL bir tablodur ve TEFAS tazelemesi bedavaya gelen TÜM fonları
       (yüzlerce) her gün oraya yazar — "yeni fon eklenirse fiyatı hazır olsun" diye, bkz.
       prices.ts. Ama okuma tarafı filtrelemeyince bu, her sayfa açılışında tüm piyasanın
       geçmişini istemciye indirmek demekti: yüz binlerce satıra doğru büyüyen, sürekli
       şişen bir yük (ölçüldü: 770 kB / 5,5 sn). Veri tek yerde kullanılıyor — portföy
       değer grafiği (`portfolioValueHistory`) — ve orada yalnız KULLANICININ işlem yaptığı
       semboller anlamlı. EXISTS ile ona daraltılıyor; grafik değişmez, yük düşer. */
    gecmis
      ? db.all(
          `SELECT ph.* FROM price_history ph
            WHERE EXISTS (SELECT 1 FROM trades t
                           WHERE t.user_id=? AND t.symbol=ph.symbol AND t.asset_type=ph.asset_type)
            ORDER BY ph.date`,
          uid,
        )
      : Promise.resolve([]),
    /* Referans endeksler GLOBAL ve KÜÇÜKTÜR (5 seri × ~500 gün) — price_history'nin aksine
       kullanıcıya göre daraltılamaz, çünkü karşılaştırmanın anlamı zaten "tutmadığın şeye
       göre nasılsın". Yine de 2 yılla sınırlanıyor: grafiğin en geniş penceresi 1Y. */
    gecmis
      ? db.all<{ key: string; date: string; price: number }>(
          "SELECT key, date, price FROM benchmark_history WHERE date >= ? ORDER BY date", twoYearsAgo(),
        )
      : Promise.resolve([]),
    /* Faz 36 — kurumsal olaylar (bedelsiz/temettü). price_history dersinin aynısı: tablo
       GLOBAL ama yalnız KULLANICININ işlem yaptığı semboller anlamlı. `gecmis` kapısının
       arkasında, çünkü bunu tek kullanan arayüzdeki "kaçırılan olay" kartı — asistanın
       okuma araçları için boşuna çekilmesin. */
    gecmis
      /* `AllData` döndüğümüz için satırlar CorporateAction olarak TİPLENİR: `kind`/`asset_type`
         düz `string` bırakılsaydı derleme kapısı, tabloya beklenmeyen bir `kind` yazılmasını
         yakalayamazdı. Şemadaki CHECK yok — tek kapı burası. */
      ? db.all<CorporateAction>(
          `SELECT ca.* FROM corporate_actions ca
            WHERE EXISTS (SELECT 1 FROM trades t
                           WHERE t.user_id=? AND t.symbol=ca.symbol AND t.asset_type=ca.asset_type)
            ORDER BY ca.date`,
          uid,
        )
      : Promise.resolve([]),
    /* Faz 37 — şirket takvimi (bilanço tarihleri). corporate_actions ile aynı iki kural:
       global tablo ama yalnız KULLANICININ sembolleri anlamlı, ve `gecmis` kapısının
       arkasında — tek okuyanı takvim sekmesi, asistanın okuma araçları için boşuna çekilmesin.
       Satır sayısı küçüktür (sembol başına bir) ama kapı tutarlı kalsın: "arayüz mü istiyor,
       asistan mı" ayrımı tek yerden okunabilmeli. */
    gecmis
      ? db.all<CompanyEvent>(
          `SELECT ce.* FROM company_events ce
            WHERE EXISTS (SELECT 1 FROM trades t
                           WHERE t.user_id=? AND t.symbol=ce.symbol AND t.asset_type=ce.asset_type)
            ORDER BY ce.date`,
          uid,
        )
      : Promise.resolve([]),
    db.all<{ key: string; value: string }>("SELECT key, value FROM settings"),
    db.all<{ key: string; value: string }>("SELECT key, value FROM user_settings WHERE user_id=?", uid),
  ]);
  // fiyatlar: global otomatik (piyasa) + kullanıcının elle override'ı (varsa o kazanır, source='manual')
  const pm = new Map<string, any>(autoPrices.map((p) => [`${p.asset_type}:${p.symbol}`, { ...p, source: "auto" }]));
  for (const up of userPrices) pm.set(`${up.asset_type}:${up.symbol}`, { ...up, source: "manual" });
  return {
    accounts, recurring, recurring_amounts, loans, oneoffs, trades, portfolios, cards, card_txs,
    categories, transactions, deposits, recurring_realized, statement_payments, account_entries, transfers,
    prices: [...pm.values()], price_history, benchmark_history, corporate_actions, company_events,
    // global (fx/tefas) + kullanıcı ayarları (horizon/cash_funds); kullanıcı çakışmada kazanır
    settings: Object.fromEntries([...globalSettings, ...userSettings].map((s) => [s.key, s.value])),
    /* SUNUCUNUN "şimdi"si — fiyat yaşı ("12 dk önce çekildi") bunun `prices.updated_at` ile
       farkından çıkar. Tarayıcının saatiyle karşılaştırmak YANLIŞ olurdu: `nowLocal()`
       timezone taşımayan bir duvar saati damgasıdır ve sunucu (Render) UTC'de, kullanıcı
       UTC+3'te — fark hep 3 saat kayar, taze fiyat "3 sa önce" görünürdü. */
    now: nowLocal(),
  };
}
