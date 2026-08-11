/* ============================================================================
   Asistan ajanı + uçları (Faz 22)
   ----------------------------------------------------------------------------
   Akış iki fazlıdır ve bu bilinçlidir — para hareketi doğuran hiçbir şey model
   "öyle anladı" diye yazılmaz:

     1) POST /api/ai/chat     → model konuşur. OKUMA araçlarını serbestçe
        çalıştırır; YAZMA araçlarını çalıştırmaz, "planlanan işlem" olarak
        biriktirir ve kullanıcıya insan-okur özetleriyle döner.
     2) POST /api/ai/execute  → kullanıcı onayladıktan sonra planlanan işlemler
        SIRAYLA gerçek uçlara uygulanır.

   Yazma işlemleri, kullanıcının **kendi oturum çerezi** ile aynı Hono
   uygulamasına iç istek olarak gider: guard yeniden çalışır, tenant-scope,
   doğrulama ve bakiye/defter yan etkileri ucun kendi kodundan gelir. Yani
   asistan ayrıcalıklı bir yol açmaz — kullanıcının arayüzde yapabildiğinden
   fazlasını yapamaz. */

import { randomUUID } from "node:crypto";
import { getProvider, type ChatMessage, type ToolDef } from "./provider.js";
import { ROUTE_TOOLS, type ArgVals } from "./tools.js";
import { READ_TOOLS } from "./read.js";
import { buildContext, nameLookup, type UserContext } from "./context.js";
import { enrichSummary } from "./enrich.js";

/** İç istek gönderici — index.ts sağlar (kök Hono uygulaması orada). */
export type Invoke = (c: any, method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

/** Kullanıcı onayı bekleyen tek bir yazma işlemi */
export type PendingAction = { tool: string; args: ArgVals; summary: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_STEPS = 6;        // araç turu üst sınırı (sonsuz döngü / kota yakma koruması)
const MAX_PENDING = 12;     // tek istekte planlanabilecek işlem sayısı
const MAX_HISTORY = 20;     // istemciden gelen geçmişte tutulan tur sayısı

const toolDefs = (): ToolDef[] => [
  ...READ_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
  ...ROUTE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
];

function systemPrompt(ctx: UserContext): string {
  return [
    "Sen bir kişisel finans panelinin Türkçe asistanısın. Kullanıcının kendi verisi üzerinde çalışırsın.",
    "Görevin: kullanıcının doğal dille anlattığı finansal olayları doğru araç çağrılarına çevirmek.",
    "",
    "KURALLAR",
    `- Bugünün tarihi: ${ctx.bugun}. Göreli tarihleri (dün, geçen cuma, 11 temmuzda) buna göre çöz.`,
    "- Yıl söylenmediyse tarih GEÇMİŞTEDİR: bugünden önceki en yakın o günü seç (gelecek yıl seçme).",
    "- Para birimi söylenmediyse TRY'dir. Gerçekleşen giderler NEGATİF, gelirler POZİTİF tutarla yazılır.",
    "- Hesap/kart/kategori/portföy adlarını aşağıdaki listeden id'ye çevir. Eşleşme bulamazsan ID UYDURMA:",
    "  hangisini kastettiğini sor ya da o alanı boş bırak.",
    "- Kullanıcı bir işlemi anlattığında onay isteme cümlesi kurma; doğrudan ilgili aracı çağır.",
    "  Onayı sistem kullanıcıdan kendisi alır (araç çağrıların 'planlandı' olarak döner, bu normaldir).",
    "- Bir cümlede birden fazla olay varsa (örn. fon sattım + kart ekstresini ödedim) her biri için ayrı araç çağır.",
    "- Zorunlu bir bilgi eksikse (tutar, tarih, hangi kart) araç çağırmak yerine kısa bir soru sor.",
    "- Aynı olayı iki kez kaydetme. Emin değilsen önce okuma araçlarıyla (kayit_ara, pozisyonlar, kart_ekstreleri) bak.",
    "- Yanıtların kısa ve net olsun: ne yapıldığını/ne planlandığını bir iki cümlede özetle.",
    "",
    "KULLANICININ TANIMLARI (id'ler buradan):",
    JSON.stringify(ctx, null, 0),
  ].join("\n");
}

/** Zorunlu alan kontrolü — modele geri beslenir ki eksik argümanı kendisi tamamlasın. */
function missingFields(args: ArgVals, required: string[] = []): string[] {
  return required.filter((f) => args[f] === undefined || args[f] === null || args[f] === "");
}

export type ChatResponse = { reply: string; pending: PendingAction[]; model: string; planId: string };

/* Bir planın iki kez uygulanmasını engeller. Onay düğmesi istemcide kilitli olsa da ağ
   hatasından sonraki bir tekrar denemesi aynı işlemi ikinci kez yazardı: kart ekstresi
   ödemesi ve düzenli kalem gerçekleştirme sunucuda idempotent, ama gelir/gider ve portföy
   işlemi DEĞİL — çift kayıt bakiyeyi iki kez oynatırdı. Plan kimliği tek kullanımlıktır. */
const consumedPlans = new Map<string, number>();
const PLAN_TTL = 30 * 60_000;
function consumePlan(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of consumedPlans) if (now - t > PLAN_TTL) consumedPlans.delete(k);
  if (consumedPlans.has(key)) return false;
  consumedPlans.set(key, now);
  return true;
}

export async function runAgent(uid: number, history: ChatTurn[]): Promise<ChatResponse> {
  const provider = getProvider();
  if (!provider) throw new Error("AI yapılandırılmadı");
  const ctx = await buildContext(uid);
  const names = nameLookup(ctx);
  const messages: ChatMessage[] = history.slice(-MAX_HISTORY).map((t) =>
    t.role === "user" ? { role: "user", content: t.content } : { role: "assistant", content: t.content },
  );
  const pending: PendingAction[] = [];
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await provider.chat({ system: systemPrompt(ctx), messages, tools: toolDefs() });
    reply = res.text || reply;
    if (!res.toolCalls.length) break;
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });

    for (const call of res.toolCalls) {
      let result: unknown;
      const read = READ_TOOLS.find((t) => t.name === call.name);
      const write = ROUTE_TOOLS.find((t) => t.name === call.name);
      if (read) {
        result = await read.run(uid, call.args).catch((e) => ({ hata: String((e as Error).message).slice(0, 200) }));
      } else if (write) {
        const missing = missingFields(call.args, write.parameters.required);
        if (missing.length) result = { hata: `eksik zorunlu alan: ${missing.join(", ")}` };
        else if (pending.length >= MAX_PENDING) result = { hata: "tek seferde en fazla " + MAX_PENDING + " işlem planlanabilir" };
        else {
          /* Özet, sunucunun hesapladığı tutarla zenginleştirilir (ekstre tutarı, düzenli
             kalemin o ayki tutarı, mutabakat farkı) — kullanıcı neyi onayladığını görsün. */
          const summary = await enrichSummary(uid, write.name, call.args, safeSummary(write, call.args, names));
          pending.push({ tool: write.name, args: call.args, summary });
          result = { durum: "planlandı, kullanıcının onayı bekleniyor", ozet: summary };
        }
      } else {
        result = { hata: "böyle bir araç yok" };
      }
      messages.push({ role: "tool", callId: call.id, name: call.name, result });
    }
  }
  if (!reply) reply = pending.length ? "Aşağıdaki işlemleri hazırladım, onaylarsan uygulayayım." : "Bunu anlayamadım, biraz daha açar mısın?";
  return { reply, pending, model: provider.label, planId: randomUUID() };
}

/** Özet üreticisi kullanıcı verisiyle çalışır; beklenmedik argümanda çökmemeli. */
function safeSummary(tool: (typeof ROUTE_TOOLS)[number], args: ArgVals, names: ReturnType<typeof nameLookup>): string {
  try { return tool.summary(args, names); } catch { return `${tool.name}: ${JSON.stringify(args).slice(0, 160)}`; }
}

export type ExecutionResult = { summary: string; ok: boolean; detail: string };

/** Onaylanan işlemleri sırayla uygular. İlk hatada durur — yarım kalan kısım
    açıkça "uygulanmadı" olarak döner, sessizce atlanmaz. */
export async function executeActions(c: any, actions: PendingAction[], invoke: Invoke): Promise<ExecutionResult[]> {
  const out: ExecutionResult[] = [];
  let stopped = false;
  for (const a of actions) {
    const tool = ROUTE_TOOLS.find((t) => t.name === a.tool);
    if (!tool) { out.push({ summary: a.summary, ok: false, detail: "bilinmeyen araç" }); stopped = true; continue; }
    if (stopped) { out.push({ summary: a.summary, ok: false, detail: "önceki adım başarısız olduğu için uygulanmadı" }); continue; }
    const args = { ...a.args };
    let path = tool.path;
    for (const p of tool.pathParams ?? []) {
      path = path.replace(`:${p}`, encodeURIComponent(String(args[p] ?? "")));
      delete args[p];
    }
    const res = await invoke(c, tool.method, path, tool.method === "DELETE" ? undefined : args)
      .catch((e) => ({ status: 500, data: { error: String((e as Error).message) } }));
    if (res.status >= 400) {
      out.push({ summary: a.summary, ok: false, detail: res.data?.error || `sunucu hatası (${res.status})` });
      stopped = true;
    } else {
      out.push({ summary: a.summary, ok: true, detail: res.data?.already ? "zaten kayıtlıydı" : "uygulandı" });
    }
  }
  return out;
}

/* ---------------- HTTP uçları ---------------- */
type RateLimiter = (key: string, max: number, windowMs: number) => boolean;

export function mountAi(api: any, deps: { invoke: Invoke; rateLimited: RateLimiter }): void {
  api.get("/ai/status", (c: any) => c.json({ enabled: !!getProvider(), model: getProvider()?.label ?? null }));

  api.post("/ai/chat", async (c: any) => {
    const uid = c.get("user").id;
    if (!getProvider()) return c.json({ error: "Asistan yapılandırılmadı (AI_API_KEY eksik)" }, 503);
    if (deps.rateLimited(`ai:${uid}`, 30, 5 * 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
    const b = await c.req.json().catch(() => null);
    const raw = b && Array.isArray(b.messages) ? b.messages : null;
    if (!raw?.length) return c.json({ error: "mesaj yok" }, 400);
    const history: ChatTurn[] = [];
    for (const m of raw) {
      if (!m || typeof m.content !== "string" || (m.role !== "user" && m.role !== "assistant")) {
        return c.json({ error: "geçersiz mesaj" }, 400);
      }
      history.push({ role: m.role, content: m.content.slice(0, 4000) });
    }
    try {
      return c.json(await runAgent(uid, history));
    } catch (e) {
      console.error("[ai] sohbet hatası:", e);
      return c.json({ error: String((e as Error).message).slice(0, 200) }, 502);
    }
  });

  api.post("/ai/execute", async (c: any) => {
    const uid = c.get("user").id;
    if (deps.rateLimited(`aiexec:${uid}`, 30, 5 * 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
    const b = await c.req.json().catch(() => null);
    const actions = b && Array.isArray(b.actions) ? b.actions : null;
    if (!actions?.length) return c.json({ error: "işlem yok" }, 400);
    if (actions.length > MAX_PENDING) return c.json({ error: "çok fazla işlem" }, 400);
    for (const a of actions) {
      if (!a || typeof a.tool !== "string" || !a.args || typeof a.args !== "object") return c.json({ error: "geçersiz işlem" }, 400);
    }
    const planId = typeof b.planId === "string" ? b.planId : "";
    if (!planId) return c.json({ error: "plan kimliği gerekli" }, 400);
    // tek kullanımlık: aynı plan ikinci kez uygulanmaz (ağ tekrarında çift kayıt olurdu)
    if (!consumePlan(`${uid}:${planId}`)) return c.json({ error: "Bu plan zaten uygulandı" }, 409);
    const results = await executeActions(c, actions as PendingAction[], deps.invoke);
    console.log(`[audit] Asistan ${results.filter((r) => r.ok).length}/${results.length} işlem uyguladı (id:${uid})`);
    return c.json({ results });
  });
}
