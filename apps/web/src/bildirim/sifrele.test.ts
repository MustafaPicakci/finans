import { describe, it, expect } from "vitest";
import { pushSifrele, hkdf, b64u, b64uCoz } from "./sifrele";

const te = new TextEncoder();
/** WebCrypto imzaları `Uint8Array<ArrayBuffer>` ister; test verisi genel `Uint8Array` — yalnız tip dönüşümü */
const bs = (u: Uint8Array) => u as BufferSource;

/** Tarayıcının yaptığı çözme (RFC 8291 alıcı tarafı) — şifrelemenin karşılığı bağımsız yazıldı */
async function coz(govde: Uint8Array, ua: CryptoKeyPair, authSecret: Uint8Array): Promise<string> {
  const tuz = govde.slice(0, 16);
  const idlen = govde[20];
  const asPublic = govde.slice(21, 21 + idlen);
  const sifreli = govde.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const as = await crypto.subtle.importKey("raw", bs(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as }, ua.privateKey, 256));
  const info = new Uint8Array([...te.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, info, 32);
  const cek = await hkdf(tuz, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(tuz, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["decrypt"]);
  const duz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(nonce) }, k, bs(sifreli)));
  expect(duz[duz.length - 1]).toBe(2); // son kayıt ayracı
  return new TextDecoder().decode(duz.slice(0, -1));
}

/** Ham açık anahtar (65 bayt) + d → JWK ile içe alınan ECDH anahtar çifti */
async function ciftAl(publicB64: string, privateB64: string): Promise<CryptoKeyPair> {
  const pub = b64uCoz(publicB64);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  return {
    publicKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []),
    privateKey: await crypto.subtle.importKey("jwk", { ...jwk, d: privateB64 }, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
  };
}

/* RFC 8291 Ek A */
const A = {
  duz: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  tuz: "DGv6ra1nlYgDCS1FRnbzlw",
  govde: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("pushSifrele (RFC 8291)", () => {
  it("RFC 8291 Ek A vektörünü birebir üretir", async () => {
    const gonderen = await ciftAl(A.asPublic, A.asPrivate);
    const govde = await pushSifrele(b64uCoz(A.uaPublic), b64uCoz(A.auth), te.encode(A.duz), { gonderen, tuz: b64uCoz(A.tuz) });
    expect(b64u(govde)).toBe(A.govde);
  });

  it("vektörün gövdesi alıcı anahtarıyla çözülür (vektörün kendisi doğru)", async () => {
    expect(await coz(b64uCoz(A.govde), await ciftAl(A.uaPublic, A.uaPrivate), b64uCoz(A.auth))).toBe(A.duz);
  });

  it("gidiş-dönüş: rastgele cihaz anahtarıyla şifrelenen bildirim aynı cihazda çözülür, her ileti farklı", async () => {
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const metin = JSON.stringify({ baslik: "Kira · 3 gün sonra", govde: "1 Ekim · ₺25.000" });
    const a = await pushSifrele(uaPublic, auth, te.encode(metin));
    const b = await pushSifrele(uaPublic, auth, te.encode(metin));
    expect(b64u(a)).not.toBe(b64u(b)); // tek kullanımlık gönderen anahtarı + rastgele tuz
    expect(await coz(a, ua, auth)).toBe(metin);
  });

  it("başka cihazın anahtarıyla çözülemez", async () => {
    const yeni = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
    const [ua, yabanci] = [await yeni(), await yeni()];
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const govde = await pushSifrele(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), auth, te.encode("gizli"));
    await expect(coz(govde, yabanci, auth)).rejects.toThrow();
  });
});
