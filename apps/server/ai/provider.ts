/* ============================================================================
   AI sağlayıcı soyutlaması (Faz 22)
   ----------------------------------------------------------------------------
   Asistanın geri kalanı (araç kaydı, ajan döngüsü, arayüz) hangi modelin
   konuştuğunu BİLMEZ: yalnız bu dosyadaki `AiProvider` arayüzünü görür. Model
   değiştirmek = env değiştirmek; kod değiştirmek gerekirse yalnız bu dosyaya
   yeni bir `chat()` uyarlayıcısı eklenir.

   Desteklenen iki konuşma protokolü (piyasadaki neredeyse her sağlayıcı bu
   ikisinden birini konuşur):
     - `gemini`  → Google Generative Language REST (ücretsiz kotalı AI Studio anahtarı)
     - `openai`  → /chat/completions uyumlu her uç (Groq, OpenRouter, Together,
                   yerel Ollama/LM Studio, OpenAI'nin kendisi…)

   Env:
     AI_PROVIDER = gemini | openai        (varsayılan: gemini)
     AI_MODEL    = model kimliği          (varsayılan: sağlayıcıya göre)
     AI_API_KEY  = anahtar                (yoksa asistan kapalıdır — uç 503 döner)
     AI_BASE_URL = openai modunda taban URL (örn. https://api.groq.com/openai/v1)

   Araç çağrısı (function calling) ZORUNLU bir yetenektir: asistanın tek işi
   araç çağırmak. Araç çağıramayan bir model buraya takılırsa sohbet eder ama
   hiçbir kayıt oluşturamaz — bu yüzden model seçerken function calling şart. */

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[]; items?: unknown }>;
  required?: string[];
};
export type ToolDef = { name: string; description: string; parameters: JsonSchema };
/** `signature`: sağlayıcıya özgü, ajanın yorumlamadığı opak veri (Gemini 3.x'in
    `thoughtSignature`'ı). Sonraki turda AYNEN geri gönderilmezse düşünen modeller
    çok turlu araç çağrısını reddeder — bu yüzden ToolCall ile birlikte taşınır. */
export type ToolCall = { id: string; name: string; args: Record<string, unknown>; signature?: string };
/** Sağlayıcıdan bağımsız konuşma kaydı — ajan döngüsü yalnız bunu üretir/tüketir. */
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: unknown };
export type ChatResult = { text: string; toolCalls: ToolCall[] };
export type ChatRequest = { system: string; messages: ChatMessage[]; tools: ToolDef[] };

export interface AiProvider {
  /** Arayüzde "hangi model konuşuyor" bilgisi için (örn. "gemini/gemini-2.5-flash") */
  readonly label: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

const TIMEOUT_MS = 60_000; // yanıtsız sağlayıcıda istek sonsuza dek asılı kalmasın (mail.ts'teki aynı ders)

class AiError extends Error {}
/** Sağlayıcı hata metni istemciye de loga da gidiyor; anahtarın oraya sızmadığından
    emin ol (bazı servisler isteği/URL'i hata gövdesinde aynen geri yansıtır). */
const redactKey = (s: string): string => {
  const key = process.env.AI_API_KEY;
  return key && key.length > 8 ? s.split(key).join("***") : s;
};
/** Sağlayıcı hatalarını tek biçime indirger; anahtar/kota hatası kullanıcıya anlaşılır dönsün. */
async function fetchJson(url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new AiError(`AI servisine ulaşılamadı (${(e as Error).name === "TimeoutError" ? "zaman aşımı" : "ağ hatası"})`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || res.statusText;
    if (res.status === 429) throw new AiError("AI kotası doldu, biraz sonra tekrar dene");
    if (res.status === 401 || res.status === 403) throw new AiError("AI anahtarı geçersiz (AI_API_KEY)");
    throw new AiError(`AI hatası: ${redactKey(String(msg)).slice(0, 200)}`);
  }
  return body;
}

/* ---------------- Google Gemini (generativelanguage REST) ----------------
   Roller: "user" | "model". Araç sonucu da "user" rolünde `functionResponse`
   parçası olarak döner (Gemini'de ayrı bir "tool" rolü yoktur). */
function geminiProvider(model: string, key: string): AiProvider {
  return {
    label: `gemini/${model}`,
    async chat({ system, messages, tools }) {
      const contents: any[] = [];
      for (const m of messages) {
        if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.content }] });
        else if (m.role === "assistant") {
          const parts: any[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const t of m.toolCalls ?? []) {
            parts.push({ functionCall: { name: t.name, args: t.args }, ...(t.signature ? { thoughtSignature: t.signature } : {}) });
          }
          if (parts.length) contents.push({ role: "model", parts });
        } else {
          contents.push({ role: "user", parts: [{ functionResponse: { name: m.name, response: { sonuc: m.result } } }] });
        }
      }
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] : undefined,
        generationConfig: { temperature: 0 }, // finans: yaratıcılık istemiyoruz
      };
      const json = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
      );
      const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const toolCalls: ToolCall[] = [];
      let text = "";
      for (const [i, p] of parts.entries()) {
        if (p.text) text += p.text;
        if (p.functionCall) {
          toolCalls.push({
            id: p.functionCall.id ?? `${p.functionCall.name}-${i}`,
            name: p.functionCall.name, args: p.functionCall.args ?? {},
            signature: p.thoughtSignature, // Gemini 3.x: sonraki turda geri gönderilmesi zorunlu
          });
        }
      }
      return { text: text.trim(), toolCalls };
    },
  };
}

/* ---------------- OpenAI uyumlu /chat/completions ----------------
   Groq, OpenRouter, Together, Ollama, LM Studio… hepsi bu şemayı konuşur. */
function openaiProvider(model: string, key: string, baseUrl: string): AiProvider {
  return {
    label: `openai:${new URL(baseUrl).host}/${model}`,
    async chat({ system, messages, tools }) {
      const msgs: any[] = [{ role: "system", content: system }];
      for (const m of messages) {
        if (m.role === "user") msgs.push({ role: "user", content: m.content });
        else if (m.role === "assistant") {
          msgs.push({
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls?.length
              ? m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } }))
              : undefined,
          });
        } else {
          msgs.push({ role: "tool", tool_call_id: m.callId, content: JSON.stringify(m.result) });
        }
      }
      const json = await fetchJson(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0, messages: msgs,
          tools: tools.length ? tools.map((t) => ({ type: "function", function: t })) : undefined,
        }),
      });
      const msg = json?.choices?.[0]?.message ?? {};
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((t: any, i: number) => ({
        id: t.id ?? `call-${i}`,
        name: t.function?.name ?? "",
        args: safeArgs(t.function?.arguments),
      }));
      return { text: String(msg.content ?? "").trim(), toolCalls };
    },
  };
}
/** Küçük modeller argümanı bazen bozuk JSON üretir — çökmek yerine boş argüman
    döner, doğrulama katmanı "eksik alan" hatasını modele geri besler. */
function safeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try { const v = JSON.parse(String(raw ?? "{}")); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/* Varsayılan modeller. NOT: Google eski sürümleri yeni anahtarlara kapatıyor
   (gemini-2.5-flash "no longer available to new users" döner) — hesabına açık
   olanları `GET https://generativelanguage.googleapis.com/v1beta/models` ile
   listeleyip AI_MODEL'i ona göre sabitleyebilirsin. */
const DEFAULT_MODEL: Record<string, string> = { gemini: "gemini-3.6-flash", openai: "llama-3.3-70b-versatile" };

let cached: AiProvider | null | undefined;
/** Yapılandırılmış sağlayıcı; anahtar yoksa null (asistan kapalı). */
export function getProvider(): AiProvider | null {
  if (cached !== undefined) return cached;
  const kind = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const key = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL || DEFAULT_MODEL[kind] || "";
  if (!key || !model) return (cached = null);
  if (kind === "gemini") return (cached = geminiProvider(model, key));
  if (kind === "openai") return (cached = openaiProvider(model, key, process.env.AI_BASE_URL || "https://api.openai.com/v1"));
  console.warn(`[ai] bilinmeyen AI_PROVIDER: ${kind} — asistan kapalı`);
  return (cached = null);
}
export const aiConfigured = () => getProvider() !== null;
