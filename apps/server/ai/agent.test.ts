import { describe, it, expect } from "vitest";
import { agentLoop, executeActions, consumePlan, type AgentDeps, type PendingAction } from "./index.js";
import type { AiProvider, ChatRequest, ChatResult, ToolCall } from "./provider.js";
import { ROUTE_TOOLS } from "./tools.js";

/* Ajan döngüsünün sözleşmesi: OKUMA araçları çalışır, YAZMA araçları YALNIZ PLANLANIR.
   Bu dosyanın koruduğu şey tam olarak bu ayrım — bir gün "planla" dalı yanlışlıkla
   "uygula"ya bağlanırsa (ya da eksik argümanlı bir çağrı plana sızarsa) test düşer.
   Sahte sağlayıcı sayesinde ne model ne veritabanı gerekir. */

/** Sırayla verilen yanıtları döndüren sahte model; gördüğü istekleri kaydeder. */
function fakeProvider(turns: Partial<ChatResult>[]): AiProvider & { seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    label: "fake/test",
    seen,
    async chat(req) {
      seen.push(structuredClone(req));
      const t = turns[Math.min(i++, turns.length - 1)] ?? {};
      return { text: t.text ?? "", toolCalls: t.toolCalls ?? [] };
    },
  };
}
const call = (name: string, args: Record<string, unknown> = {}, id = name): ToolCall => ({ id, name, args });

/** Okuma çağrılarını kaydeden varsayılan bağımlılıklar */
function deps(provider: AiProvider, over: Partial<AgentDeps> = {}): AgentDeps & { reads: string[] } {
  const reads: string[] = [];
  return {
    provider,
    system: "test",
    reads,
    runRead: async (name, args) => { reads.push(`${name}:${JSON.stringify(args)}`); return { ok: true }; },
    summarize: async (tool, args) => `${tool.name}(${Object.keys(args).sort().join(",")})`,
    ...over,
  } as AgentDeps & { reads: string[] };
}

describe("agentLoop — okuma araçları", () => {
  it("okuma aracını çalıştırır ve sonucunu modele geri besler", async () => {
    const p = fakeProvider([{ toolCalls: [call("kart_ekstreleri", { card_id: 1 })] }, { text: "Ekstren 3.200 TL." }]);
    const d = deps(p);
    const res = await agentLoop(d, [{ role: "user", content: "ekstrem ne kadar" }]);
    expect(d.reads).toEqual(['kart_ekstreleri:{"card_id":1}']);
    expect(res.pending).toHaveLength(0); // okuma hiçbir şey planlamaz
    expect(res.reply).toBe("Ekstren 3.200 TL.");
    // ikinci turda araç sonucu konuşmaya girmiş olmalı
    const toolMsg = p.seen[1].messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ role: "tool", name: "kart_ekstreleri", result: { ok: true } });
  });

  it("okuma aracı patlarsa döngü çökmez, hata modele geri döner", async () => {
    const p = fakeProvider([{ toolCalls: [call("pozisyonlar")] }, { text: "Bakamadım." }]);
    const d = deps(p, { runRead: async () => { throw new Error("db yok"); } });
    const res = await agentLoop(d, [{ role: "user", content: "pozisyonlarım" }]);
    expect(res.reply).toBe("Bakamadım.");
    expect(p.seen[1].messages.find((m) => m.role === "tool")).toMatchObject({ result: { hata: "db yok" } });
  });
});

describe("agentLoop — yazma araçları yalnız planlanır", () => {
  it("yazma aracını ÇALIŞTIRMAZ, onay bekleyen plana alır", async () => {
    const p = fakeProvider([
      { toolCalls: [call("islem_ekle", { date: "2026-08-12", name: "Market", amount: -850 })] },
      { text: "Hazırladım." },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "markete 850 harcadım" }]);
    expect(res.pending).toEqual([{
      tool: "islem_ekle",
      args: { date: "2026-08-12", name: "Market", amount: -850 },
      summary: "islem_ekle(amount,date,name)",
    }]);
    // modele "planlandı" denmeli — "uygulandı" DEĞİL (yoksa model işi bitmiş sanır)
    const result = p.seen[1].messages.find((m) => m.role === "tool")!.result as any;
    expect(result.durum).toContain("onayı bekleniyor");
  });

  it("eksik zorunlu alanı plana almaz, modele hata olarak döndürür", async () => {
    const p = fakeProvider([{ toolCalls: [call("islem_ekle", { date: "2026-08-12", name: "Market" })] }, { text: "Tutar?" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "markete harcadım" }]);
    expect(res.pending).toHaveLength(0);
    expect(p.seen[1].messages.find((m) => m.role === "tool")!.result).toEqual({ hata: "eksik zorunlu alan: amount" });
  });

  it("bilinmeyen araç adı sessizce yutulmaz", async () => {
    const p = fakeProvider([{ toolCalls: [call("hesabi_sil", { id: 1 })] }, { text: "Yapamam." }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "hesabımı sil" }]);
    expect(res.pending).toHaveLength(0);
    expect(p.seen[1].messages.find((m) => m.role === "tool")!.result).toEqual({ hata: "böyle bir araç yok" });
  });

  it("tek istekte planlanan işlem sayısı tavanla sınırlıdır", async () => {
    const many = Array.from({ length: 15 }, (_, i) => call("islem_ekle", { date: "2026-08-12", name: `X${i}`, amount: -1 }, `c${i}`));
    const p = fakeProvider([{ toolCalls: many }, { text: "bitti" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "15 işlem" }]);
    expect(res.pending).toHaveLength(12);
    const results = p.seen[1].messages.filter((m) => m.role === "tool").map((m: any) => m.result);
    expect(results[12]).toMatchObject({ hata: expect.stringContaining("en fazla 12") });
  });

  it("model durmadan araç çağırsa bile tur sayısı sınırlıdır (sonsuz döngü/kota koruması)", async () => {
    const p = fakeProvider([{ toolCalls: [call("pozisyonlar")] }]); // her turda aynı yanıt
    const res = await agentLoop(deps(p), [{ role: "user", content: "dönde dur" }]);
    expect(p.seen).toHaveLength(6);
    expect(res.reply).toBe("Bunu anlayamadım, biraz daha açar mısın?"); // model hiç metin üretmedi
  });

  it("araçsız yanıtta düz sohbet döner", async () => {
    const p = fakeProvider([{ text: "Hangi karttan?" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "ekstre ödedim" }]);
    expect(res).toEqual({ reply: "Hangi karttan?", pending: [] });
  });
});

describe("executeActions", () => {
  type Sent = { method: string; path: string; body: unknown };
  const recorder = (responses: { status: number; data: any }[] = []) => {
    const sent: Sent[] = [];
    let i = 0;
    const invoke = async (_c: unknown, method: string, path: string, body?: unknown) => {
      sent.push({ method, path, body });
      return responses[i++] ?? { status: 200, data: { id: 1 } };
    };
    return { sent, invoke };
  };
  const action = (tool: string, args: Record<string, unknown>): PendingAction => ({ tool, args, summary: tool });

  it("yol parametresini yola koyar, gövdeden çıkarır", async () => {
    const r = recorder();
    await executeActions({}, [action("ekstre_ode", { id: 7, due: "2026-08-14", account_id: 3 })], r.invoke);
    expect(r.sent).toEqual([{ method: "POST", path: "/cards/7/pay-statement", body: { due: "2026-08-14", account_id: 3 } }]);
  });

  it("DELETE gövdesiz gider", async () => {
    const r = recorder();
    await executeActions({}, [action("islem_sil", { id: 42 })], r.invoke);
    expect(r.sent).toEqual([{ method: "DELETE", path: "/transactions/42", body: undefined }]);
  });

  it("ilk hatada durur; kalanları uygulamaz ama sessizce atlamaz", async () => {
    const r = recorder([{ status: 400, data: { error: "tarih zorunlu" } }]);
    const out = await executeActions({}, [
      action("islem_ekle", { date: "", name: "A", amount: -1 }),
      action("islem_ekle", { date: "2026-08-12", name: "B", amount: -2 }),
    ], r.invoke);
    expect(r.sent).toHaveLength(1); // ikincisi hiç gönderilmedi
    expect(out[0]).toMatchObject({ ok: false, detail: "tarih zorunlu" });
    expect(out[1]).toMatchObject({ ok: false, detail: "önceki adım başarısız olduğu için uygulanmadı" });
  });

  it("idempotent uçların 'zaten kayıtlı' yanıtını başarı sayar ama ayırt eder", async () => {
    const r = recorder([{ status: 200, data: { ok: true, already: true } }]);
    const out = await executeActions({}, [action("ekstre_ode", { id: 1, due: "2026-08-14" })], r.invoke);
    expect(out[0]).toMatchObject({ ok: true, detail: "zaten kayıtlıydı" });
  });

  it("yaratılan kaydın geri alma tarifini üretir (id ucun yanıtından gelir)", async () => {
    const r = recorder([{ status: 200, data: { id: 77 } }]);
    const out = await executeActions({}, [action("islem_ekle", { date: "2026-08-12", name: "Market", amount: -850 })], r.invoke);
    expect(out[0].undo).toEqual({ method: "DELETE", path: "/transactions/77" });
  });

  it("'zaten kayıtlıydı' yanıtında geri alma önerilmez (o kaydı asistan yaratmadı)", async () => {
    const r = recorder([{ status: 200, data: { ok: true, already: true } }]);
    const out = await executeActions({}, [action("ekstre_ode", { id: 1, due: "2026-08-14" })], r.invoke);
    expect(out[0].undo).toBeUndefined();
  });

  it("düzenleme/silme geri alınamaz (eski hâl saklanmıyor)", async () => {
    const r = recorder([{ status: 200, data: { ok: true } }, { status: 200, data: { ok: true } }]);
    const out = await executeActions({}, [
      action("islem_duzenle", { id: 5, date: "2026-08-12", name: "X", amount: -1 }),
      action("islem_sil", { id: 6 }),
    ], r.invoke);
    expect(out.every((o) => o.ok && o.undo === undefined)).toBe(true);
  });

  it("istemci uydurma bir araç adı gönderirse çalıştırmaz", async () => {
    const r = recorder();
    const out = await executeActions({}, [action("hesap_sil", { id: 1 })], r.invoke);
    expect(r.sent).toHaveLength(0);
    expect(out[0]).toMatchObject({ ok: false, detail: "bilinmeyen araç" });
  });
});

describe("plan kimliği tek kullanımlıktır", () => {
  it("aynı plan ikinci kez uygulanamaz (ağ tekrarında çift kayıt olurdu)", () => {
    expect(consumePlan("9:plan-abc")).toBe(true);
    expect(consumePlan("9:plan-abc")).toBe(false);
    expect(consumePlan("9:plan-xyz")).toBe(true); // farklı plan etkilenmez
  });
});

describe("araç kaydı", () => {
  it("kayıt YARATAN her araç geri alınabilir olmalı", () => {
    // "..._ekle" ve gerçekleştirme/ödeme araçları kayıt yaratır → geri alma tarifi şart.
    // (Aksi hâlde kullanıcı yanlış uygulanan planı arayüzde tek tek aramak zorunda kalır.)
    const yaratanlar = ROUTE_TOOLS.filter((t) => t.name.endsWith("_ekle") || ["ekstre_ode", "duzenli_kalem_gerceklestir", "fiyat_belirle"].includes(t.name));
    expect(yaratanlar.filter((t) => !t.undo).map((t) => t.name)).toEqual([]);
  });

  it("her aracın adı benzersiz ve şeması tutarlı", () => {
    const names = ROUTE_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ROUTE_TOOLS) {
      // zorunlu alanlar şemada tanımlı olmalı (model 'eksik alan' hatasını asla çözemezdi)
      for (const req of t.parameters.required ?? []) expect(t.parameters.properties).toHaveProperty(req);
      // yol parametreleri hem şemada hem yolda geçmeli
      for (const p of t.pathParams ?? []) {
        expect(t.path).toContain(`:${p}`);
        expect(t.parameters.properties).toHaveProperty(p);
      }
      // yolda geçen her parametre pathParams'ta bildirilmeli (yoksa gövdeye sızar, yol bozulur)
      for (const m of t.path.matchAll(/:(\w+)/g)) expect(t.pathParams ?? []).toContain(m[1]);
    }
  });
});
