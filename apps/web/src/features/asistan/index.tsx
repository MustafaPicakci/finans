import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, type AiAction, type AiResult } from "../../api";
import { T, css } from "../../theme";

/* ————— Asistan (Faz 22) —————
   Doğal dille anlatılan finansal olayları kayda çevirir. Kritik tasarım kararı:
   asistan hiçbir şeyi kendiliğinden yazmaz — model yalnız İŞLEM PLANLAR, plan
   kullanıcının önüne insan-okur satırlar olarak gelir, uygulama ancak "Onayla"
   ile olur. Yanlış anlaşılan bir cümle böylece deftere değil, ekrana düşer. */

type Msg = { role: "user" | "assistant"; content: string };

const ORNEKLER = [
  "11 temmuzda 12,71 TL'den 20 adet ASELS aldım",
  "TP2 fonundan 2 TL'den 20.000 TL'lik sattım, para Garanti hesabıma geçti",
  "Akbank kartının ekstresini ödedim",
  "Dün markete 850 TL harcadım, kartla",
];

export function Asistan({ reload }: { reload: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pending, setPending] = useState<AiAction[]>([]);
  const [planId, setPlanId] = useState(""); // tek kullanımlık: uygulanan plan tekrar gönderilemez
  const [undo, setUndo] = useState<{ planId: string; count: number } | null>(null); // son uygulanan plan geri alınabilir mi
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.aiStatus().then(setStatus).catch(() => setStatus({ enabled: false, model: null })); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending, busy]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setInput(""); setPending([]); setUndo(null); setErr(""); setBusy(true);
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
      const { results, undoable } = await api.aiExecute(planId, pending);
      setPending([]); setPlanId("");
      setMsgs((m) => [...m, { role: "assistant", content: formatResults(results) }]);
      setUndo(undoable > 0 ? { planId, count: undoable } : null);
      reload(); // defter değişti → tüm veriyi tazele
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [pending, planId, busy, reload]);

  /* Geri al: yalnız asistanın YARATTIĞI kayıtlar için (düzenleme/silme/mutabakat geri alınamaz —
     eski hâl saklanmıyor). Sunucu ters sırada siler ve günlüğü işaretler. */
  const undoLast = useCallback(async () => {
    if (!undo || busy) return;
    setBusy(true); setErr("");
    try {
      const { results } = await api.aiUndo(undo.planId);
      setUndo(null);
      setMsgs((m) => [...m, { role: "assistant", content: formatResults(results) }]);
      reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [undo, busy, reload]);

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

        {undo && pending.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: T.mut }}>
            <span>Son uygulanan {undo.count} kayıt geri alınabilir.</span>
            <button onClick={undoLast} disabled={busy} style={{ ...css.ghost, padding: "6px 11px", fontSize: 12.5 }}>↩ Geri al</button>
          </div>
        )}

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

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
          placeholder="Örn: bugün 5.000 TL maaş yattı, Garanti'ye"
          style={{ ...css.input, fontFamily: T.disp, flex: 1 }} />
        <button type="submit" disabled={busy || !input.trim()} style={{ ...css.btn, opacity: busy || !input.trim() ? 0.6 : 1 }}>Gönder</button>
      </form>
      <div style={{ fontSize: 11.5, color: T.mut3, lineHeight: 1.5 }}>
        Asistan senin yetkilerinle çalışır: yalnız kendi verine erişir, hesap silme gibi yıkıcı işlemleri yapamaz.
        Mesajların ve hesap/kart/kategori adların (bakiyelerle birlikte) yanıtı üretmesi için seçili model sağlayıcısına gönderilir.
      </div>
    </div>
  );
}

const formatResults = (rs: AiResult[]) =>
  rs.map((r) => `${r.ok ? "✓" : "✕"} ${r.summary}${r.ok ? (r.detail === "uygulandı" ? "" : ` (${r.detail})`) : ` — ${r.detail}`}`).join("\n");
