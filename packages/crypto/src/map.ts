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
};

/** Zarf biçimleri. `p1` = DÜZ METİN zarf (aşama 5: tesisat şifrelemeden önce çalışsın,
    psql ile okunabilsin); `v1` = AES-GCM (aşama 6). Önek değeri kendini tarif eder: göç
    yeniden çalıştırılabilir, hangi satırın hangi biçimde olduğu tek bakışta görülür. */
export const ZARF_DUZ = "p1:";
