/* ============================================================================
   Veri anahtarı oturumu (E2EE aşama 6)
   ----------------------------------------------------------------------------
   DEK (veri şifreleme anahtarı) girişte paroladan türeyen KEK ile açılır ve burada
   DIŞA AKTARILAMAZ bir CryptoKey olarak durur: sayfadaki kod onunla şifreleyip çözebilir,
   ama ham baytlarını okuyamaz (bir XSS anahtarı kopyalayıp götüremez, yalnız sayfa
   açıkken kullanabilir).

   IndexedDB'de saklanır, çünkü PWA her açılışta parola sormamalı. Takas docs/E2EE.md'de
   yazılı: tehdit modelindeki karşı taraf SUNUCU, cihaz değil; kilidi açık, çalınmış bir
   cihaza karşı koruma iddiası yok. Çıkışta silinir.

   Kural: OTURUM VAR AMA ANAHTAR YOKSA uygulama açılmaz, yeniden giriş istenir. Anahtarsız
   bir oturum şifreli veriyi okuyamaz ve — daha kötüsü — yazamaz; yarım çalışan bir ekran
   göstermek yerine parolayı bir kez daha sormak doğru olan. (Bu durum: IndexedDB'nin
   temizlenmesi, gizli pencere, aşama 6 öncesinden kalan oturum.) */

export type Anahtar = { userId: number; dek: CryptoKey };

const DB = "finans-e2ee", DEPO = "anahtar", KAYIT = "dek";
let bellek: Anahtar | null = null;

function ac(): Promise<IDBDatabase> {
  return new Promise((ok, hata) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DEPO);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => hata(r.error);
  });
}

async function islem<T>(mod: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await ac();
  try {
    return await new Promise<T>((ok, hata) => {
      const r = fn(db.transaction(DEPO, mod).objectStore(DEPO));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => hata(r.error);
    });
  } finally { db.close(); }
}

/** Şu anki anahtar (yoksa null). Yazma ve okuma yolu bunu çağırır. */
export const aktifAnahtar = (): Anahtar | null => bellek;

/** Girişten sonra: anahtarı belleğe VE cihaza yazar. IndexedDB kullanılamıyorsa (bazı gizli
    pencereler) yalnız bellekte kalır — sayfa yenilenince yeniden giriş istenir, bu kabul. */
export async function anahtarKur(a: Anahtar): Promise<void> {
  bellek = a;
  try { await islem("readwrite", (s) => s.put(a, KAYIT)); }
  catch (e) { console.warn("[e2ee] anahtar cihaza yazılamadı, yalnız bu sekmede geçerli:", e); }
}

/** Açılışta: bu oturumun kullanıcısına ait anahtar cihazda var mı? Başka kullanıcının
    anahtarı (aynı tarayıcıda hesap değişimi) KULLANILMAZ — AAD zaten reddederdi ama
    sessizce yanlış anahtarla denemek yerine açıkça "yok" demek doğru. */
export async function anahtarYukle(userId: number): Promise<boolean> {
  if (bellek?.userId === userId) return true;
  try {
    const a = await islem<Anahtar | undefined>("readonly", (s) => s.get(KAYIT));
    if (a && a.userId === userId && a.dek instanceof CryptoKey) { bellek = a; return true; }
  } catch (e) { console.warn("[e2ee] anahtar deposu okunamadı:", e); }
  return false;
}

/** Çıkışta ve oturum düştüğünde. */
export async function anahtarSil(): Promise<void> {
  bellek = null;
  try { await islem("readwrite", (s) => s.delete(KAYIT)); } catch { /* depo yoksa silinecek bir şey de yok */ }
}
