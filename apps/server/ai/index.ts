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
import { getProvider } from "./provider.js";
import { systemPrompt, toolDefs, konusmaBasligi, type PendingAction, type UserContext, type ChatMessage } from "@finans/asistan";
import { db, nowLocal } from "../db.js";

/* ————— Plan deposu (Faz 34) —————
   Plan artık `ai_plans` tablosunda yaşar. İki şeyi birden düzeltir:

   1) ONAYIN BAĞLAYICILIĞI. Eskiden `execute` uygulanacak işlemleri İSTEMCİDEN alıyordu ve
      sunucu yalnız plan kimliğini doğruluyordu — onay kartında "Migros 850 TL" yazarken
      gönderilen gövdenin 8.500 olmasını hiçbir şey engellemiyordu. Artık argümanlar
      buradan okunur: kullanıcının GÖRDÜĞÜ ile uygulanan tanım olarak aynıdır.
   2) TEK KULLANIMLILIĞIN KALICILIĞI. Eskiden süreç içi bir Map'ti; Render ücretsiz katmanı
      atıllıkta uyuyup yeniden başlayınca kilit buharlaşıyor, aynı plan ikinci kez
      uygulanabiliyordu — tam da engellemek için yazılmış çift kayıt senaryosu. Artık tek
      bir atomik `UPDATE ... WHERE consumed_at IS NULL RETURNING`: iki eşzamanlı istekten
      yalnız biri satırı alır.

   Ömür 30 dk'dan 24 saate çıktı: eski sınır Map'i budamak içindi, plan artık kalıcı ve
   onay kartı yenilemeden/başka cihazdan geri gelebiliyor. Süresi dolan plan sessizce
   kaybolmaz, açıkça "süresi doldu" der (uygulanacak argümanlar bayatlamış olabilir). */
const PLAN_TTL_SAAT = 24;

/** `nowLocal()` biçiminde, `saat` saat önceki an. Biçim sıralanabilir olduğundan karşılaştırma string'tir. */
function oncesi(saat: number): string {
  const d = new Date(Date.now() - saat * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** Onay kartı hâlâ geçerli mi? (arayüz süresi dolmuş kartı silik ve düğmesiz gösterir) */
export function planGecerli(createdAt: string, ttlSaat = PLAN_TTL_SAAT): boolean {
  return createdAt >= oncesi(ttlSaat);
}

type TakenPlan =
  | { ok: true; conversationId: number | null; actions: PendingAction[] }
  | { ok: false; error: string };

/** Planı ATOMİK olarak tüketir: ya işlemleri döner ya da niye dönemediğini söyler. */
async function takePlan(uid: number, planId: string): Promise<TakenPlan> {
  const row = await db.get<{ conversation_id: number | null; actions: string }>(
    `UPDATE ai_plans SET consumed_at=?
      WHERE plan_id=? AND user_id=? AND consumed_at IS NULL AND created_at >= ?
     RETURNING conversation_id, actions`,
    nowLocal(), planId, uid, oncesi(PLAN_TTL_SAAT),
  );
  if (row) return { ok: true, conversationId: row.conversation_id, actions: JSON.parse(row.actions) as PendingAction[] };
  /* Alamadıysak sebebini söyle — "zaten uygulandı" ile "süresi doldu" kullanıcı için
     çok farklı iki durum (biri "bir şey yapma", diğeri "tekrar sor"). */
  const p = await db.get<{ consumed_at: string | null }>(
    "SELECT consumed_at FROM ai_plans WHERE plan_id=? AND user_id=?", planId, uid,
  );
  if (!p) return { ok: false, error: "Böyle bir plan yok" };
  return { ok: false, error: p.consumed_at ? "Bu plan zaten uygulandı" : "Planın süresi doldu — isteğini tekrar yazar mısın?" };
}

/* ---------------- Sohbet deposu (Faz 34) ---------------- */

const KONUSMA_SAYFA = 30;   // konuşma listesi sayfa boyutu (liste sınırsız büyür — sunucu sayfalar)
const MESAJ_TAVAN = 200;    // bir konuşmadan gönderilen son mesaj sayısı

/** Mesajı yazar ve konuşmayı "en üste" taşır (updated_at) — ikisi tek işlemde. */
async function mesajYaz(uid: number, convId: number, role: "user" | "assistant", content: string, planId: string | null = null): Promise<void> {
  const at = nowLocal();
  await db.tx(async (t) => {
    await t.run(
      "INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at, plan_id) VALUES (?,?,?,?,?,?)",
      uid, convId, role, content, at, planId,
    );
    await t.run("UPDATE ai_conversations SET updated_at=? WHERE id=? AND user_id=?", at, convId, uid);
  });
}


/* ---------------- HTTP uçları ---------------- */
type RateLimiter = (key: string, max: number, windowMs: number) => boolean;

/* Asistan KULLANICI BAŞINA kapatılabilir ve varsayılan AÇIKTIR.
   Sebep: asistan her istekte hesap/kart/kategori adlarını BAKİYELERİYLE birlikte seçili
   model sağlayıcısına gönderiyor (context.ts) — arayüz bunu katlamadan söylüyor ama bir
   TERCİH değildi: env'de anahtar varsa herkes için açıktı ve "ben bunu kullanmıyorum"
   diyebilmenin yolu yoktu. Ayar `user_settings`'te çünkü tek bir opt-out için tablo
   açmaya değmez (cash_funds / drip_symbols deseninin aynısı).
   "0" = kapalı; KAYIT YOKKEN AÇIK sayılır — yani mevcut kullanıcılar için hiçbir şey değişmez. */
const asistanAcik = async (uid: number): Promise<boolean> => {
  const r = await db.get<{ value: string }>(
    "SELECT value FROM user_settings WHERE user_id=? AND key='ai_enabled'", uid,
  );
  return r?.value !== "0";
};

export function mountAi(api: any, deps: { rateLimited: RateLimiter }): void {
  /* `neden` şart: "sunucuda anahtar yok" ile "kullanıcı kapattı" tamamen farklı iki durum ve
     arayüzün söyleyeceği şey de farklı (birinde env kurulumu anlatılır, diğerinde geri açma
     düğmesi gösterilir). Tek bir `enabled:false` ikisini ayırt edilemez kılıyordu. */
  api.get("/ai/status", async (c: any) => {
    const p = getProvider();
    if (!p) return c.json({ enabled: false, model: null, neden: "anahtar" });
    if (!(await asistanAcik(c.get("user").id))) return c.json({ enabled: false, model: p.label, neden: "kapali" });
    return c.json({ enabled: true, model: p.label, neden: null });
  });

  /* ---- konuşmalar ---- */

  /* Liste. Sunucu sayfalar çünkü `ai_conversations` monoton büyür ve budanmıyor
     (kullanıcı kararı: otomatik silme yok, yalnız elle sil). */
  api.get("/ai/conversations", async (c: any) => {
    const uid = c.get("user").id;
    /* Sıralama SON HAREKETE göre (updated_at), açılış tarihine göre değil: dün açtığın bir
       sohbete bugün yazınca o sohbet en üste gelmeli — kullanıcının aradığı "en sonuncu"
       konuştuğu sohbettir, ilk açtığı değil. Eşit damgalar için id ikinci ölçüt (aynı
       saniyede iki sohbet açılabilir; sıra belirsiz kalırsa sayfalama satır atlar/tekrarlar).
       Sayfalama bu yüzden ID değil KEYSET: (updated_at, id) ikilisinden küçük olanlar. */
    const beforeAt = String(c.req.query("beforeAt") ?? "").slice(0, 19);
    const rawId = Number(c.req.query("beforeId"));
    const beforeId = Number.isFinite(rawId) && rawId > 0 ? Math.floor(rawId) : 0;
    const imlec = beforeAt && beforeId ? 1 : 0; // 0 = baştan
    const rows = await db.all<{ id: number; title: string; updated_at: string; messages: number; undoable: number }>(
      `SELECT c.id, c.title, c.updated_at,
              (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id)::int AS messages,
              (SELECT COUNT(*) FROM ai_actions a WHERE a.conversation_id = c.id AND a.undone_at IS NULL)::int AS undoable
         FROM ai_conversations c
        WHERE c.user_id = ? AND (? = 0 OR (c.updated_at, c.id) < (?, ?))
        ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`,
      uid, imlec, beforeAt, beforeId, KONUSMA_SAYFA + 1,
    );
    const more = rows.length > KONUSMA_SAYFA;
    return c.json({
      conversations: rows.slice(0, KONUSMA_SAYFA).map((r) => ({
        id: r.id, title: r.title, at: r.updated_at, messages: r.messages, undoable: r.undoable,
      })),
      more,
    });
  });

  /* Tek konuşma: mesajlar + o konuşmada uygulanan planların geri alınabilirliği +
     varsa onay bekleyen plan. Onay kartı artık yenilemeden sonra da geri gelir — eskiden
     bilerek saklanmıyordu çünkü plan uçucuydu ve "hâlâ geçerli mi" bilinemiyordu; artık
     geçerlilik sunucuda kayıtlı (süresi dolmuşsa kart silik gelir). */
  api.get("/ai/conversations/:id", async (c: any) => {
    const uid = c.get("user").id;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "geçersiz konuşma" }, 400);
    const conv = await db.get<{ id: number; title: string }>(
      "SELECT id, title FROM ai_conversations WHERE id=? AND user_id=?", id, uid,
    );
    if (!conv) return c.json({ error: "konuşma bulunamadı" }, 404);
    const [rows, toplam, plans, pend] = await Promise.all([
      db.all<{ id: number; role: "user" | "assistant"; content: string; created_at: string; plan_id: string | null }>(
        "SELECT id, role, content, created_at, plan_id FROM ai_messages WHERE user_id=? AND conversation_id=? ORDER BY id DESC LIMIT ?",
        uid, id, MESAJ_TAVAN,
      ),
      db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM ai_messages WHERE conversation_id=?", id),
      /* Plan başına özet de gelir: sohbetin altındaki "geri alınabilir işlemler" listesi
         bunu yazar. Mesaj metnini kullanmak yetmezdi — o metin başarısız satırları ve
         geri alma dökümlerini de içerir, oysa liste yalnız HÂLÂ GERİ ALINABİLİR olanı
         göstermeli. `undoable`/`total` ayrımı da buradan: kısmen geri alınmış plan var. */
      db.all<{ plan_id: string; at: string; total: number; undoable: number; summary: string }>(
        `SELECT plan_id, MIN(created_at) AS at, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE undone_at IS NULL)::int AS undoable,
                (array_agg(summary ORDER BY id))[1] AS summary
           FROM ai_actions WHERE user_id=? AND conversation_id=?
          GROUP BY plan_id ORDER BY MIN(id) DESC`,
        uid, id,
      ),
      db.get<{ plan_id: string; actions: string; created_at: string }>(
        "SELECT plan_id, actions, created_at FROM ai_plans WHERE user_id=? AND conversation_id=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
        uid, id,
      ),
    ]);
    const messages = rows.reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.created_at, planId: m.plan_id }));
    return c.json({
      id: conv.id, title: conv.title, messages,
      truncated: (toplam?.n ?? 0) > messages.length,
      plans: plans.map((p) => ({ planId: p.plan_id, at: p.at, total: p.total, undoable: p.undoable, summary: p.summary })),
      pending: pend && planGecerli(pend.created_at)
        ? { planId: pend.plan_id, actions: JSON.parse(pend.actions) as PendingAction[], at: pend.created_at }
        : null,
    });
  });

  /* Sohbeti sil. `ai_actions` SİLİNMEZ (ON DELETE SET NULL): uygulanan işlemlerin günlüğü
     bir denetim kaydıdır ve kullanıcı "sohbeti sil" derken onu kastetmez. Bedeli şudur ve
     arayüzde açıkça yazar: o plana ait "geri al" düğmesi bir daha görünmez (kayıtların
     kendisi durur, ilgili sekmesinden silinebilir). */
  /* Başlık ilk cümleden türetilir ("dün markete 1.250 TL harcadım, Axess'le") — kimliği
     verir ama kullanıcının o işe verdiği ad değildir. Yeniden adlandırma `updated_at`'i
     BİLEREK oynatmaz: sıralama ölçütü son KONUŞMA, kozmetik bir düzeltme sohbeti listenin
     tepesine fırlatmamalı (kullanıcı adı düzeltirken listeyi de yeniden dizmiş olurdu). */
  api.put("/ai/conversations/:id", async (c: any) => {
    const uid = c.get("user").id;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "geçersiz konuşma" }, 400);
    const b = await c.req.json().catch(() => null);
    const title = b && typeof b.title === "string" ? b.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (!title) return c.json({ error: "başlık boş olamaz" }, 400);
    const r = await db.run("UPDATE ai_conversations SET title=? WHERE id=? AND user_id=?", title, id, uid);
    if (!r.changes) return c.json({ error: "konuşma bulunamadı" }, 404);
    return c.json({ ok: true, title });
  });

  api.delete("/ai/conversations/:id", async (c: any) => {
    const uid = c.get("user").id;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "geçersiz konuşma" }, 400);
    const r = await db.run("DELETE FROM ai_conversations WHERE id=? AND user_id=?", id, uid);
    if (!r.changes) return c.json({ error: "konuşma bulunamadı" }, 404);
    return c.json({ ok: true });
  });

  /* ================= E2EE aşama 4: SUNUCU = RÖLE + DEPO =================
     Ajan döngüsü tarayıcıda koşar (`@finans/asistan`, sunucudakiyle aynı kod). Sunucunun
     kalan işi üç şey ve hiçbiri içerik mantığı değil:
       1) RÖLE — model çağrısı; API anahtarları tarayıcıya inmemeli.
       2) DEPO — mesajlar, planlar, uygulama günlüğü (aşama 6'da içerikleri şifreli olacak).
       3) ATOMİK KİLİTLER — planın tek kullanımlığı (ağ tekrarında çift kayıt yazılmasın).
     Eski sunucu güdümlü /ai/chat · /ai/execute · /ai/undo ve onların ayrıcalıklı iç istek
     yolu (`app.request`) aşama 4e'de SİLİNDİ: asistanın yazma işlemleri artık normal API
     uçlarına kullanıcının KENDİ oturumuyla, tarayıcıdan gidiyor. */

  /* RÖLE. İstemci SİSTEM PROMPTUNU GÖNDEREMEZ, yalnız bağlamı (kendi verisini) ve mesajları:
     prompt ve araç listesi burada, aynı paketten kurulur. Aksi hâlde giriş yapmış herkes
     API anahtarımızı genel amaçlı bir sohbet botu olarak kullanabilir, KAPSAM kuralları
     ("yalnız bu panelin konuları") istemcinin elinde olurdu ve kotayı biz öderdik.
     Gövde LOGLANMAZ ve SAKLANMAZ — kullanıcının verisi buradan yalnız GEÇER.
     Hız sınırı artık model TURU başına: bir mesaj en çok 6 tur sürebilir, mesaj başına
     sınır ise /ai/messages'ta (eski 30/5dk bütçesi orada korunuyor). */
  const BAGLAM_TAVAN = 60_000;
  const TUR_TAVAN = 60;
  api.post("/ai/relay", async (c: any) => {
    const uid = c.get("user").id;
    const p = getProvider();
    if (!p) return c.json({ error: "Asistan yapılandırılmadı (AI_API_KEY eksik)" }, 503);
    if (!(await asistanAcik(uid))) return c.json({ error: "Asistan kapalı (Hesabım'dan açabilirsin)" }, 403);
    if (deps.rateLimited(`airelay:${uid}`, 120, 5 * 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
    const b = await c.req.json().catch(() => null);
    const ctx = b?.context, messages = b?.messages;
    if (!ctx || typeof ctx !== "object" || !Array.isArray(messages) || !messages.length) return c.json({ error: "geçersiz istek" }, 400);
    if (messages.length > TUR_TAVAN) return c.json({ error: "konuşma çok uzun" }, 400);
    if (JSON.stringify(ctx).length > BAGLAM_TAVAN) return c.json({ error: "bağlam çok büyük" }, 413);
    const bicimOk = messages.every((m: any) =>
      (m?.role === "user" && typeof m.content === "string") ||
      (m?.role === "assistant" && typeof m.content === "string" && (m.toolCalls === undefined || Array.isArray(m.toolCalls))) ||
      (m?.role === "tool" && typeof m.callId === "string" && typeof m.name === "string"));
    if (!bicimOk) return c.json({ error: "geçersiz mesaj biçimi" }, 400);
    try {
      const r = await p.chat({ system: systemPrompt(ctx as UserContext), messages: messages as ChatMessage[], tools: toolDefs() });
      return c.json({ text: r.text, toolCalls: r.toolCalls, model: p.label });
    } catch (e) {
      console.error("[ai] röle hatası:", (e as Error).message); // gövde DEĞİL, yalnız hata
      return c.json({ error: String((e as Error).message).slice(0, 200) }, 502);
    }
  });

  /** Konuşmanın sahipliğini doğrular; `id` yoksa yenisini açar. */
  async function konusmaAl(uid: number, id: unknown, baslik: string): Promise<number | null> {
    if (id != null) {
      const n = Number(id);
      const own = Number.isInteger(n) ? await db.get<{ id: number }>("SELECT id FROM ai_conversations WHERE id=? AND user_id=?", n, uid) : undefined;
      return own ? own.id : null;
    }
    const now = nowLocal();
    const r = await db.run("INSERT INTO ai_conversations (user_id, title, created_at, updated_at) VALUES (?,?,?,?) RETURNING id", uid, baslik, now, now);
    return r.id!;
  }

  /* DEPO: mesaj ekle. Kullanıcı mesajı model çağrısından ÖNCE buraya yazılır (Faz 34:
     sağlayıcı patlarsa yazdığı cümle kaybolmasın) — istemci bu sırayı korur. Başlık
     aşama 6'da istemcide türeyip şifreli gelecek; şimdilik verilmezse içerikten türer. */
  api.post("/ai/messages", async (c: any) => {
    const uid = c.get("user").id;
    const b = await c.req.json().catch(() => null);
    const role = b?.role;
    if (role !== "user" && role !== "assistant") return c.json({ error: "geçersiz rol" }, 400);
    const content = typeof b.content === "string" ? b.content.trim().slice(0, role === "user" ? 4000 : 8000) : "";
    if (!content) return c.json({ error: "mesaj yok" }, 400);
    if (role === "user" && deps.rateLimited(`ai:${uid}`, 30, 5 * 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
    let planId: string | null = null;
    if (b.planId != null) {
      planId = String(b.planId);
      if (!(await db.get("SELECT 1 FROM ai_plans WHERE plan_id=? AND user_id=?", planId, uid))) return c.json({ error: "plan bulunamadı" }, 404);
    }
    const convId = await konusmaAl(uid, b.conversationId, typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : konusmaBasligi(content));
    if (!convId) return c.json({ error: "konuşma bulunamadı" }, 404);
    await mesajYaz(uid, convId, role, content, planId);
    return c.json({ conversationId: convId });
  });

  /* DEPO: onay bekleyen planı sakla. Plan artık İSTEMCİDE üretiliyor (döngü orada), yani
     Faz 34'ün "onaylanan = uygulanan, bunu sunucu garanti eder" güvencesi düşüyor — bilinçli
     ve belgeli (docs/E2EE.md §4.4): o güvence kullanıcının KENDİ istemcisine karşıydı ve
     sıfır bilgi modelinde istemci kullanıcının kendisidir. Kalan iki değer burada: planın
     yenilemeden/başka cihazdan geri gelmesi ve tek kullanımlık kilit. */
  api.post("/ai/plans", async (c: any) => {
    const uid = c.get("user").id;
    const b = await c.req.json().catch(() => null);
    const actions = b?.actions;
    if (!Array.isArray(actions) || !actions.length || actions.length > 12) return c.json({ error: "geçersiz plan" }, 400);
    if (!actions.every((a: any) => typeof a?.tool === "string" && a.args && typeof a.args === "object" && typeof a.summary === "string"))
      return c.json({ error: "geçersiz plan satırı" }, 400);
    const convId = await konusmaAl(uid, b.conversationId, "Yeni sohbet");
    if (!convId || b.conversationId == null) return c.json({ error: "konuşma bulunamadı" }, 404);
    const planId = randomUUID();
    await db.run("INSERT INTO ai_plans (plan_id, user_id, conversation_id, actions, created_at) VALUES (?,?,?,?,?)",
      planId, uid, convId, JSON.stringify(actions), nowLocal());
    return c.json({ planId });
  });

  /* KİLİT: planı ATOMİK tüket, işlemleri döndür. Uygulamayı istemci yapar. Sıra "önce yak":
     tüketim ile uygulama artık iki istek; arada istemci çökerse plan yanar ve HİÇBİR ŞEY
     yazılmaz. Tersi (önce uygula, sonra tüket) ağ tekrarında çift kayda açıktı — Faz 34'ün
     varlık sebebi tam olarak oydu. */
  api.post("/ai/plans/:id/consume", async (c: any) => {
    const uid = c.get("user").id;
    if (deps.rateLimited(`aiexec:${uid}`, 30, 5 * 60_000)) return c.json({ error: "Çok fazla istek, biraz sonra tekrar dene" }, 429);
    const plan = await takePlan(uid, String(c.req.param("id")));
    if (!plan.ok) return c.json({ error: plan.error }, 409);
    return c.json({ conversationId: plan.conversationId, actions: plan.actions });
  });

  /* DEPO: uygulama günlüğü ("Geri al" bunu okur). Yalnız TÜKETİLMİŞ bir planın günlüğü
     yazılabilir — uygulanmamış bir plana sahte geri alma satırı eklenmesin. Geri alma
     isteğini de istemci kendi oturumuyla atar, yani buradaki yol ayrıcalık taşımaz. */
  api.post("/ai/plans/:id/actions", async (c: any) => {
    const uid = c.get("user").id, planId = String(c.req.param("id"));
    const b = await c.req.json().catch(() => null);
    const items = b?.items;
    if (!Array.isArray(items) || !items.length || items.length > 12) return c.json({ error: "geçersiz günlük" }, 400);
    if (!items.every((x: any) => typeof x?.tool === "string" && typeof x.summary === "string" && x.undo_method === "DELETE" && /^\/[A-Za-z0-9/_:.-]+$/.test(String(x.undo_path))))
      return c.json({ error: "geçersiz günlük satırı" }, 400);
    const plan = await db.get<{ conversation_id: number | null }>(
      "SELECT conversation_id FROM ai_plans WHERE plan_id=? AND user_id=? AND consumed_at IS NOT NULL", planId, uid);
    if (!plan) return c.json({ error: "uygulanmış böyle bir plan yok" }, 404);
    await db.tx(async (t) => {
      for (const x of items) {
        await t.run(
          "INSERT INTO ai_actions (user_id, plan_id, conversation_id, created_at, tool, summary, undo_method, undo_path) VALUES (?,?,?,?,?,?,?,?)",
          uid, planId, plan.conversation_id, nowLocal(), x.tool, x.summary, x.undo_method, x.undo_path);
      }
    });
    return c.json({ ok: true });
  });

  /* Geri alınabilir satırlar — TERS SIRADA (önce işlem, sonra onu tutan hesap). */
  api.get("/ai/plans/:id/actions", async (c: any) => {
    const uid = c.get("user").id;
    const rows = await db.all<{ id: number; summary: string; undo_method: string; undo_path: string; conversation_id: number | null }>(
      "SELECT id, summary, undo_method, undo_path, conversation_id FROM ai_actions WHERE user_id=? AND plan_id=? AND undone_at IS NULL ORDER BY id DESC",
      uid, String(c.req.param("id")));
    return c.json({ actions: rows });
  });

  /* Yalnız BAŞARIYLA geri alınanlar işaretlenir (başarısız olan tekrar denenebilsin). */
  api.post("/ai/plans/:id/undone", async (c: any) => {
    const uid = c.get("user").id;
    const b = await c.req.json().catch(() => null);
    const ids = Array.isArray(b?.ids) ? b.ids.filter((n: unknown) => Number.isInteger(n)).map(Number) : [];
    if (!ids.length) return c.json({ error: "id yok" }, 400);
    await db.tx(async (t) => {
      for (const id of ids) await t.run("UPDATE ai_actions SET undone_at=? WHERE id=? AND user_id=? AND plan_id=? AND undone_at IS NULL",
        nowLocal(), id, uid, String(c.req.param("id")));
    });
    return c.json({ ok: true });
  });

}
