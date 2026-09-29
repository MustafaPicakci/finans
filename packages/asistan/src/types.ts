/* Sağlayıcıdan bağımsız konuşma tipleri. Buradaki `AiProvider` bir ARAYÜZDÜR — gerçek
   uygulaması (API anahtarları, HTTP çağrısı) sunucuda kalır (apps/server/ai/provider.ts),
   çünkü anahtarlar tarayıcıya inmemeli. Ajan döngüsü yalnız bu arayüzü görür; E2EE aşama
   4'te tarayıcıdaki uygulaması sunucudaki röleyi çağıran ince bir sarmalayıcı olacak. */

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
