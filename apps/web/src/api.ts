import type { AllData } from "@finans/engine";

export type { Account, Recurring, RecurringAmount, Loan, OneOff, AssetType, Currency, Trade, Portfolio, Card, CardTx, Price, AllData } from "@finans/engine";

/** Sunucu hatası — `status` ile taşınır ki 401 (oturum yok/expired) yakalanıp giriş ekranına dönülebilsin. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new ApiError(r.status, ((await r.json().catch(() => ({}))) as any).error || r.statusText);
  return r.json();
}
export type SessionUser = { id: number; email: string };
/** Asistanın onay bekleyen tek işlemi: hangi araç, hangi argümanlar, kullanıcıya gösterilen özet */
export type AiAction = { tool: string; args: Record<string, unknown>; summary: string };
export type AiResult = { summary: string; ok: boolean; detail: string };
/** Asistanın bu sohbette uyguladığı bir plan; `undoable` = henüz geri alınmamış kayıt sayısı (0 → hepsi geri alınmış) */
export type AiPlanDurum = { planId: string; at: string; total: number; undoable: number; summary: string };
/** Sohbet listesi satırı */
export type AiKonusma = { id: number; title: string; at: string; messages: number; undoable: number };
/** Sohbetteki tek mesaj; `planId` doluysa bu bir UYGULAMA SONUCUdur ("geri al" düğmesi burada) */
export type AiMesaj = { id: number; role: "user" | "assistant"; content: string; at: string; planId: string | null };
/** Bir sohbetin tamamı: mesajlar + plan durumları + varsa onay bekleyen plan */
export type AiSohbet = {
  id: number; title: string; messages: AiMesaj[]; truncated: boolean;
  /** yeniden eskiye sıralı */
  plans: AiPlanDurum[];
  pending: { planId: string; actions: AiAction[]; at: string } | null;
};
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
  /* ---- portföy grupları (Faz 11): işlemi gruba taşı (tutar/bakiye etkisi yok) ---- */
  setTradePortfolio: (tradeId: number, portfolio_id: number | null) =>
    fetch(`/api/trades/${tradeId}/portfolio`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolio_id }) }).then(j),
  /* ---- toplu içe aktarma (ekstre yapıştırma) ---- */
  bulkTransactions: (rows: { date: string; name: string; amount: number; category_id: number | null; account_id: number | null }[]) =>
    fetch("/api/transactions/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) }).then((r) => j<{ inserted: number }>(r)),
  /* ---- düzenli kalem tutar zaman çizelgesi (Faz 9) ---- */
  setRecurringAmount: (id: number, body: { amount: number; from_month: string | null }) =>
    fetch(`/api/recurring/${id}/amount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j),
  delRecurringAmount: (id: number, from_month: string) =>
    fetch(`/api/recurring/${id}/amount/${from_month}`, { method: "DELETE" }).then(j),
  /* ---- düzenli kalem gerçekleştirme (Faz 8) ---- */
  realizeRecurring: (id: number, ym: string, body: { account_id?: number | null; category_id?: number | null } = {}) =>
    fetch(`/api/recurring/${id}/realize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ym, ...body }) }).then(j),
  unrealizeRecurring: (id: number, ym: string) =>
    fetch(`/api/recurring/${id}/realize/${ym}`, { method: "DELETE" }).then(j),
  /* ---- kart ekstresi ödeme (Faz 8.2) ---- */
  payStatement: (cardId: number, due: string, body: { account_id?: number | null; category_id?: number | null } = {}) =>
    fetch(`/api/cards/${cardId}/pay-statement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ due, ...body }) }).then(j),
  unpayStatement: (cardId: number, due: string) =>
    fetch(`/api/cards/${cardId}/pay-statement/${due}`, { method: "DELETE" }).then(j),
  /* ---- AI asistan (Faz 22; sohbet Faz 34'te sunucuya taşındı) ----
     chat yalnız PLAN üretir (hiçbir kayıt oluşmaz); execute kullanıcının onayladığı planı
     uygular. Sohbet artık sunucuda yaşar: geçmiş istekle GİTMEZ, sunucu kendi okur — yani
     mesajlar cihaza bağlı değildir ve istemci uydurma bir "asistan" turu enjekte edemez. */
  aiStatus: () => fetch("/api/ai/status").then((r) => j<{ enabled: boolean; model: string | null }>(r)),
  /** Son harekete göre sıralı; sayfalama keyset (son satırın `at` + `id`'si imleçtir) */
  aiKonusmalar: (imlec?: { at: string; id: number }) =>
    fetch(`/api/ai/conversations${imlec ? `?beforeAt=${encodeURIComponent(imlec.at)}&beforeId=${imlec.id}` : ""}`)
      .then((r) => j<{ conversations: AiKonusma[]; more: boolean }>(r)),
  aiSohbet: (id: number) => fetch(`/api/ai/conversations/${id}`).then((r) => j<AiSohbet>(r)),
  /** Başlığı yeniden adlandırır; sıralamayı (son konuşma zamanı) BİLEREK değiştirmez */
  aiSohbetAdlandir: (id: number, title: string) =>
    fetch(`/api/ai/conversations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) })
      .then((r) => j<{ ok: true; title: string }>(r)),
  aiSohbetSil: (id: number) => fetch(`/api/ai/conversations/${id}`, { method: "DELETE" }).then(j),
  /** conversationId yoksa yeni sohbet açılır (başlık ilk cümleden türetilir) */
  aiChat: (message: string, conversationId?: number) =>
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, conversationId }) })
      .then((r) => j<{ conversationId: number; reply: string; pending: AiAction[]; model: string; planId: string }>(r)),
  /* Uygulanacak işlemler GÖNDERİLMEZ — sunucu onları kendi planından okur (onaylanan ile
     uygulanan ayrışamaz). `skip` = onay kartından ✕ ile çıkarılan satırların sıra numaraları.
     planId tek kullanımlıktır: ikinci gönderim 409 döner (çift kayıt koruması). */
  aiExecute: (planId: string, skip: number[] = []) =>
    fetch("/api/ai/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, skip }) })
      .then((r) => j<{ conversationId: number | null; results: AiResult[]; undoable: number }>(r)),
  /* uygulanan planı geri alır (kayıtları ters sırada siler); yalnız geri alınabilir işlemler için */
  aiUndo: (planId: string) =>
    fetch("/api/ai/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) })
      .then((r) => j<{ conversationId: number | null; results: AiResult[] }>(r)),
  /* ---- auth (Faz 5.1) ---- */
  me: () => fetch("/api/auth/me").then((r) => j<{ user: SessionUser | null }>(r)),
  login: (email: string, password: string) =>
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => j<{ user: SessionUser }>(r)),
  register: (email: string, password: string) =>
    fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => j<{ user?: SessionUser; pending?: boolean }>(r)),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then(j),
  /* ---- şifre sıfırlama + aktivasyon (Faz 6) ---- */
  forgot: (email: string) =>
    fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(j),
  reset: (token: string, password: string) =>
    fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }).then(j),
  verify: (token: string) =>
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(j),
  resendVerify: (email: string) =>
    fetch("/api/auth/resend-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(j),
  /* ---- KVKK (Faz 5.4) ---- */
  exportData: () => fetch("/api/export").then((r) => { if (!r.ok) throw new ApiError(r.status, "İndirilemedi"); return r.blob(); }),
  deleteAccount: (password: string) =>
    fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }).then(j),
};
