import { createPrivateKey, sign as imzala } from "node:crypto";
import { db, nowLocal } from "./db.js";

/* ============================================================================
   Bildirim gönderimi (Faz 44) — sunucu yalnız POSTACIDIR
   ----------------------------------------------------------------------------
   Bildirimin içeriğini sunucu BİLEMEZ (E2EE): plan istemcide kurulur ve her öğe cihazın push
   anahtarıyla istemcide şifrelenir (apps/web/src/bildirim/sifrele.ts, RFC 8291). Burada kalan iş:
   kapalı zarfı zamanı gelince push servisine iletmek. Kendi imzamız (VAPID, RFC 8292) push
   servisine "bu istek bu uygulamadan" der; içerik şifresiyle ilgisi yoktur.

   Kripto: yalnız `node:crypto` ile ES256 imza. check-no-crypto kapısı sunucunun E2EE kripto
   PAKETİNE bağlanmasını yasaklar (veri anahtarına dokunmasın diye); VAPID imzası kullanıcı
   verisiyle ilgisizdir.

   Zamanlama: ayrı bir cron YOK, 30 dakikalık turun içinde koşar — Neon compute'u her tur zaten
   uyanıyor, ayrı bir zamanlama kotaya ikinci bir uyanma serisi eklerdi. Sonuç: 09:00 bildirimi
   09:00-09:30 arasında gider. DÜRÜST KISIT: süreç uyursa (Render ücretsiz katmanı) cron da durur
   ve o tur gönderilmez; bildirim `bitis`e kadar kuyrukta bekler, uyanınca gider. */

const PUB = process.env.VAPID_PUBLIC_KEY || "";
const PRIV = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || (process.env.APP_URL ? process.env.APP_URL : "mailto:bildirim@finans.local");

export const pushAcik = () => !!(PUB && PRIV);
export const vapidPublic = () => PUB;

/** Abonelik adresi YALNIZ bilinen push servislerinden olabilir. Adres istemciden geliyor ve
    sunucu oraya POST atıyor — serbest bıraksak kullanıcı sunucuya iç ağdaki bir adrese istek
    attırabilirdi (SSRF). */
const IZINLI = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function aboneAdresiGecerli(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && IZINLI.some((r) => r.test(u.hostname));
  } catch { return false; }
}

let imzaAnahtari: ReturnType<typeof createPrivateKey> | null = null;
function anahtar() {
  if (!imzaAnahtari) {
    const pub = Buffer.from(PUB, "base64url");
    imzaAnahtari = createPrivateKey({
      key: { kty: "EC", crv: "P-256", d: PRIV, x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") },
      format: "jwk",
    });
  }
  return imzaAnahtari;
}

/** VAPID JWT (RFC 8292): hedef push servisinin kökeni için 12 saatlik ES256 imzalı jeton */
export function vapidJwt(endpoint: string, simdi = Date.now()): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const girdi = `${b({ typ: "JWT", alg: "ES256" })}.${b({ aud: new URL(endpoint).origin, exp: Math.floor(simdi / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const imza = imzala("sha256", Buffer.from(girdi), { key: anahtar(), dsaEncoding: "ieee-p1363" });
  return `${girdi}.${imza.toString("base64url")}`;
}

/** Tek bir kapalı zarfı iletir. Dönen `durum` push servisinin HTTP kodudur. */
export async function pushIlet(endpoint: string, govdeB64: string, ttlSn: number): Promise<number> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${vapidJwt(endpoint)}, k=${PUB}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(Math.max(60, Math.floor(ttlSn))),
      Urgency: "normal",
    },
    body: Buffer.from(govdeB64, "base64url"),
    signal: AbortSignal.timeout(15_000),
  });
  return r.status;
}

/** Push servisi aboneliğin artık geçersiz olduğunu söylüyor (uygulama kaldırıldı, izin geri alındı) */
const aboneOldu = (s: number) => s === 404 || s === 410;

/** Zamanı gelmiş bildirimleri gönderir — cron turundan çağrılır. */
export async function bildirimleriGonder(): Promise<{ giden: number; dusen: number }> {
  if (!pushAcik()) return { giden: 0, dusen: 0 };
  const simdi = new Date().toISOString();
  /* süresi geçenleri at (olay günü geçti: "3 gün sonra" demek yalan olur) + eski gönderim izleri */
  await db.run("DELETE FROM push_kuyruk WHERE bitis <= ?", simdi);
  await db.run("DELETE FROM push_gonderilen WHERE at < ?", new Date(Date.now() - 90 * 864e5).toISOString());
  const satirlar = await db.all<{ id: number; abonelik_id: number; anahtar: string; bitis: string; govde: string; endpoint: string }>(
    `SELECT k.id, k.abonelik_id, k.anahtar, k.bitis, k.govde, a.endpoint
       FROM push_kuyruk k JOIN push_abonelik a ON a.id = k.abonelik_id
      WHERE k.zaman <= ? ORDER BY k.zaman LIMIT 300`, simdi);
  let giden = 0, dusen = 0;
  for (const s of satirlar) {
    let durum = 0;
    try { durum = await pushIlet(s.endpoint, s.govde, (Date.parse(s.bitis) - Date.now()) / 1000); }
    catch (e) { console.warn(`[bildirim] iletilemedi (abonelik ${s.abonelik_id}): ${(e as Error).message}`); continue; } // ağ hatası: sonraki turda yeniden
    if (durum >= 200 && durum < 300) {
      await db.run("INSERT INTO push_gonderilen (abonelik_id, anahtar, at) VALUES (?,?,?) ON CONFLICT DO NOTHING", s.abonelik_id, s.anahtar, new Date().toISOString());
      await db.run("DELETE FROM push_kuyruk WHERE id=?", s.id);
      await db.run("UPDATE push_abonelik SET son_basari=? WHERE id=?", nowLocal(), s.abonelik_id);
      giden++;
    } else if (aboneOldu(durum)) {
      await db.run("DELETE FROM push_abonelik WHERE id=?", s.abonelik_id); // kuyruğu da cascade ile gider
      dusen++;
    } else if (durum === 429 || durum >= 500) {
      console.warn(`[bildirim] push servisi ${durum} döndü, sonraki turda yeniden denenecek`);
    } else {
      /* 400/403/413: zarf ya da imza bozuk — tekrar denemek aynı sonucu verir, satır atılır */
      console.warn(`[bildirim] push servisi ${durum} döndü, bildirim atıldı (anahtar ${s.anahtar})`);
      await db.run("DELETE FROM push_kuyruk WHERE id=?", s.id);
    }
  }
  if (giden || dusen) console.log(`[bildirim] ${giden} gönderildi${dusen ? `, ${dusen} geçersiz abonelik silindi` : ""}`);
  return { giden, dusen };
}
