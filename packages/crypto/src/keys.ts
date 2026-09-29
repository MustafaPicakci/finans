import { b64u, unb64u, sar, ac, type Bayt } from "./aead.js";

/* ————— ANAHTAR YÖNETİMİ —————

   parola ──PBKDF2(600k, kdf_salt)──► master
                                        ├─ HKDF("kek")  ──► KEK        (cihazda kalır, DEK'i sarar)
                                        └─ HKDF("auth") ──► auth_token (sunucuya gider, scrypt'lenir)
   kurtarma kodu (160 bit) ──HKDF("rk")──► RK  (aynı DEK'i ayrıca sarar)

   PAROLA TARAYICIDAN ÇIKMAZ ve bu bir ayrıntı değil, tasarımın dayanağı. Parola sunucuya
   gitseydi sunucudaki hash (bugün scrypt N=16384) şifrelemenin ARKA KAPISI olurdu:
   veritabanını okuyan kişi — tam da tehdit modelindeki taraf — sözlük saldırısıyla
   parolayı bulur ve 600.000 iterasyonluk PBKDF2'yi hiç çalıştırmadan DEK'i açardı.
   `auth_token` ile KEK aynı master'dan FARKLI `info` ile türer; HKDF çıktıları birbirinden
   bağımsızdır, yani token'ı ele geçiren KEK'e ulaşamaz. (Bitwarden/1Password'ün yayımlanmış
   tasarımı — uydurulmuş değil, kopyalanmış.)

   Parola değişimi veriyi yeniden şifrelemez: DEK aynı kalır, yalnız yeni KEK ile yeniden
   sarılır. Tasarımın ucuz olduğu tek yer.

   Kurtarma kodu parolanın salt'ına BAĞLI DEĞİL: bağlı olsaydı parola değişip salt
   yenilendiğinde kod açamaz hâle gelirdi — tam da kullanıcının ona muhtaç olduğu an.
   160 bit rastgele bir sır salt gerektirmiyor (salt düşük entropili sırları sözlükten korur). */

export type KdfParams = { alg: "PBKDF2-SHA256"; iter: number };
/** OWASP 2023 eşiği. `kdf_params` ile saklanır, yani ileride artırmak/Argon2'ye geçmek göç gerektirmez. */
export const VARSAYILAN_KDF: KdfParams = { alg: "PBKDF2-SHA256", iter: 600_000 };

/** Sunucudan (prelogin) gelen parametreyi kullanmadan ÖNCE denetler. Sunucu kayıtta bu alt
    sınırı zaten zorluyor; ama giriş anında parametreyi yine sunucu söylüyor ve istemci ona
    körü körüne uysaydı `iter: 1` diyen bir yanıt, gönderilen auth_token'ı ucuzca kırılabilir
    kılardı. Alt sınır `parolaTuret`'in içinde DEĞİL, çünkü testler hızlı parametreyle türetir. */
export function kdfDenetle(p: unknown): KdfParams {
  const k = p as Partial<KdfParams> | null;
  if (k?.alg !== "PBKDF2-SHA256" || !Number.isInteger(k.iter) || k.iter! < VARSAYILAN_KDF.iter) {
    throw new Error("Sunucudan gelen şifreleme ayarı güvenli değil, giriş durduruldu");
  }
  return { alg: k.alg, iter: k.iter! };
}

const enc = new TextEncoder();
const BILGI = { kek: "finans/kek/v1", auth: "finans/auth/v1", rk: "finans/rk/v1" } as const;

/** Kullanıcı başına salt (16 bayt). Gizli DEĞİL — sunucuda düz durur, girişte istemciye verilir. */
export function yeniSalt(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

async function hkdf(girdi: ArrayBuffer | Bayt, bilgi: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", girdi, "HKDF", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(bilgi) }, k, 256);
}

const aesAnahtari = (ham: ArrayBuffer | Bayt): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", ham, "AES-GCM", false, ["encrypt", "decrypt"]);

/** Paroladan KEK + auth_token türetir. Maliyetli (bilinçli): 600k PBKDF2 turu. */
export async function parolaTuret(
  parola: string, salt: string, kdf: KdfParams = VARSAYILAN_KDF,
): Promise<{ kek: CryptoKey; authToken: string }> {
  if (kdf.alg !== "PBKDF2-SHA256") throw new Error(`desteklenmeyen KDF: ${kdf.alg}`);
  const p = await crypto.subtle.importKey("raw", enc.encode(parola), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt), iterations: kdf.iter }, p, 256,
  );
  const [kekHam, authHam] = await Promise.all([hkdf(master, BILGI.kek), hkdf(master, BILGI.auth)]);
  return { kek: await aesAnahtari(kekHam), authToken: b64u(new Uint8Array(authHam)) };
}

/* ————— DEK (veri şifreleme anahtarı) ————— */

/** Yeni DEK — 32 rastgele bayt. Ham bayt yalnız KURULUM ANINDA elde tutulur (sarmak için);
    kullanım için `dekAnahtari` ile dışa aktarılamaz bir CryptoKey'e çevrilir. */
export const yeniDek = (): Bayt => crypto.getRandomValues(new Uint8Array(32));

/** Ham DEK'i kullanıma hazır, DIŞA AKTARILAMAZ anahtara çevirir (IndexedDB'de bu saklanır). */
export const dekAnahtari = (ham: Bayt): Promise<CryptoKey> => aesAnahtari(ham);

/** Amaç AAD'ye bağlanır: sunucu parola-sarılı ile kurtarma-sarılı paketin yerini
    değiştirirse çözme BAŞARISIZ olur (sessizce yanlış anahtarla devam edilmez). */
export type SarmaAmaci = "pw" | "rk";
const dekAad = (a: SarmaAmaci) => `finans/dek/${a}/v1`;

export const dekSar = (ham: Bayt, sarici: CryptoKey, amac: SarmaAmaci): Promise<string> =>
  sar(sarici, ham, dekAad(amac));

export const dekAc = (sarili: string, sarici: CryptoKey, amac: SarmaAmaci): Promise<Bayt> =>
  ac(sarici, sarili, dekAad(amac));

/* ————— KURTARMA KODU —————
   160 bit, Crockford base32 → 32 karakter, 4'erli 8 grup: "K3M9-7PQR-…".
   Crockford seçildi çünkü elle yazılıyor/okunuyor: I/L/O/U yok (1/0 ile karışmasın), girişte
   küçük harf, tire ve boşluk tolere edilir, I→1 L→1 O→0 düzeltilir. Kullanıcı bunu kağıda
   yazıp aylar sonra geri yazacak; tek bir harf karışıklığı veriyi kalıcı olarak kaybettirir. */

const ALFABE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KOD_BAYT = 20; // 160 bit → tam 32 base32 karakteri

function base32(b: Uint8Array): string {
  let bit = 0, deger = 0, out = "";
  for (const x of b) {
    deger = (deger << 8) | x; bit += 8;
    while (bit >= 5) { out += ALFABE[(deger >>> (bit - 5)) & 31]; bit -= 5; }
  }
  if (bit > 0) out += ALFABE[(deger << (5 - bit)) & 31];
  return out;
}

/** Yeni kurtarma kodu, gösterime hazır biçimde. */
export function yeniKurtarmaKodu(): string {
  return base32(crypto.getRandomValues(new Uint8Array(KOD_BAYT))).match(/.{4}/g)!.join("-");
}

/** Kullanıcının yazdığı kodu bayta çevirir. Tanınmayan karakter ya da yanlış uzunlukta FIRLATIR —
    yanlış bir anahtarla sarmayı denemek yerine erken ve anlaşılır hata vermek daha iyi. */
export function kurtarmaKoduCoz(kod: string): Bayt {
  const temiz = kod.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (temiz.length !== 32) throw new Error(`kurtarma kodu 32 karakter olmalı (${temiz.length} girildi)`);
  const out = new Uint8Array(KOD_BAYT);
  let bit = 0, deger = 0, i = 0;
  for (const ch of temiz) {
    const v = ALFABE.indexOf(ch);
    if (v < 0) throw new Error(`kurtarma kodunda geçersiz karakter: ${ch}`);
    deger = (deger << 5) | v; bit += 5;
    if (bit >= 8) { out[i++] = (deger >>> (bit - 8)) & 255; bit -= 8; }
  }
  return out;
}

/** Kurtarma kodundan DEK'i saran anahtar (RK). */
export async function kurtarmaSarici(kod: string): Promise<CryptoKey> {
  return aesAnahtari(await hkdf(kurtarmaKoduCoz(kod), BILGI.rk));
}
