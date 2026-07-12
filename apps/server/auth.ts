import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
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

/* ---- oturumlar (server-side, revoke edilebilir) ---- */
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "finans_session";

export type SessionUser = { id: number; email: string };

export async function createSession(userId: number): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    token, userId, now.toISOString(), expires.toISOString(),
  );
  return { token, expires };
}

/** Geçerli (süresi dolmamış) oturumun kullanıcısını döner; yoksa null. Süresi dolmuşsa temizler. */
export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db.get<{ id: number; email: string; expires_at: string }>(
    "SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
    token,
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
  await db.run("DELETE FROM sessions WHERE token = ?", token);
}
