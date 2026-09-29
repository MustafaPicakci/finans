import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";

/* VAPID imzası (RFC 8292) ve abonelik adresi süzgeci — veritabanına dokunmaz. Anahtarlar
   import ANINDA env'den okunduğu için modül, env ayarlandıktan sonra dinamik yüklenir. */
let push: typeof import("./push.js");
let pubJwk: { x: string; y: string };

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
  pubJwk = { x: j.x, y: j.y };
  process.env.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url");
  process.env.VAPID_PRIVATE_KEY = j.d;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  push = await import("./push.js");
});

describe("vapidJwt", () => {
  it("push servisinin kökenine yazılmış, 12 saatlik, ES256 (r||s) imzalı jeton üretir", () => {
    const simdi = Date.UTC(2026, 8, 29, 10);
    const [h, p, imza] = push.vapidJwt("https://fcm.googleapis.com/fcm/send/abc:def", simdi).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com", exp: simdi / 1000 + 12 * 3600, sub: "mailto:test@example.com",
    });
    const imzaBayt = Buffer.from(imza, "base64url");
    expect(imzaBayt.length).toBe(64); // DER değil ham r||s — push servisleri DER'i reddeder
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", ...pubJwk }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, imzaBayt)).toBe(true);
  });
});

describe("aboneAdresiGecerli (SSRF süzgeci)", () => {
  it("bilinen push servislerini kabul eder", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/QGx",
      "https://wns2-db5p.notify.windows.com/w/?token=x",
    ]) expect(push.aboneAdresiGecerli(u)).toBe(true);
  });
  it("iç ağı, düz http'yi ve benzer adlı alan adlarını reddeder", () => {
    for (const u of [
      "http://fcm.googleapis.com/x", "https://localhost:5432/x", "https://169.254.169.254/latest",
      "https://fcm.googleapis.com.evil.com/x", "https://evilpush.apple.com.attacker.io/x", "fcm.googleapis.com", 42,
    ]) expect(push.aboneAdresiGecerli(u)).toBe(false);
  });
});
