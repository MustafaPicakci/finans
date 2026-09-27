/* ============================================================================
   Alan haritası — hangi kolon ZARFA girer, hangisi düz kalır (E2EE aşama 5)
   ----------------------------------------------------------------------------
   SAF VERİ: import yok, kripto kodu yok. Bu yüzden `@finans/crypto/map` alt yolundan
   sunucuya da açılır (şema kapısı ve göç SQL'i bunu okur) — sunucunun kripto paketine
   bağlanmaması kuralının tek, bilinçli istisnası (bkz. check-no-crypto.ts).

   Kural (kullanıcı kararı, docs/E2EE.md §1): kişisel harcama, gelir, bakiye ve adlar
   ZARFA girer; yönlendirme alanları (tarih, FK, tür, sembol, gün) DÜZ kalır. Düz kalan
   her kolonun gerekçesi `DUZ`'de yazılı — şema kapısı sınıflandırılmamış yeni bir kolonu
   derlemede reddeder, yani "kolon ekledim, şifrelemeyi unuttum" sessiz kalamaz. */

/** Tablo → zarfa giren kolonlar. Sıra ÖNEMSİZ (zarf bir JSON nesnesidir). */
export const ZARF = {
  categories: ["name"],
  portfolios: ["name", "note"],
  oneoffs: ["name", "amount"],
  loans: ["name", "amount", "total"],
  /* ——— defter grubu (aşama 5c): hepsi account_entries üzerinden birbirine bağlı ——— */
  accounts: ["name", "last_recon_balance"],
  account_entries: ["amount", "note"],
  transactions: ["name", "amount"],
  card_txs: ["name", "amount", "installments"],
  cards: ["name", "limit_amount"],
  transfers: ["amount", "note"],
  trades: ["qty", "price", "fee"],
  deposits: ["name", "principal", "rate", "term_days", "withholding"],
  recurring: ["name"],
  recurring_amounts: ["amount"],
  /* ——— asistan deposu (aşama 5d): kullanıcının yazdığı cümleler ve planların argümanları.
     "Migros'a 450 harcadım" defterde zarflıyken sohbet geçmişinde düz dursaydı şifreleme
     bir süs olurdu — asistan kullanan herkesin harcamaları buradan okunurdu. ——— */
  ai_conversations: ["title"],
  ai_messages: ["content"],
  ai_plans: ["actions"],
  ai_actions: ["summary"],
} as const satisfies Record<string, readonly string[]>;

export type ZarfliTablo = keyof typeof ZARF;

/** Sunucu zarflı kolona göre SIRALAYAMAZ. `/api/all` eskiden bu tabloları ada göre
    sıralıyordu; çözme adımı o sırayı istemcide yeniden kurar (yoksa listeler sessizce
    id sırasına dönerdi). */
export const SIRA: Partial<Record<ZarfliTablo, string>> = {
  categories: "name",
  portfolios: "name",
};

/** Düz kalan kolonlar ve GEREKÇELERİ. Ortak kolonlar (`id`, `user_id`, `enc`) tüm tablolar için. */
export const ORTAK_DUZ = {
  id: "kimlik — ilişki kurulamazsa şema çalışmaz",
  user_id: "kiracı ayrımı — sunucunun asıl işi",
  enc: "zarfın kendisi",
} as const;

export const DUZ: Record<ZarfliTablo, Record<string, string>> = {
  categories: { kind: "gelir/gider ayrımı — filtre ve kategori seçicisi; tutar değil", color: "arayüz rengi" },
  portfolios: {},
  oneoffs: { date: "tarih — projeksiyon/takvim sıralaması; tutar ve ad zarfta" },
  loans: { first_date: "ilk taksit tarihi — takvim; tutar ve ad zarfta" },
  accounts: { kind: "hesap türü (banka/nakit/aracı) — ikon ve gruplama", last_recon_date: "son mutabakat günü — 'bayat' hatırlatması; tutarı zarfta" },
  account_entries: {
    account_id: "FK", date: "tarih — defter sıralaması", kind: "hareket türü (işlem/virman/açılış…) — tutar değil",
    source_table: "geri alma bununla WHERE yapar (revertEntries) — şifrelenirse düzenle/sil çalışmaz",
    source_id: "geri alma bununla WHERE yapar (revertEntries)", created_at: "sunucunun yazma damgası",
  },
  transactions: { date: "tarih — sıralama, dönem süzgeci", category_id: "FK", account_id: "FK" },
  card_txs: { card_id: "FK", date: "tarih — ekstreye düşme (kesim günü) hesabı istemcide ama sıralama sunucuda", category_id: "FK" },
  cards: { statement_day: "kesim günü — ekstre takvimi", due_day: "son ödeme günü — ekstre takvimi", pay_account_id: "FK (ödeme talimatı)", pay_since: "talimatın başladığı gün — otomatik ödeme bundan önceki vadeye dokunmaz" },
  transfers: { date: "tarih", from_account_id: "FK", to_account_id: "FK" },
  trades: {
    date: "tarih", asset_type: "varlık türü — fiyat kaynağı seçimi", side: "işlem türü (ALIŞ/SATIŞ/…) — adet/fiyat değil",
    symbol: "KULLANICI KARARI: sembol düz — fiyat cron'u neyi çekeceğini buradan bilir", currency: "para birimi — fiyat çevrimi",
    account_id: "FK", portfolio_id: "FK",
  },
  deposits: { open_date: "açılış tarihi — vade takvimi", account_id: "FK" },
  recurring: {
    kind: "gelir/gider", day: "ayın günü — takvim", from_month: "yaşam penceresi", to_month: "yaşam penceresi",
    account_id: "FK", card_id: "FK", category_id: "FK", auto: "otomatik gerçekleştirme bayrağı",
    auto_since: "otomatik talimatın başladığı gün — bundan önceki occurrence yazılmaz",
  },
  recurring_amounts: { recurring_id: "FK + birincil anahtar", from_month: "BİRİNCİL ANAHTAR — şifreli olsa ON CONFLICT hiç tetiklenmezdi" },
  ai_conversations: {
    created_at: "açılış damgası", updated_at: "SIRALAMA + keyset sayfalama anahtarı — şifreli olsa liste sayfalanamazdı",
  },
  ai_messages: {
    conversation_id: "FK", role: "kullanıcı/asistan — mesaj başına hız sınırı buna bakar; içerik değil",
    created_at: "damga", plan_id: "sonuç mesajını plana bağlar ('geri al' düğmesi)",
  },
  ai_plans: {
    plan_id: "BİRİNCİL ANAHTAR — tek kullanımlık kilit bununla WHERE yapar", conversation_id: "FK",
    created_at: "24 saatlik geçerlilik sunucuda ölçülür", consumed_at: "TEK KULLANIMLIK KİLİT — atomik UPDATE ... WHERE consumed_at IS NULL",
  },
  ai_actions: {
    plan_id: "plana bağ", conversation_id: "FK", created_at: "damga",
    tool: "araç adı (gider_ekle, virman…) — hareket TÜRÜ, account_entries.kind gibi; tutar/ad değil",
    undo_method: "geri alma isteği (hep DELETE)", undo_path: "geri alınacak kaydın yolu — yalnız tür + id (/transactions/42)",
    undone_at: "geri alındı işareti — 'geri alınabilir' sayacı buna bakar",
  },
};

/** Zarf biçimleri. `p1` = DÜZ METİN zarf (aşama 5: tesisat şifrelemeden önce çalışsın,
    psql ile okunabilsin); `v1` = AES-GCM (aşama 6). Önek değeri kendini tarif eder: göç
    yeniden çalıştırılabilir, hangi satırın hangi biçimde olduğu tek bakışta görülür. */
export const ZARF_DUZ = "p1:";
