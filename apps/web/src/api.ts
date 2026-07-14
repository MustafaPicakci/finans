import type { AllData } from "@finans/engine";

export type { Account, Recurring, Loan, OneOff, AssetType, Currency, Trade, Card, CardTx, Price, AllData } from "@finans/engine";

/** Sunucu hatası — `status` ile taşınır ki 401 (oturum yok/expired) yakalanıp giriş ekranına dönülebilsin. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new ApiError(r.status, ((await r.json().catch(() => ({}))) as any).error || r.statusText);
  return r.json();
}
export type SessionUser = { id: number; email: string };
export const api = {
  all: () => fetch("/api/all").then((r) => j<AllData>(r)),
  post: (route: string, body: unknown) =>
    fetch(`/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j),
  put: (route: string, body: unknown) =>
    fetch(`/api/${route}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j),
  del: (route: string, id: number) => fetch(`/api/${route}/${id}`, { method: "DELETE" }).then(j),
  delPrice: (asset_type: string, symbol: string) =>
    fetch(`/api/prices/${asset_type}/${encodeURIComponent(symbol)}`, { method: "DELETE" }).then(j),
  refreshPrices: () => fetch("/api/prices/refresh", { method: "POST" }).then(j),
  /* ---- auth (Faz 5.1) ---- */
  me: () => fetch("/api/auth/me").then((r) => j<{ user: SessionUser | null }>(r)),
  login: (email: string, password: string) =>
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => j<{ user: SessionUser }>(r)),
  register: (email: string, password: string) =>
    fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => j<{ user: SessionUser }>(r)),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then(j),
  /* ---- şifre sıfırlama + aktivasyon (Faz 6) ---- */
  forgot: (email: string) =>
    fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(j),
  reset: (token: string, password: string) =>
    fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }).then(j),
  verify: (token: string) =>
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(j),
  /* ---- KVKK (Faz 5.4) ---- */
  exportData: () => fetch("/api/export").then((r) => { if (!r.ok) throw new ApiError(r.status, "İndirilemedi"); return r.blob(); }),
  deleteAccount: (password: string) =>
    fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }).then(j),
};
