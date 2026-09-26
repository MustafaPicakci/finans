import type { AllData } from "@finans/engine";
import type { UserContext, ChatMessage, ChatResult } from "@finans/asistan";
import { yaz, veriAyarla } from "./yazim";
import { veriAc } from "./yazim/zarf";

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
/** Kayıt/sıfırlama/yükseltmede sunucuya giden sıfır bilgi malzemesi (bkz. features/auth/e2ee.ts) */
export type E2eeMalzeme = { auth_token: string; kdf_salt: string; kdf_params: string; dek_wrapped_pw: string };
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
/** Yazma uçları `yaz()` boru hattından geçer (bkz. yazim/index.ts) — `fetch`'i doğrudan
    çağıran yazma metodu EKLEME, şifrelemeyi atlar. Hata sözleşmesi `j()` ile aynı. */
async function yazJ<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await yaz(method, path, body);
  if (r.status >= 400) throw new ApiError(r.status, r.data?.error || `hata (${r.status})`);
  return r.data as T;
}

export const api = {
  /* Zarflar BURADA açılır — uygulamanın geri kalanı düz alanları görür. `sonVeri` de AÇIK
     hâli tutar: türetilen tutarlar ve kısmi güncellemede zarfın yeniden kurulması onu okur. */
  all: () => fetch("/api/all").then((r) => j<AllData>(r)).then((d) => { const a = veriAc(d); veriAyarla(a); return a; }),
  post: (route: string, body: unknown) => yazJ("POST", `/${route}`, body),
  put: (route: string, body: unknown) => yazJ("PUT", `/${route}`, body),
  del: (route: string, id: number) => fetch(`/api/${route}/${id}`, { method: "DELETE" }).then(j),
  delPrice: (asset_type: string, symbol: string) =>
    fetch(`/api/prices/${asset_type}/${encodeURIComponent(symbol)}`, { method: "DELETE" }).then(j),
  refreshPrices: () => fetch("/api/prices/refresh", { method: "POST" }).then(j),
  /* ---- portföy grupları (Faz 11): işlemi gruba taşı (tutar/bakiye etkisi yok) ---- */
  setTradePortfolio: (tradeId: number, portfolio_id: number | null) => yazJ("PUT", `/trades/${tradeId}/portfolio`, { portfolio_id }),
  /* ---- toplu içe aktarma (ekstre yapıştırma) ---- */
  bulkTransactions: (rows: { date: string; name: string; amount: number; category_id: number | null; account_id: number | null }[]) => yazJ<{ inserted: number }>("POST", "/transactions/bulk", { rows }),
  /* ---- düzenli kalem tutar zaman çizelgesi (Faz 9) ---- */
  setRecurringAmount: (id: number, body: { amount: number; from_month: string | null }) => yazJ("POST", `/recurring/${id}/amount`, body),
  delRecurringAmount: (id: number, from_month: string) =>
    fetch(`/api/recurring/${id}/amount/${from_month}`, { method: "DELETE" }).then(j),
  /* ---- düzenli kalem gerçekleştirme (Faz 8) ---- */
  /* `amount` (E2EE aşama 1b): deftere/karta yazılacak tutar, İŞARETİYLE — sunucu artık
     tutar türetmiyor. Gönderilmezse sunucu yedek yoldan hesaplar (cron ve asistan için). */
  realizeRecurring: (id: number, ym: string, body: { account_id?: number | null; category_id?: number | null; amount?: number } = {}) => yazJ("POST", `/recurring/${id}/realize`, { ym, ...body }),
  unrealizeRecurring: (id: number, ym: string) =>
    fetch(`/api/recurring/${id}/realize/${ym}`, { method: "DELETE" }).then(j),
  /* ---- kart ekstresi ödeme (Faz 8.2) ---- */
  /* `date` (E2EE aşama 2): ödeme talimatıyla yazılan ekstrede VADE GÜNÜ gönderilir —
     otomatik ödeme artık uygulama açılışında yazıldığı için günler sonra da yazılabilir ve
     "bugün" demek ödemeyi bankanın çektiği günden koparırdı. Elle ödemede gönderilmez. */
  payStatement: (cardId: number, due: string, body: { account_id?: number | null; category_id?: number | null; amount?: number; date?: string } = {}) => yazJ("POST", `/cards/${cardId}/pay-statement`, { due, ...body }),
  unpayStatement: (cardId: number, due: string) =>
    fetch(`/api/cards/${cardId}/pay-statement/${due}`, { method: "DELETE" }).then(j),
  /* ---- AI asistan (Faz 22; sohbet Faz 34'te sunucuya taşındı; döngü E2EE aşama 4'te tarayıcıya) ----
     Sohbet sunucuda SAKLANIR (cihazlar arası devam eder), ama ajan döngüsü tarayıcıda koşar
     ve geçmişi tarayıcı verir — Faz 34'ün "istemci uydurma tur enjekte edemez" güvencesi
     bilerek düştü (bkz. features/asistan/istemci.ts ve docs/E2EE.md §4.4). */
  /* `neden`: "anahtar" = sunucuda AI_API_KEY yok, "kapali" = kullanıcı kendi kapattı. İkisi
     ayrı çünkü arayüzün söyleyeceği şey ayrı (env kurulumu vs geri açma düğmesi). */
  aiStatus: () => fetch("/api/ai/status").then((r) => j<{ enabled: boolean; model: string | null; neden: "anahtar" | "kapali" | null }>(r)),
  /** Son harekete göre sıralı; sayfalama keyset (son satırın `at` + `id`'si imleçtir) */
  aiKonusmalar: (imlec?: { at: string; id: number }) =>
    fetch(`/api/ai/conversations${imlec ? `?beforeAt=${encodeURIComponent(imlec.at)}&beforeId=${imlec.id}` : ""}`)
      .then((r) => j<{ conversations: AiKonusma[]; more: boolean }>(r)),
  aiSohbet: (id: number) => fetch(`/api/ai/conversations/${id}`).then((r) => j<AiSohbet>(r)),
  /** Başlığı yeniden adlandırır; sıralamayı (son konuşma zamanı) BİLEREK değiştirmez */
  aiSohbetAdlandir: (id: number, title: string) => yazJ<{ ok: true; title: string }>("PUT", `/ai/conversations/${id}`, { title }),
  aiSohbetSil: (id: number) => fetch(`/api/ai/conversations/${id}`, { method: "DELETE" }).then(j),
  /* ---- E2EE aşama 4: sunucu = röle + depo. Döngüyü `features/asistan/istemci.ts` koşturur;
     bu uçları DOĞRUDAN çağırma, oradan geç. ---- */
  /* Röle BİLEREK boru hattının DIŞINDA: bağlam sağlayıcıya düz metin gider ve gitmeli — model
     şifreli veriyle çalışamaz. Bu arayüzde yazılı ("yanıtı üretmesi için sağlayıcıya gönderilir"). */
  aiRelay: (context: UserContext, messages: ChatMessage[]) =>
    fetch("/api/ai/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, messages }) })
      .then((r) => j<{ text: string; toolCalls: ChatResult["toolCalls"]; model: string }>(r)),
  aiMesaj: (m: { conversationId?: number | null; role: "user" | "assistant"; content: string; title?: string; planId?: string | null }) => yazJ<{ conversationId: number }>("POST", "/ai/messages", m),
  aiPlanKaydet: (conversationId: number, actions: AiAction[]) => yazJ<{ planId: string }>("POST", "/ai/plans", { conversationId, actions }),
  aiPlanTuket: (planId: string) =>
    fetch(`/api/ai/plans/${encodeURIComponent(planId)}/consume`, { method: "POST" })
      .then((r) => j<{ conversationId: number | null; actions: AiAction[] }>(r)),
  aiGunlukYaz: (planId: string, items: { tool: string; summary: string; undo_method: string; undo_path: string }[]) => yazJ("POST", `/ai/plans/${encodeURIComponent(planId)}/actions`, { items }),
  aiGunlukOku: (planId: string) =>
    fetch(`/api/ai/plans/${encodeURIComponent(planId)}/actions`)
      .then((r) => j<{ actions: { id: number; summary: string; undo_method: string; undo_path: string; conversation_id: number | null }[] }>(r)),
  aiGeriAlindi: (planId: string, ids: number[]) => yazJ("POST", `/ai/plans/${encodeURIComponent(planId)}/undone`, { ids }),
  /* ---- auth (Faz 5.1) ---- */
  me: () => fetch("/api/auth/me").then((r) => j<{ user: SessionUser | null }>(r)),
  /* ---- sıfır bilgi girişi (E2EE aşama 3b) ----
     Bu uçları DOĞRUDAN çağırma — `features/auth/e2ee.ts` üzerinden geç. Parola yalnız orada
     türetilir; ekranlardan buraya ham parola taşıyan ikinci bir yol olmamalı. */
  prelogin: (email: string) =>
    fetch("/api/auth/prelogin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
      .then((r) => j<{ kdf: "legacy" } | { kdf: "v2"; salt: string; params: { alg: string; iter: number } }>(r)),
  /** `password` yalnız legacy (henüz yükseltilmemiş) hesapta, ve o zaman `upgrade` ile birlikte gönderilir */
  login: (email: string, kanit: { auth_token: string } | { password: string; upgrade: E2eeMalzeme }) =>
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, ...kanit }) })
      .then((r) => j<{ user: SessionUser; yukseltildi: boolean; dek_wrapped_pw: string | null }>(r)),
  register: (email: string, malzeme: E2eeMalzeme) =>
    fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, ...malzeme }) })
      .then((r) => j<{ user?: SessionUser; pending?: boolean }>(r)),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then(j),
  /* ---- şifre sıfırlama + aktivasyon (Faz 6) ---- */
  forgot: (email: string) =>
    fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(j),
  reset: (token: string, malzeme: E2eeMalzeme) =>
    fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...malzeme }) }).then(j),
  verify: (token: string) =>
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(j),
  resendVerify: (email: string) =>
    fetch("/api/auth/resend-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(j),
  /* ---- KVKK (Faz 5.4) ---- */
  /* Dışa aktarma zarfları İSTEMCİDE açar: sunucu zarfların içini okuyamaz (aşama 6'da şifreli),
     yani ham yanıtı indirmek kullanıcıya işe yaramaz bir yedek verirdi. Tablo anahtarları
     `/api/all` ile aynı olduğundan aynı `veriAc` kullanılır. */
  exportData: async () => {
    const r = await fetch("/api/export");
    if (!r.ok) throw new ApiError(r.status, "İndirilemedi");
    const acik = veriAc(await r.json());
    return new Blob([JSON.stringify(acik, null, 2)], { type: "application/json" });
  },
  /** Kanıt hesap türüne göre `e2ee.parolaKaniti` ile üretilir (v2: auth_token, legacy: password). */
  deleteAccount: (kanit: { password?: string; auth_token?: string }) =>
    fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kanit) }).then(j),
};
