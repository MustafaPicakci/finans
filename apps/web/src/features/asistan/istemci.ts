/* ============================================================================
   Asistanın tarayıcı sürücüsü (E2EE aşama 4)
   ----------------------------------------------------------------------------
   Ajan döngüsü artık BURADA koşar — sunucudakiyle aynı kod (`@finans/asistan`).
   Bağlam ve okuma araçları bellekteki `AllData`'dan beslenir: eskiden her mesaj
   sunucuda 9 bağlam sorgusu + araç başına ayrı sorgular demekti, artık sıfır.
   Şifreli dünyada (aşama 6) bu tek mümkün yol — sunucu adları ve tutarları okuyamaz.

   Sunucunun kalan işi: model rölesi (API anahtarları tarayıcıya inmemeli; sistem
   promptunu da o kurar, bkz. /ai/relay), depo ve planın tek kullanımlık kilidi.

   Faz 34'ten bilerek geri alınan tek güvence: geçmiş ve plan artık istemciden gelir,
   yani "istemci uydurma bir asistan turu enjekte edemez" ve "onaylanan = uygulanan'ı
   sunucu garanti eder" düşer. İkisi de kullanıcının KENDİ istemcisine karşıydı; sıfır
   bilgi modelinde istemci kullanıcının kendisidir (docs/E2EE.md §4.4). */

import {
  agentLoop, buildContext, nameLookup, enrichSummary, safeSummary, executeActions, formatResults,
  konusmaBasligi, READ_TOOLS, MAX_HISTORY,
  type AiProvider, type ChatTurn, type ExecutionResult, type Istek, type UserContext,
} from "@finans/asistan";
import { todayStr, type AllData } from "@finans/engine";
import { api, ApiError } from "../../api";

/** Asistanın yazma araçları normal API uçlarına bu yoldan gider — kullanıcının KENDİ
    oturumuyla. Sunucu tarafındaki ayrıcalıklı iç istek yolu (`app.request`) kalktı. */
const istek: Istek = async (method, path, body) => {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/** Model çağrısını sunucudaki röleye yollayan sağlayıcı. Yalnız mesajları ve BAĞLAMI
    (kullanıcının kendi verisi) gönderir; sistem promptunu ve araç listesini sunucu kurar. */
function roleSaglayici(ctx: UserContext): AiProvider {
  let model = "";
  return {
    get label() { return model; },
    async chat(req) {
      const r = await api.aiRelay(ctx, req.messages);
      model = r.model;
      return { text: r.text, toolCalls: r.toolCalls };
    },
  };
}

/** Bir kullanıcı mesajını işler. Sözleşme eski `/ai/chat` ile aynı: yanıtı arayüz sohbeti
    sunucudan yeniden yükleyerek gösterir. */
export async function sohbetEt(data: AllData, mesaj: string, convId: number | null, onceki: ChatTurn[]) {
  /* Kullanıcının mesajı model çağrısından ÖNCE yazılır (Faz 34): sağlayıcı patlarsa yazdığı
     cümle kaybolmasın — kutu çoktan temizlendi. */
  const { conversationId } = await api.aiMesaj({
    conversationId: convId, role: "user", content: mesaj, title: convId ? undefined : konusmaBasligi(mesaj),
  });
  const bugun = todayStr();
  const ctx = buildContext(data, bugun);
  const names = nameLookup(ctx);
  const provider = roleSaglayici(ctx);
  const gecmis: ChatTurn[] = [...onceki.slice(-(MAX_HISTORY - 1)), { role: "user", content: mesaj }];
  const { reply, pending } = await agentLoop({
    provider,
    system: "", // sunucu kurar — istemci sistem promptunu belirleyemez
    runRead: async (ad, args) => READ_TOOLS.find((t) => t.name === ad)!.run(data, args, bugun),
    summarize: async (tool, args) => enrichSummary(data, tool.name, args, safeSummary(tool, args, names)),
  }, gecmis);
  await api.aiMesaj({ conversationId, role: "assistant", content: reply });
  const planId = pending.length ? (await api.aiPlanKaydet(conversationId, pending)).planId : null;
  return { conversationId, reply, pending, model: provider.label, planId };
}

/** Onaylanan planı uygular. `skip`: onay kartından ✕ ile çıkarılan satırların sıra numaraları. */
export async function planUygula(planId: string, skip: number[]) {
  const { conversationId, actions: tumu } = await api.aiPlanTuket(planId); // 409: zaten uygulandı / süresi doldu
  const actions = tumu.filter((_, i) => !skip.includes(i));
  if (!actions.length) throw new ApiError(400, "uygulanacak işlem kalmadı");
  const results = await executeActions(actions, istek);
  /* Günlük yazımı patlarsa işlemler YİNE uygulanmıştır — kullanıcıya yalan söylememek için
     hata yutulur ve loglanır; o plan yalnız geri alınamaz olur. */
  const geriAlinabilir = results.map((r, i) => ({ r, i })).filter(({ r }) => r.ok && r.undo);
  if (geriAlinabilir.length) {
    await api.aiGunlukYaz(planId, geriAlinabilir.map(({ r, i }) => ({
      tool: actions[i].tool, summary: r.summary, undo_method: r.undo!.method, undo_path: r.undo!.path,
    }))).catch((e) => console.error("[asistan] uygulama günlüğü yazılamadı:", e));
  }
  if (conversationId) {
    await api.aiMesaj({ conversationId, role: "assistant", content: formatResults(results), planId: geriAlinabilir.length ? planId : null })
      .catch((e) => console.error("[asistan] sonuç mesajı yazılamadı:", e));
  }
  return { conversationId, results, undoable: geriAlinabilir.length };
}

/** Planın geri alınabilir kayıtlarını TERS SIRADA siler (önce işlem, sonra onu tutan hesap). */
export async function planGeriAl(planId: string) {
  const { actions: satirlar } = await api.aiGunlukOku(planId);
  if (!satirlar.length) throw new ApiError(404, "geri alınacak işlem yok");
  const results: ExecutionResult[] = [];
  for (const s of satirlar) {
    const res = await istek(s.undo_method, s.undo_path).catch((e) => ({ status: 500, data: { error: String((e as Error).message) } }));
    const ok = res.status < 400;
    // Her başarı ANINDA işaretlenir: yarıda kesilirse tekrar denemede silinmiş kayıt yeniden denenmesin.
    if (ok) await api.aiGeriAlindi(planId, [s.id]).catch((e) => console.error("[asistan] geri alma işareti yazılamadı:", e));
    results.push({ summary: s.summary, ok, detail: ok ? "geri alındı" : res.data?.error || `hata (${res.status})` });
  }
  const conv = satirlar[0].conversation_id;
  if (conv) await api.aiMesaj({ conversationId: conv, role: "assistant", content: formatResults(results) })
    .catch((e) => console.error("[asistan] geri alma mesajı yazılamadı:", e));
  return { conversationId: conv, results };
}
