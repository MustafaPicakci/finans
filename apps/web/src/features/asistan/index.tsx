import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, type AiAction, type AiPlan, type AiResult } from "../../api";
import { T, css } from "../../theme";
import { useDictation } from "./dictation";

/* ————— Asistan (Faz 22) —————
   Doğal dille anlatılan finansal olayları kayda çevirir. Kritik tasarım kararı:
   asistan hiçbir şeyi kendiliğinden yazmaz — model yalnız İŞLEM PLANLAR, plan
   kullanıcının önüne insan-okur satırlar olarak gelir, uygulama ancak "Onayla"
   ile olur. Yanlış anlaşılan bir cümle böylece deftere değil, ekrana düşer. */

type Msg = { role: "user" | "assistant"; content: string };

/* ————— Sohbet kalıcılığı —————
   Sekme `tab === "asistan" && <Asistan/>` ile render edildiğinden başka sekmeye
   geçmek bileşeni SÖKER: konuşma state'te tutulursa "Akbank ekstresini ödedim"
   dedikten sonra Kart sekmesine bakıp dönmek sohbeti siliyordu. Sunucu bilinçli
   olarak durumsuz (geçmiş her istekte istemciden gider), o yüzden yer localStorage.
   Saklanan yalnız MESAJLAR: `pending`/`planId` saklanmaz, çünkü plan kimliği tek
   kullanımlık ve 30 dk ömürlü — yenilemeden sonra geri gelen bir onay kartı ya
   409 alırdı ya da kullanıcı onu hâlâ geçerli sanırdı. */
const CHAT_KEY = "finans-ai-sohbet";
const MAX_SAVED = 40; // ~son 20 tur; sunucu zaten son 20 turu okuyor

function loadChat(): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is Msg =>
      !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
  } catch { return []; }
}

/** Çıkışta çağrılır: ortak cihazda bir sonraki kullanıcı öncekinin sohbetini görmemeli. */
export function clearChat() { localStorage.removeItem(CHAT_KEY); }

const ORNEKLER = [
  "11 temmuzda 12,71 TL'den 20 adet ASELS aldım",
  "TP2 fonundan 2 TL'den 20.000 TL'lik sattım, para Garanti hesabıma geçti",
  "Akbank kartının ekstresini ödedim",
  "Dün markete 850 TL harcadım, kartla",
];

export function Asistan({ reload, initialText, onConsumed }: {
  reload: () => void;
  /** Paylaşımdan gelen metin (Faz 23) — bir kez otomatik gönderilir; kayıt yine onayla oluşur */
  initialText?: string | null;
  onConsumed?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(loadChat);
  const [pending, setPending] = useState<AiAction[]>([]);
  const [planId, setPlanId] = useState(""); // tek kullanımlık: uygulanan plan tekrar gönderilemez
  const [history, setHistory] = useState<AiPlan[]>([]); // sunucudaki uygulama geçmişi (geri alma buradan)
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Dikte kutuyu DOLDURUR, göndermez: kullanıcı gördüğü metni düzeltip kendi gönderir
     (ses yanlış anlaşılırsa da onay kartına değil, metin kutusuna düşer). */
  const dict = useDictation({
    onText: (t) => setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t)),
  });

  const loadHistory = useCallback(() => api.aiHistory().then((r) => setHistory(r.plans)).catch(() => {}), []);
  useEffect(() => {
    api.aiStatus().then((s) => { setStatus(s); if (s.enabled) loadHistory(); })
      .catch(() => setStatus({ enabled: false, model: null }));
  }, [loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending, busy]);
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-MAX_SAVED))); } catch { /* kota dolu: sohbet uçucu kalır */ }
  }, [msgs]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setInput(""); setPending([]); setErr(""); setBusy(true);
    try {
      const res = await api.aiChat(next);
      setMsgs([...next, { role: "assistant", content: res.reply }]);
      setPending(res.pending); setPlanId(res.planId);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [msgs, busy]);

  const apply = useCallback(async () => {
    if (!pending.length || busy) return;
    setBusy(true); setErr("");
    try {
      const { results } = await api.aiExecute(planId, pending);
      setPending([]); setPlanId("");
      setMsgs((m) => [...m, { role: "assistant", content: formatResults(results) }]);
      reload();        // defter değişti → tüm veriyi tazele
      loadHistory();   // geri alınabilirlik sunucudan gelir, bellekten değil
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [pending, planId, busy, reload, loadHistory]);

  /* Geri al: yalnız asistanın YARATTIĞI kayıtlar için (düzenleme/silme/mutabakat geri alınamaz —
     eski hâl saklanmıyor). Sunucu ters sırada siler ve günlüğü işaretler. */
  const undoPlan = useCallback(async (planIdToUndo: string) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const { results } = await api.aiUndo(planIdToUndo);
      setMsgs((m) => [...m, { role: "assistant", content: formatResults(results) }]);
      reload(); loadHistory();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [busy, reload, loadHistory]);

  /* Paylaşılan metni asistan hazır olur olmaz TEK KEZ gönder (ref, StrictMode'un çift
     effect'ine ve yeniden render'lara karşı). Kullanıcı hiçbir şey yazmadan onay kartını görür. */
  const sharedSent = useRef(false);
  useEffect(() => {
    if (!initialText || sharedSent.current || !status?.enabled) return;
    sharedSent.current = true;
    onConsumed?.();
    send(initialText);
  }, [initialText, status, send, onConsumed]);

  if (status && !status.enabled) {
    return (
      <div style={{ ...css.card }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Asistan kapalı</div>
        <div style={{ fontSize: 13.5, color: T.mut, lineHeight: 1.6 }}>
          Sunucuda <code style={{ fontFamily: T.mono }}>AI_API_KEY</code> tanımlı değil. Ücretsiz bir anahtarla açabilirsin:
          Google AI Studio (varsayılan, <code style={{ fontFamily: T.mono }}>AI_PROVIDER=gemini</code>) veya
          OpenAI uyumlu bir servis (<code style={{ fontFamily: T.mono }}>AI_PROVIDER=openai</code> + <code style={{ fontFamily: T.mono }}>AI_BASE_URL</code>).
          Ayrıntılar <code style={{ fontFamily: T.mono }}>apps/server/.env.example</code> dosyasında.
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...css.card, display: "flex", flexDirection: "column", gap: 14, minHeight: 480 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Ne yaptın, anlat</div>
        <div style={{ flex: 1 }} />
        {msgs.length > 0 && !busy && (
          <button
            onClick={() => { setMsgs([]); setPending([]); setPlanId(""); setErr(""); clearChat(); }}
            title="Sohbeti temizle (kayıtlara dokunmaz)"
            style={{ ...css.ghost, fontSize: 12 }}
          >Sohbeti temizle</button>
        )}
        {status?.model && (
          <span style={{ fontSize: 11, color: T.mut3, fontFamily: T.mono, border: `1px solid ${T.line}`, borderRadius: 999, padding: "3px 9px" }}>
            {status.model}
          </span>
        )}
      </div>

      {msgs.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13.5, color: T.mut, lineHeight: 1.6 }}>
            İşlemlerini cümleyle anlat; asistan hangi kaydın oluşacağını çıkarır ve <b>onayına sunar</b>. Onaylamadan hiçbir şey yazılmaz.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ORNEKLER.map((o) => (
              <button key={o} onClick={() => send(o)} style={{ ...css.ghost, fontSize: 12.5, textAlign: "left" }}>{o}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%",
            background: m.role === "user" ? T.accSoft : T.panel2, color: m.role === "user" ? T.acc : T.text,
            border: `1px solid ${T.line}`, borderRadius: 14, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
          }}>{m.content}</div>
        ))}
        {busy && <div style={{ fontSize: 12.5, color: T.mut3 }}>düşünüyor…</div>}

        {pending.length > 0 && (
          <div style={{ border: `1px solid ${T.acc}`, borderRadius: 14, padding: 14, background: T.panel2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.acc, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Onayını bekleyen {pending.length} işlem
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pending.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.2, lineHeight: 1.5 }}>
                  <span style={{ color: T.mut3, fontFamily: T.mono, fontSize: 11.5, paddingTop: 2 }}>{i + 1}.</span>
                  <span style={{ flex: 1 }}>{p.summary}</span>
                  <button title="Bu işlemi çıkar" onClick={() => setPending((ps) => ps.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", color: T.mut3, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={apply} disabled={busy} style={{ ...css.btn, opacity: busy ? 0.6 : 1 }}>Onayla ve uygula</button>
              <button onClick={() => setPending([])} disabled={busy} style={css.ghost}>Vazgeç</button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <div style={{ color: T.neg, fontSize: 13 }}>{err}</div>}

      {/* Uygulama geçmişi — SUNUCUDAN gelir (ai_actions), sekmenin belleğinden değil:
          sayfayı yenilesen de başka cihazdan baksan da geri alma imkânı kaybolmaz. */}
      {history.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: T.mut3 }}>
            Asistanın uyguladıkları
          </div>
          {history.map((p) => (
            <div key={p.planId} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.mut }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.mut3, flexShrink: 0 }}>{shortTime(p.at)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.summary}{p.total > 1 ? ` (+${p.total - 1} işlem)` : ""}
              </span>
              {p.undoable > 0 ? (
                <button onClick={() => undoPlan(p.planId)} disabled={busy}
                  style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, flexShrink: 0 }}>↩ Geri al</button>
              ) : (
                <span style={{ fontSize: 11.5, color: T.mut3, flexShrink: 0 }}>geri alındı</span>
              )}
            </div>
          ))}
        </div>
      )}

      {dict.listening && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.mut }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: T.neg, flexShrink: 0, animation: "dictPulse 1.2s ease-in-out infinite" }} />
          <span style={{ flex: 1, minWidth: 0, fontStyle: dict.interim ? "italic" : "normal", color: dict.interim ? T.mut : T.mut3 }}>
            {dict.interim || "dinliyor… konuşmayı bitirince mikrofona tekrar bas"}
          </span>
        </div>
      )}
      {dict.error && <div style={{ color: T.neg, fontSize: 12.5 }}>{dict.error}</div>}

      <form onSubmit={(e) => { e.preventDefault(); dict.stop(); send(input); }} style={{ display: "flex", gap: 8 }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
          placeholder={dict.listening ? "konuşabilirsin…" : "Örn: bugün 5.000 TL maaş yattı, Garanti'ye"}
          style={{ ...css.input, fontFamily: T.disp, flex: 1, minWidth: 0 }} />
        {dict.supported && (
          <button type="button" onClick={() => { dict.toggle(); inputRef.current?.focus(); }} disabled={busy}
            title={dict.listening ? "Dikteyi durdur" : "Sesle yaz"}
            aria-label={dict.listening ? "Dikteyi durdur" : "Sesle yaz"} aria-pressed={dict.listening}
            style={{
              ...css.ghost, padding: "9px 12px", flexShrink: 0, opacity: busy ? 0.6 : 1,
              background: dict.listening ? T.negSoft : T.panel2,
              color: dict.listening ? T.neg : T.mut,
              borderColor: dict.listening ? T.neg : T.line,
            }}><MicIcon stop={dict.listening} /></button>
        )}
        <button type="submit" disabled={busy || !input.trim()} style={{ ...css.btn, flexShrink: 0, opacity: busy || !input.trim() ? 0.6 : 1 }}>Gönder</button>
      </form>
      <div style={{ fontSize: 11.5, color: T.mut3, lineHeight: 1.5 }}>
        Asistan senin yetkilerinle çalışır: yalnız kendi verine erişir, hesap silme gibi yıkıcı işlemleri yapamaz.
        Mesajların ve hesap/kart/kategori adların (bakiyelerle birlikte) yanıtı üretmesi için seçili model sağlayıcısına gönderilir.
        {dict.supported && " Mikrofon, cihazın/tarayıcının kendi konuşma tanımasını kullanır — ses bu uygulamanın sunucusuna gitmez, yalnız yazıya dökülen metni sen gönderirsin."}
      </div>
    </div>
  );
}

/** Mikrofon / durdur ikonu — uygulamanın diğer ikonlarıyla aynı çizgi diliyle (emoji tarayıcıya göre değişiyor) */
const MicIcon = ({ stop }: { stop: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    {stop ? <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /> : (
      <>
        <rect x="7.2" y="2.2" width="5.6" height="9.6" rx="2.8" />
        <path d="M4.4 9.2a5.6 5.6 0 0 0 11.2 0M10 14.8V17.5M7.4 17.6h5.2" />
      </>
    )}
  </svg>
);

/** "2026-08-12 19:40:12" → "12 Ağu 19:40" (bugünse yalnız saat) */
function shortTime(at: string): string {
  const [d, t] = at.split(" ");
  const hhmm = (t ?? "").slice(0, 5);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (d === iso) return hhmm;
  const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [, m, day] = (d ?? "").split("-");
  return `${Number(day)} ${AY[Number(m) - 1] ?? ""} ${hhmm}`;
}

const formatResults = (rs: AiResult[]) =>
  rs.map((r) => `${r.ok ? "✓" : "✕"} ${r.summary}${r.ok ? (r.detail === "uygulandı" ? "" : ` (${r.detail})`) : ` — ${r.detail}`}`).join("\n");
