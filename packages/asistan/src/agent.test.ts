import { describe, it, expect } from "vitest";
import { agentLoop, executeActions, konusmaBasligi, formatResults, tamamlandiDiyor, yapildiDiyor, sonucMesaji, KAYIT_YOK, type AgentDeps, type PendingAction } from "./agent.js";
import { ROUTE_TOOLS } from "./tools.js";
import type { AiProvider, ChatRequest, ChatResult, ToolCall } from "./types.js";

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

  it("plan varken işi BİTMİŞ gibi anlatan yanıt nötr cümleyle değiştirilir", async () => {
    const p = fakeProvider([
      { toolCalls: [call("islem_ekle", { date: "2026-08-12", name: "Market", amount: -850 })] },
      { text: "Garanti hesabından Migros'a 850 TL harcama kaydedildi." },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "markete 850 harcadım" }]);
    expect(res.pending).toHaveLength(1);
    expect(res.reply).toBe("Aşağıdaki işlemleri hazırladım, onaylarsan uygulayayım.");
  });
  it("plan varken doğru kipteki yanıt olduğu gibi kalır", async () => {
    const p = fakeProvider([
      { toolCalls: [call("islem_ekle", { date: "2026-08-12", name: "Market", amount: -850 })] },
      { text: "Migros harcamasını hazırladım, onaylarsan kaydedeceğim." },
    ]);
    expect((await agentLoop(deps(p), [{ role: "user", content: "markete 850 harcadım" }])).reply)
      .toBe("Migros harcamasını hazırladım, onaylarsan kaydedeceğim.");
  });
  it("plan YOKSA, veriye BAKILDIYSA geçmiş zaman serbesttir (geçmiş bir kaydı anlatmak doğrudur)", async () => {
    const p = fakeProvider([{ toolCalls: [call("kayit_ara", { q: "migros" })] }, { text: "12 Ağustos'ta Migros'a 850 TL harcama kaydedilmiş." }]);
    expect((await agentLoop(deps(p), [{ role: "user", content: "markete ne zaman harcamıştım" }])).reply).toContain("kaydedilmiş");
  });

  /* Gözlenen hata: model geçmişteki gerçek "✓ Kart harcaması: …" sonuç satırını kopyalayıp
     ARAÇ ÇAĞIRMADAN yazdı — onay kartı çıkmadı, kayıt yazılmadı, kullanıcı yazıldı sandı. */
  it("araç çağırmadan '✓' sonuç satırı yazan modele bir kez düzeltme verilir, aracı çağırırsa plan kurulur", async () => {
    const p = fakeProvider([
      { text: "✓ Kart harcaması: Akbank · Otobüs bileti · 2.000,00 ₺ · 2026-10-09" },
      { toolCalls: [call("kart_harcamasi_ekle", { card_id: 2, date: "2026-10-09", name: "Otobüs bileti", amount: 2000 })] },
      { text: "Akbank kartına 2.000 TL otobüs bileti harcamasını hazırladım, onaylarsan kaydedeceğim." },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "akbank kredi kartı 2000 tl otobüs bileti" }]);
    expect(res.pending).toHaveLength(1);
    expect(res.pending[0].tool).toBe("kart_harcamasi_ekle");
    expect(res.reply).toContain("onaylarsan");
    const duzeltme = p.seen[1].messages.at(-1)!;
    expect(duzeltme.role).toBe("user");
    expect((duzeltme as any).content).toContain("HİÇBİR KAYIT YAZILMADI");
  });
  it("düzeltmeden sonra da araç çağırmayıp 'yapıldı' diyorsa kullanıcıya yalan söylenmez", async () => {
    const p = fakeProvider([{ text: "✓ Kart harcaması: Akbank · Otobüs bileti · 2.000,00 ₺" }, { text: "Harcamayı kaydettim." }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "akbank 2000 otobüs" }]);
    expect(p.seen).toHaveLength(2); // tek düzeltme hakkı
    expect(res.pending).toHaveLength(0);
    expect(res.reply).toBe(KAYIT_YOK);
  });
  it("düzeltmeden sonra soru sorarsa soru olduğu gibi kalır", async () => {
    const p = fakeProvider([{ text: "Harcamayı ekledim." }, { text: "Akbank hesabından mı, Akbank kartından mı?" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "akbank 400 tl harcama" }]);
    expect(res.reply).toBe("Akbank hesabından mı, Akbank kartından mı?");
  });
  it("sonucMesaji gerçek uygulama sonucunu sistem kaydı olarak etiketler", () => {
    expect(sonucMesaji("✓ Kart harcaması: Garanti · Yemek")).toMatch(/^\[SİSTEM KAYDI[^\n]*\]\n✓ Kart harcaması/);
    expect(yapildiDiyor("Önce şunu sorayım:\n✓ Kart harcaması: X")).toBe(true);
    expect(yapildiDiyor("Hangi kartla ödedin?")).toBe(false);
  });
  it("tamamlandiDiyor: gözlenen gerçek yanıtları yakalar, plan kipini yakalamaz", () => {
    expect(tamamlandiDiyor("Axess kartınızın ekstresi (400 TL) Ana Hesap üzerinden ödendi olarak kaydedildi.")).toBe(true);
    expect(tamamlandiDiyor("Cüzdan'dan Ana Hesap'a 200 TL virman kaydedildi.")).toBe(true);
    expect(tamamlandiDiyor("20 TL fark için düzeltme kaydı oluşturuldu.")).toBe(true);
    expect(tamamlandiDiyor("THYAO alımını ekledim.")).toBe(true);
    expect(tamamlandiDiyor("İki işlemi hazırladım, onayına sunuyorum.")).toBe(false);
    expect(tamamlandiDiyor("Onaylarsan kaydedeceğim.")).toBe(false);
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

describe("agentLoop — plan içi başvuru (Faz 46)", () => {
  it("aynı planda açılacak hesaba eksi sıra numarasıyla bağlanır; modele plan sırası söylenir", async () => {
    const p = fakeProvider([
      { toolCalls: [call("hesap_ekle", { name: "Garanti", balance: 40000 }, "c1")] },
      { toolCalls: [call("duzenli_kalem_ekle", { kind: "income", name: "Maaş", day: 15, amount: 85000, account_id: -1 }, "c2")] },
      { text: "Hazırladım." },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "Garanti'de 40 bin var, maaşım 15'inde oraya yatıyor" }]);
    expect(res.pending.map((x) => x.tool)).toEqual(["hesap_ekle", "duzenli_kalem_ekle"]);
    expect((p.seen[1].messages.find((m) => m.role === "tool")!.result as any).plan_sirasi).toBe(1);
  });

  it("ileriye (henüz planlanmamış işleme) başvuru plana alınmaz", async () => {
    const p = fakeProvider([
      { toolCalls: [call("duzenli_kalem_ekle", { kind: "income", name: "Maaş", day: 15, amount: 1, account_id: -1 })] },
      { text: "?" },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "x" }]);
    expect(res.pending).toHaveLength(0);
    expect((p.seen[1].messages.find((m) => m.role === "tool")!.result as any).hata).toContain("plandaki 1. işlem yok");
  });

  it("yanlış türe başvuru reddedilir (hesap beklenen yerde kategori)", async () => {
    const p = fakeProvider([
      { toolCalls: [call("kategori_ekle", { name: "Maaş", kind: "income" }, "c1")] },
      { toolCalls: [call("islem_ekle", { date: "2026-09-01", name: "Maaş", amount: 1, account_id: -1 }, "c2")] },
      { text: "?" },
    ]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "x" }]);
    expect(res.pending.map((x) => x.tool)).toEqual(["kategori_ekle"]);
    expect((p.seen[2].messages.filter((m) => m.role === "tool").pop()!.result as any).hata).toContain("bu alanın istediği türde kayıt açmıyor");
  });

  it("kimlik alanı dışındaki eksi değer (gider tutarı) başvuru sayılmaz", async () => {
    const p = fakeProvider([{ toolCalls: [call("islem_ekle", { date: "2026-09-01", name: "İade", amount: -5 })] }, { text: "ok" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "x" }]);
    expect(res.pending).toHaveLength(1); // amount: -5 bir tutar, başvuru değil
  });

  it("kart: kesim/son ödeme günü aralık dışıysa plana alınmaz", async () => {
    const p = fakeProvider([{ toolCalls: [call("kart_ekle", { name: "Bonus", statement_day: 0, due_day: 10 })] }, { text: "?" }]);
    const res = await agentLoop(deps(p), [{ role: "user", content: "x" }]);
    expect(res.pending).toHaveLength(0);
    expect((p.seen[1].messages.find((m) => m.role === "tool")!.result as any).hata).toContain("kesim günü");
  });

  it("özet üreticisine o ana kadarki plan verilir (başvurulan kaydın adı için)", async () => {
    const planlar: number[] = [];
    const p = fakeProvider([
      { toolCalls: [call("hesap_ekle", { name: "Garanti" }, "c1"), call("islem_ekle", { date: "2026-09-01", name: "X", amount: 1, account_id: -1 }, "c2")] },
      { text: "ok" },
    ]);
    await agentLoop(deps(p, { summarize: async (t, _a, plan) => { planlar.push(plan.length); return t.name; } }), [{ role: "user", content: "x" }]);
    expect(planlar).toEqual([0, 1]);
  });
});

describe("executeActions", () => {
  type Sent = { method: string; path: string; body: unknown };
  const recorder = (responses: { status: number; data: any }[] = []) => {
    const sent: Sent[] = [];
    let i = 0;
    const invoke = async (method: string, path: string, body?: unknown) => {
      sent.push({ method, path, body });
      return responses[i++] ?? { status: 200, data: { id: 1 } };
    };
    return { sent, invoke };
  };
  const action = (tool: string, args: Record<string, unknown>): PendingAction => ({ tool, args, summary: tool });

  it("yol parametresini yola koyar, gövdeden çıkarır", async () => {
    const r = recorder();
    await executeActions([action("ekstre_ode", { id: 7, due: "2026-08-14", account_id: 3 })], r.invoke);
    expect(r.sent).toEqual([{ method: "POST", path: "/cards/7/pay-statement", body: { due: "2026-08-14", account_id: 3 } }]);
  });

  it("DELETE gövdesiz gider", async () => {
    const r = recorder();
    await executeActions([action("islem_sil", { id: 42 })], r.invoke);
    expect(r.sent).toEqual([{ method: "DELETE", path: "/transactions/42", body: undefined }]);
  });

  it("ilk hatada durur; kalanları uygulamaz ama sessizce atlamaz", async () => {
    const r = recorder([{ status: 400, data: { error: "tarih zorunlu" } }]);
    const out = await executeActions([
      action("islem_ekle", { date: "", name: "A", amount: -1 }),
      action("islem_ekle", { date: "2026-08-12", name: "B", amount: -2 }),
    ], r.invoke);
    expect(r.sent).toHaveLength(1); // ikincisi hiç gönderilmedi
    expect(out[0]).toMatchObject({ ok: false, detail: "tarih zorunlu" });
    expect(out[1]).toMatchObject({ ok: false, detail: "önceki adım başarısız olduğu için uygulanmadı" });
  });

  it("idempotent uçların 'zaten kayıtlı' yanıtını başarı sayar ama ayırt eder", async () => {
    const r = recorder([{ status: 200, data: { ok: true, already: true } }]);
    const out = await executeActions([action("ekstre_ode", { id: 1, due: "2026-08-14" })], r.invoke);
    expect(out[0]).toMatchObject({ ok: true, detail: "zaten kayıtlıydı" });
  });

  it("yaratılan kaydın geri alma tarifini üretir (id ucun yanıtından gelir)", async () => {
    const r = recorder([{ status: 200, data: { id: 77 } }]);
    const out = await executeActions([action("islem_ekle", { date: "2026-08-12", name: "Market", amount: -850 })], r.invoke);
    expect(out[0].undo).toEqual({ method: "DELETE", path: "/transactions/77" });
  });

  it("'zaten kayıtlıydı' yanıtında geri alma önerilmez (o kaydı asistan yaratmadı)", async () => {
    const r = recorder([{ status: 200, data: { ok: true, already: true } }]);
    const out = await executeActions([action("ekstre_ode", { id: 1, due: "2026-08-14" })], r.invoke);
    expect(out[0].undo).toBeUndefined();
  });

  it("düzenleme/silme geri alınamaz (eski hâl saklanmıyor)", async () => {
    const r = recorder([{ status: 200, data: { ok: true } }, { status: 200, data: { ok: true } }]);
    const out = await executeActions([
      action("islem_duzenle", { id: 5, date: "2026-08-12", name: "X", amount: -1 }),
      action("islem_sil", { id: 6 }),
    ], r.invoke);
    expect(out.every((o) => o.ok && o.undo === undefined)).toBe(true);
  });

  it("plan içi başvuruyu uygulama anında gerçek kimlikle değiştirir; geri alma gerçek kimliği kullanır", async () => {
    const r = recorder([{ status: 200, data: { id: 31 } }, { status: 200, data: { id: 88 } }]);
    const out = await executeActions([
      action("hesap_ekle", { name: "Garanti", balance: 40000 }),
      action("duzenli_kalem_ekle", { kind: "income", name: "Maaş", day: 15, amount: 85000, account_id: -1 }),
    ], r.invoke);
    expect(r.sent[1].body).toMatchObject({ account_id: 31 });
    expect(out.map((o) => o.undo?.path)).toEqual(["/accounts/31", "/recurring/88"]);
  });

  it("yol parametresine başvuru: aynı planda açılan kartın ekstresi", async () => {
    const r = recorder([{ status: 200, data: { id: 12 } }, { status: 200, data: { ok: true } }]);
    const out = await executeActions([
      action("kart_ekle", { name: "Bonus", statement_day: 15, due_day: 25 }),
      action("ekstre_ode", { id: -1, due: "2026-10-25" }),
    ], r.invoke);
    expect(r.sent[1].path).toBe("/cards/12/pay-statement");
    expect(out[1].undo).toEqual({ method: "DELETE", path: "/cards/12/pay-statement/2026-10-25" }); // id yol parametresiydi, tarif yine kurulur
  });

  it("✕ ile çıkarılan satıra bağlı işlem uygulanmaz ama zinciri DURDURMAZ; numaralar kaymaz", async () => {
    const r = recorder([{ status: 200, data: { id: 5 } }]);
    const out = await executeActions([
      action("hesap_ekle", { name: "Garanti" }),                                             // 0: çıkarıldı
      action("duzenli_kalem_ekle", { kind: "income", name: "Maaş", day: 15, amount: 1, account_id: -1 }), // 1: ona bağlı
      action("kategori_ekle", { name: "Kira", kind: "expense" }),                          // 2: bağımsız
    ], r.invoke, new Set([0]));
    expect(out.map((o) => [o.tool, o.ok])).toEqual([["duzenli_kalem_ekle", false], ["kategori_ekle", true]]);
    expect(out[0].detail).toContain("1. satır çıkarıldı");
    expect(r.sent.map((x) => x.path)).toEqual(["/categories"]);
  });

  it("istemci uydurma bir araç adı gönderirse çalıştırmaz", async () => {
    const r = recorder();
    const out = await executeActions([action("hesap_sil", { id: 1 })], r.invoke);
    expect(r.sent).toHaveLength(0);
    expect(out[0]).toMatchObject({ ok: false, detail: "bilinmeyen araç" });
  });
});

/* Faz 34 — plan kimliğinin TEK KULLANIMLIK olması artık burada sınanmıyor ve bu bilinçli:
   güvence JS'ten SQL'e taşındı (`UPDATE ai_plans SET consumed_at=… WHERE consumed_at IS NULL
   RETURNING`). Eskiden süreç içi bir Map'ti ve bu test onu doğruluyordu; ama Map süreç
   yeniden başlayınca boşaldığından asıl senaryoyu (Render'ın uyuttuğu sunucu + ağ tekrarı)
   hiç yakalayamıyordu. Sahte bir depoya karşı yazılacak yeni bir test de yalnız sahteyi
   doğrulardı — değişmezin yaşadığı yer tek bir atomik UPDATE. Aşağıdakiler ise saf: */

describe("konuşma başlığı", () => {
  it("ilk cümleden türer, satır sonlarını tek boşluğa indirir", () => {
    expect(konusmaBasligi("  Dün markete\n  850 TL harcadım  ")).toBe("Dün markete 850 TL harcadım");
  });
  it("uzun metni keser (liste satırı tek satırdır)", () => {
    const b = konusmaBasligi("x".repeat(200));
    expect(b.length).toBe(60);
    expect(b.endsWith("…")).toBe(true);
  });
  it("boş metinde bile bir başlık verir (listede adsız satır olmaz)", () => {
    expect(konusmaBasligi("   ")).toBe("Yeni sohbet");
  });
});

/* Sonuç dökümü artık SOHBETE yazılıyor, yani kalıcı: başarısız adımın sebebi de görünmeli
   (eskiden istemcide üretilen uçucu bir metindi). */
describe("formatResults", () => {
  it("başarılı/başarısız ayrımını ve sebebi yazar", () => {
    expect(formatResults([
      { summary: "Gider: Migros · 850,00 ₺", ok: true, detail: "uygulandı" },
      { summary: "Ekstre ödemesi", ok: true, detail: "zaten kayıtlıydı" },
      { summary: "Gelir: Maaş", ok: false, detail: "hesap bulunamadı" },
    ])).toBe(
      "✓ Gider: Migros · 850,00 ₺\n" +
      "✓ Ekstre ödemesi (zaten kayıtlıydı)\n" +
      "✕ Gelir: Maaş — hesap bulunamadı",
    );
  });
});

/* Çoklu anahtar: ücretsiz kotalar dar, tek anahtarla asistan gün ortasında susuyor.
   Sessizce bozulabilecek bir davranış — hangi hatanın anahtar değiştirmeyi hak ettiği
   ve kota dolan anahtara geri dönülmemesi burada sabitleniyor. */
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
