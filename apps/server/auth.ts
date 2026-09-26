import { scrypt, randomBytes, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";

/* Faz 5.1 — parola hash'i: Node yerleşik scrypt (native bağımlılık yok, argon2 kurulumundan kaçınıldı).
   Saklama biçimi: "salt:derivedKey" (ikisi de hex). */
const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const dk = (await scryptAsync(pw, salt, KEYLEN)) as Buffer;
  return `${salt}:${dk.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const dk = (await scryptAsync(pw, salt, KEYLEN)) as Buffer;
  return key.length === dk.length && timingSafeEqual(key, dk);
}

/* ---- oturumlar (server-side, revoke edilebilir) ----
   Cookie'de HAM token taşınır; DB'de yalnız SHA-256 hash'i saklanır → DB sızsa bile
   token'lar doğrudan kullanılamaz (tersine çevrilemez). Ham token 32 bayt rastgele
   olduğundan hash öncesi ayrıca salt gerekmez (sözlük saldırısı imkânsız). */
const SESSION_DAYS = 7;
export const SESSION_COOKIE = "finans_session";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = { id: number; email: string };

export async function createSession(userId: number): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    hashToken(token), userId, now.toISOString(), expires.toISOString(),
  );
  return { token, expires }; // ham token → cookie
}

/** Geçerli (süresi dolmamış) oturumun kullanıcısını döner; yoksa null. Süresi dolmuşsa temizler. */
export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db.get<{ id: number; email: string; expires_at: string }>(
    "SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
    hashToken(token),
  );
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    await deleteSession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.run("DELETE FROM sessions WHERE token = ?", hashToken(token));
}

/** Kullanıcının TÜM oturumlarını düşür (şifre sıfırlama sonrası güvenlik). */
export async function revokeUserSessions(userId: number): Promise<void> {
  await db.run("DELETE FROM sessions WHERE user_id = ?", userId);
}

/* ---- e-posta token'ları (Faz 6: aktivasyon + şifre sıfırlama) ----
   Oturumlarla AYNI kural: DB'de yalnız SHA-256 hash'i durur, ham token yalnız e-postadaki
   bağlantıda taşınır. Sebebi tek cümleyle: bir 'reset' token'ı geçerli olduğu sürece PAROLANIN
   YERİNE geçer — DB'yi okuyabilen biri (dump, yedek, sağlayıcı konsolu) onu kopyalayıp
   /?reset=<token> ile hesabı devralabilirdi, scrypt'i hiç kırmadan. E-postanın gönderilip
   gönderilmemesi bu riski değiştirmez: token gönderimden ÖNCE ve gönderim başarısız olsa da
   yazılır (index.ts /auth/forgot), üstelik kimse tıklamadığı için süresi dolana dek used=false
   bekler. Ham token 32 bayt rastgele olduğundan hash öncesi ayrıca salt gerekmez. */
export type EmailTokenKind = "verify" | "reset";

export async function createEmailToken(userId: number, kind: EmailTokenKind, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  await db.run(
    "INSERT INTO email_tokens (token, user_id, kind, expires_at, used, created_at) VALUES (?,?,?,?,?,?)",
    hashToken(token), userId, kind, expires.toISOString(), false, now.toISOString(),
  );
  return token; // ham token → yalnız e-posta bağlantısına
}

/** Token'ı doğrular ve TÜKETİR (tek kullanımlık); geçerliyse user_id, değilse null döner. */
export async function consumeEmailToken(token: string, kind: EmailTokenKind): Promise<number | null> {
  if (!token) return null;
  const th = hashToken(token);
  const row = await db.get<{ user_id: number; expires_at: string; used: boolean }>(
    "SELECT user_id, expires_at, used FROM email_tokens WHERE token = ? AND kind = ?", th, kind,
  );
  if (!row || row.used || row.expires_at <= new Date().toISOString()) return null;
  await db.run("UPDATE email_tokens SET used = true WHERE token = ?", th);
  return row.user_id;
}

/** Tüketilmiş/süresi geçmiş token satırlarını siler. İki işi var: (1) tablo sonsuza dek büyümesin,
 *  (2) hash'lemeden ÖNCE yazılmış eski HAM token satırları temizlensin — onlar artık hash ile
 *  aranacağı için zaten eşleşmez (yani geçersiz), ama düz metin olarak durmalarının bir faydası yok.
 *  İdempotent; açılışta bir kez ve zamanlanmış işlerde çağrılır. */
export async function purgeStaleEmailTokens(): Promise<number> {
  const r = await db.run(
    "DELETE FROM email_tokens WHERE used = true OR expires_at <= ?", new Date().toISOString(),
  );
  return r.changes;
}

/* ————— SIFIR BİLGİ GİRİŞİ (E2EE aşama 3b) —————
   Parola sunucuya GELMEZ. İstemci önce bu e-postanın salt'ını ister (`/auth/prelogin`),
   paroladan KEK + auth_token türetir, yalnız auth_token'ı gönderir. Sunucu onu scrypt'leyip
   saklar — yani sızan bir veritabanından elde edilen hash parolaya değil token'a götürür ve
   token KEK'i vermez (bkz. packages/crypto/src/keys.ts). */

let _sir: Buffer | null = null;
/** Sunucunun kalıcı sırrı — ilk ihtiyaçta üretilir, `server_secrets`'te saklanır. */
async function prelogin_sirri(): Promise<Buffer> {
  if (_sir) return _sir;
  await db.run("INSERT INTO server_secrets (key, value) VALUES ('prelogin', ?) ON CONFLICT (key) DO NOTHING", randomBytes(32).toString("hex"));
  const r = await db.get<{ value: string }>("SELECT value FROM server_secrets WHERE key='prelogin'");
  _sir = Buffer.from(r!.value, "hex");
  return _sir;
}

/** Kayıtlı OLMAYAN e-posta için tutarlı sahte salt. Yoksa `/auth/prelogin` "bu e-posta kayıtlı
    mı" sorusunu cevaplardı (salt dönüyor mu, dönmüyor mu). Gizli anahtarla türetilmek ZORUNDA:
    düz SHA256(email) olsaydı saldırgan kendisi hesaplayıp karşılaştırır ve yine ayırt ederdi.
    Aynı e-posta her seferinde aynı sahte salt'ı alır — yani tekrar sorarak da ayırt edilemez. */
export async function sahteSalt(email: string): Promise<string> {
  return createHmac("sha256", await prelogin_sirri()).update(`salt:${email}`).digest().subarray(0, 16).toString("base64url");
}

/** İstemcinin gönderdiği E2EE malzemesinin BİÇİM doğrulaması. Sunucu içeriği okuyamaz ve
    okumamalı; yalnız "bu gerçekten bizim biçimimiz mi" diye bakar ki çöp yazılıp kullanıcı
    bir sonraki girişte açılamayan bir anahtarla kalmasın. */
const B64U = /^[A-Za-z0-9_-]+$/;
const PAKET = /^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{40,}$/;
export type E2eeMalzeme = { auth_token: string; kdf_salt: string; kdf_params: string; dek_wrapped_pw: string; dek_wrapped_rk: string | null };
export function e2eeMalzemeDogrula(b: any): E2eeMalzeme | string {
  if (!b || typeof b !== "object") return "şifreleme bilgileri eksik";
  const { auth_token, kdf_salt, kdf_params, dek_wrapped_pw, dek_wrapped_rk } = b;
  if (typeof auth_token !== "string" || auth_token.length !== 43 || !B64U.test(auth_token)) return "geçersiz auth_token";
  if (typeof kdf_salt !== "string" || kdf_salt.length !== 22 || !B64U.test(kdf_salt)) return "geçersiz salt";
  let p: any;
  try { p = JSON.parse(String(kdf_params)); } catch { return "geçersiz KDF parametresi"; }
  /* Alt sınır SUNUCUDA da zorlanır: istemci 1 iterasyonla kayıt olursa sızan veritabanındaki
     sarılı DEK anında kırılırdı. Parolanın kendisini göremeyiz ama maliyetini görebiliriz. */
  if (p?.alg !== "PBKDF2-SHA256" || !Number.isInteger(p?.iter) || p.iter < 600_000) return "KDF parametresi çok zayıf";
  if (typeof dek_wrapped_pw !== "string" || !PAKET.test(dek_wrapped_pw)) return "geçersiz sarılı anahtar (pw)";
  /* Kurtarma paketi aşama 3b'de İSTEĞE BAĞLI ve bu bilinçli: veri henüz şifreli değil, yani
     kullanıcıya "bu kodu kaybedersen verin gider" demek bugün DOĞRU olmazdı — üstelik e-postayla
     sıfırlama bu aşamada yeni bir DEK üretiyor, kaydettiği kod da geçersizleşirdi. Kod,
     şifrelemenin gerçekten başladığı an (aşama 6, göç) gösterilir ve orada ZORUNLU olur. */
  if (dek_wrapped_rk != null && (typeof dek_wrapped_rk !== "string" || !PAKET.test(dek_wrapped_rk))) return "geçersiz sarılı anahtar (rk)";
  return { auth_token, kdf_salt, kdf_params: JSON.stringify({ alg: p.alg, iter: p.iter }), dek_wrapped_pw, dek_wrapped_rk: dek_wrapped_rk ?? null };
}
