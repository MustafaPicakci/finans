/* ————— AEAD: AES-256-GCM, tek biçim —————
   Her şifreli değer kendini tarif eder: `v1:<iv>:<ct>` (base64url, dolgusuz).
   Önek iki iş görür: (1) biçim ileride değişirse eski veri hâlâ okunabilir (sürüm);
   (2) göç sırasında bir değerin ZATEN şifreli olup olmadığı tek bakışta anlaşılır,
   yani göç yeniden çalıştırılabilir ve yarıda kalması ölümcül değildir.

   IV her yazımda RASTGELE (96 bit). GCM'de aynı anahtarla aynı IV'nin tekrarı
   felakettir (anahtar akışı sızar) — sayaç tutmak yerine rastgele seçmek, çok
   cihazlı bir istemcide sayaç senkronu derdini hiç doğurmuyor; 2^32 yazımın çok
   altında kaldığımız için çarpışma olasılığı ihmal edilebilir.

   AAD (ek doğrulama verisi) şifrelenmez ama BAĞLANIR: aynı ciphertext farklı bir
   AAD ile açılmaya çalışılırsa çözme BAŞARISIZ olur. Bunu değerin nerede durduğunu
   bağlamak için kullanıyoruz (örn. "dek-pw" / "dek-rk") — sunucu iki sarılı anahtarın
   yerini değiştirirse fark edilir. */

/** WebCrypto `ArrayBuffer` destekli bayt dizisi ister (TS 5.7+ `SharedArrayBuffer`'ı ayırt ediyor).
    Tüm genel imzalar bunu kullanır ki çağıran taraf tür dönüşümü yazmak zorunda kalmasın. */
export type Bayt = Uint8Array<ArrayBuffer>;

const SURUM = "v1";
const IV_BAYT = 12;

export function b64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(s: string): Bayt {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

/** Bir değerin bu biçimde şifrelenmiş olup olmadığı (göç için: zaten şifreliyse atla). */
export const sifreliMi = (s: unknown): boolean => typeof s === "string" && s.startsWith(`${SURUM}:`);

/** Şifreler. IV her çağrıda rastgele — aynı veri iki kez şifrelenirse iki farklı paket çıkar. */
export async function sar(key: CryptoKey, veri: Bayt, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BAYT));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, veri));
  return `${SURUM}:${b64u(iv)}:${b64u(ct)}`;
}

/** Çözer. Anahtar, AAD ya da paketin tek biti yanlışsa FIRLATIR — sessizce çöp döndürmez. */
export async function ac(key: CryptoKey, paket: string, aad: string): Promise<Bayt> {
  const p = paket.split(":");
  if (p.length !== 3 || p[0] !== SURUM) throw new Error(`tanınmayan şifreli biçim: ${paket.slice(0, 8)}…`);
  const iv = unb64u(p[1]);
  if (iv.length !== IV_BAYT) throw new Error("geçersiz IV uzunluğu");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, unb64u(p[2])));
}
