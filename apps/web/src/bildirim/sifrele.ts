/* ============================================================================
   Bildirim zarfı — Web Push içerik şifrelemesi (RFC 8291, `aes128gcm`, RFC 8188)
   ----------------------------------------------------------------------------
   Normalde bu şifrelemeyi SUNUCU yapar: içeriği bilir, cihazın push anahtarıyla kapatıp gönderir.
   Burada sunucu içeriği bilemez (E2EE), o yüzden aynı işi İSTEMCİ yapar — cihazın abonelik
   anahtarları (`p256dh`, `auth`) istemcide de vardır. Sunucu elinde yalnız bu fonksiyonun
   ürettiği opak baytları tutar ve zamanı gelince push servisine iletir; tarayıcı alırken çözer,
   servis çalışanı düz metni görür. Arada ne sunucu ne Google/Apple'ın push servisi okuyabilir.

   Yalnız WebCrypto — kripto için npm paketi YOK (E2EE kuralı: kötü niyetli bir kripto paketi
   doğrudan anahtar sızdırma yolu olurdu). Doğruluk RFC 8291 Ek A'nın vektörüyle testte. */

const te = new TextEncoder();

export const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64uCoz = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

const birlestir = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) { out.set(x, i); i += x.length; }
  return out;
};

/** HKDF-SHA256 (çıkar + genişlet tek adımda) */
export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bayt: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, k, bayt * 8));
}

/** Tek kayıt yeter: bildirim gövdesi birkaç yüz bayt, push servisleri de ~4 KB üstünü reddeder. */
const KAYIT_BOYU = 4096;

/**
 * Düz metni cihazın push anahtarıyla şifreler; dönen bayt dizisi doğrudan push isteğinin gövdesidir
 * (`Content-Encoding: aes128gcm`). `sabit` yalnız test içindir (RFC vektörü sabit anahtar + tuz ister).
 */
export async function pushSifrele(
  uaPublic: Uint8Array, authSecret: Uint8Array, duz: Uint8Array,
  sabit?: { gonderen: CryptoKeyPair; tuz: Uint8Array },
): Promise<Uint8Array> {
  /* her ileti için tek kullanımlık gönderen anahtarı: aynı cihaza giden iki bildirim ortak sır paylaşmaz */
  const gonderen = sabit?.gonderen ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", gonderen.publicKey));
  const ua = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, gonderen.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, birlestir(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const tuz = sabit?.tuz ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(tuz, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(tuz, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const anahtar = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  /* 0x02 = son kaydın ayracı (RFC 8188); dolgu yok */
  const sifreli = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, anahtar, birlestir(duz, new Uint8Array([2])) as BufferSource));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, KAYIT_BOYU);
  return birlestir(tuz, rs, new Uint8Array([asPublic.length]), asPublic, sifreli);
}
