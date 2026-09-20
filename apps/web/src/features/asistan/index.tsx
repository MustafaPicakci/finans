import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, type AiKonusma, type AiSohbet } from "../../api";
import { T, css } from "../../theme";
import { Aciklama, Empty, SilDugmesi } from "../../ui";
import { useDictation } from "./dictation";

/* ————— Asistan (Faz 22) —————
   Doğal dille anlatılan finansal olayları kayda çevirir. Kritik tasarım kararı:
   asistan hiçbir şeyi kendiliğinden yazmaz — model yalnız İŞLEM PLANLAR, plan
   kullanıcının önüne insan-okur satırlar olarak gelir, uygulama ancak "Onayla"
   ile olur. Yanlış anlaşılan bir cümle böylece deftere değil, ekrana düşer.

   ————— Faz 34: sohbet sunucuda —————
   Mesajlar localStorage'daydı ve panelin geri kalanıyla çelişiyordu: telefondan
   "Paylaş → Finans" ile giren bir harcama SMS'i masaüstünden görünmüyordu, PWA
   yeniden kurulunca konuşma uçuyordu, "Asistanın uyguladıkları" ise sunucudan
   geldiği için sohbetten KOPUK ayrı bir listede duruyordu (son 5 planla sınırlı).
   Artık tek kaynak sunucu: konuşmalar listelenir, geri al düğmesi olayın geçtiği
   mesajın altındadır ve onay kartı yenilemeden sonra da yerinde durur.

   İki seviye (Portföy sekmesindeki desenin aynısı, bkz. Faz 31): varsayılan
   görünüm SOHBETtir — asistanın işi "hemen bir cümle yaz", araya liste ekranı
   koymak her kullanımı bir tık pahalı yapardı. Liste "☰ Sohbetler" ile açılır. */

/* ————— Açılış görünümü —————
   Asistan sohbet LİSTESİYLE açılır (en son konuşulan en üstte). Bunun bedeli her
   kullanımda bir tık; karşılığında "hangi sohbetteyim" sorusu hiç doğmuyor ve eski
   bir konuşmaya dönmek listeyi aramayı gerektirmiyor.

   Ama sekme `tab === "asistan" && <Asistan/>` ile render edildiğinden BAŞKA SEKMEYE
   GEÇİP DÖNMEK bileşeni söküp yeniden kuruyor: liste varsayılanı düpedüz uygulanınca
   "Akbank ekstresini ödedim" deyip Kart sekmesine bakan kullanıcı geri geldiğinde
   konuşmasını kaybediyordu — Faz 22'de sohbeti kalıcı yapmayı gerektiren sorunun
   aynısı. Çözüm: MODÜL kapsamında bir işaretçi. Yeniden kurulumda yaşar (sekme gidip
   gelir), sayfa yenilenince/uygulama kapanınca ölür (asıl açılış yine listedir).
   localStorage DEĞİL, tam da bu yüzden: kalıcı olsaydı ertesi gün de listeyi atlardı. */
let oturumSohbet: number | null = null;

const ESKI_KEY = "finans-ai-sohbet";       // Faz 22-33'ün localStorage sohbeti (artık okunmuyor)
const ESKI_SON_KEY = "finans-ai-son-sohbet"; // Faz 34'ün ilk hâlindeki işaretçi (artık modülde)

/** Çıkışta çağrılır: ortak cihazda bir sonraki kullanıcı öncekinin yerinden devam etmesin. */
export function clearChat() {
  oturumSohbet = null;
  try { localStorage.removeItem(ESKI_KEY); localStorage.removeItem(ESKI_SON_KEY); } catch { /* yoksay */ }
}

const ORNEKLER = [
  "11 temmuzda 12,71 TL'den 20 adet ASELS aldım",
  "TP2 fonundan 2 TL'den 20.000 TL'lik sattım, para Garanti hesabıma geçti",
  "Akbank kartının ekstresini ödedim",
  "Dün markete 850 TL harcadım, kartla",
];

export function Asistan({ reload, initialText, onConsumed }: {
  reload: () => void;
  /** Paylaşımdan gelen metin (Faz 23) — YENİ bir sohbette bir kez otomatik gönderilir */
  initialText?: string | null;
  onConsumed?: () => void;
}) {
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [liste, setListe] = useState<AiKonusma[]>([]);
  const [dahaVar, setDahaVar] = useState(false);
  const [listeAcik, setListeAcik] = useState(false);
  const [sohbet, setSohbet] = useState<AiSohbet | null>(null);
  const [convId, setConvId] = useState<number | null>(null);
  /** Sunucuya gitmiş ama cevabı henüz gelmemiş mesaj (iyimser balon) */
  const [bekleyen, setBekleyen] = useState<string | null>(null);
  /** Onay kartından ✕ ile çıkarılan satırların sıra numaraları — sunucuya `skip` olarak gider */
  const [cikarilan, setCikarilan] = useState<number[]>([]);
  const [adDuzenle, setAdDuzenle] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /* Paylaşımdan (Faz 23) açıldıysa liste HİÇ gösterilmez: metin zaten kendi sohbetine
     gidiyor, araya liste koymak "tek dokunuşla kaydolsun" akışını bozardı. Ref, çünkü
     `initialText` tüketilince null'a düşer ve açılış kararı o zaman geri dönmemeli. */
  const paylasimliAcilis = useRef(!!initialText);

  /* Dikte kutuyu DOLDURUR, göndermez: kullanıcı gördüğü metni düzeltip kendi gönderir
     (ses yanlış anlaşılırsa da onay kartına değil, metin kutusuna düşer). */
  const dict = useDictation({
    onText: (t) => setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t)),
  });

  const listeYukle = useCallback(async (imlec?: { at: string; id: number }) => {
    const r = await api.aiKonusmalar(imlec).catch(() => null);
    if (!r) return null;
    setListe((prev) => (imlec ? [...prev, ...r.conversations] : r.conversations));
    setDahaVar(r.more);
    return r.conversations;
  }, []);

  const sohbetYukle = useCallback(async (id: number) => {
    const s = await api.aiSohbet(id).catch(() => null);
    if (!s) return;
    setSohbet(s); setConvId(s.id); setCikarilan([]); setAdDuzenle(false);
    oturumSohbet = s.id;
  }, []);

  /* Açılış: asistan kapalıysa hiçbir şey çekme. Açıksa listeyi al ve KURAL şu —
     bu oturumda bir sohbetin içindeysen oraya dön (sekme gidip geldi), değilsen liste;
     hiç sohbet yoksa liste boş bir ekran olurdu, doğrudan yeni sohbete düş. */
  useEffect(() => {
    let iptal = false;
    api.aiStatus().then(async (s) => {
      if (iptal) return;
      setStatus(s);
      if (!s.enabled) return;
      const ks = await listeYukle();
      if (iptal || !ks) return;
      const devam = oturumSohbet && ks.some((k) => k.id === oturumSohbet) ? oturumSohbet : null;
      if (devam) await sohbetYukle(devam);
      else setListeAcik(ks.length > 0 && !paylasimliAcilis.current);
    }).catch(() => setStatus({ enabled: false, model: null }));
    return () => { iptal = true; };
  }, [listeYukle, sohbetYukle]);

  /* "nearest": sohbet mobilde KENDİ içinde kaydığından (bkz. .asistan-govde) sayfayı da
     zıplatmadan yalnız o kutuyu dibe getirir. */
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [sohbet, bekleyen, busy]);
  /* Yazma kutusu içeriğe göre büyür (en çok ~5 satır). Tek satırlık input mobilde
     ~17 karakter gösteriyordu: uzun bir cümle yazınca ya da dikte edince yazdığını
     göremiyordun. Yükseklik her değişimde sıfırlanıp yeniden ölçülür (silerken de küçülsün). */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  const send = useCallback(async (text: string, yeni = false) => {
    const t = text.trim();
    if (!t || busy) return;
    const hedef = yeni ? null : convId; // `yeni`: paylaşılan SMS kendi sohbetini açar
    setInput(""); setErr(""); setBusy(true); setBekleyen(t); setListeAcik(false);
    try {
      const res = await api.aiChat(t, hedef ?? undefined);
      await sohbetYukle(res.conversationId);
      listeYukle();
    } catch (e) {
      setErr(String((e as Error).message));
      /* Kullanıcının mesajı model çağrısından ÖNCE yazılıyor (sunucu tarafı), yani
         sağlayıcı patlasa da cümle kaybolmaz. Yeni sohbette kimliğini bilmediğimizden
         listeyi tazeleyip en yeniye geçiyoruz — yoksa yazdığı görünmez olurdu. */
      const ks = await listeYukle();
      if (!hedef && ks?.length) await sohbetYukle(ks[0].id);
      else if (hedef) await sohbetYukle(hedef);
    } finally { setBusy(false); setBekleyen(null); }
  }, [busy, convId, sohbetYukle, listeYukle]);

  const apply = useCallback(async () => {
    const p = sohbet?.pending;
    if (!p || busy) return;
    setBusy(true); setErr("");
    try {
      await api.aiExecute(p.planId, cikarilan);
      if (convId) await sohbetYukle(convId);
      reload();        // defter değişti → tüm veriyi tazele
      listeYukle();
    } catch (e) {
      setErr(String((e as Error).message));
      if (convId) await sohbetYukle(convId); // 409 "zaten uygulandı" → kartın gerçek durumu sunucuda
    } finally { setBusy(false); }
  }, [sohbet, cikarilan, busy, convId, sohbetYukle, listeYukle, reload]);

  /* Geri al: yalnız asistanın YARATTIĞI kayıtlar için (düzenleme/silme/mutabakat geri alınamaz —
     eski hâl saklanmıyor). Sunucu ters sırada siler ve günlüğü işaretler. */
  const undoPlan = useCallback(async (planId: string) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await api.aiUndo(planId);
      if (convId) await sohbetYukle(convId);
      reload(); listeYukle();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally { setBusy(false); }
  }, [busy, convId, sohbetYukle, listeYukle, reload]);

  /* Başlık, portföy grubu adıyla aynı desende satır içinde düzenlenir (bkz. GrupBasligi):
     ayrı bir "yeniden adlandır" kipi/modalı yok, başlığın kendisi alan. Listede DEĞİL
     sohbet başlığında, çünkü liste satırı sohbeti açan bir dokunma hedefi — oraya alan
     koymak iki jesti çakıştırırdı (portföyde de ad grup DETAYINDA düzenlenir). */
  const adlandir = useCallback(async (yeni: string) => {
    if (!convId || !sohbet || yeni === sohbet.title) return;
    const r = await api.aiSohbetAdlandir(convId, yeni).catch((e) => { setErr(String((e as Error).message)); return null; });
    if (!r) return;
    setSohbet((s) => (s ? { ...s, title: r.title } : s));
    setListe((ks) => ks.map((k) => (k.id === convId ? { ...k, title: r.title } : k)));
  }, [convId, sohbet]);

  const yeniSohbet = useCallback(() => {
    setSohbet(null); setConvId(null); setListeAcik(false); setErr(""); setCikarilan([]);
    oturumSohbet = null; // henüz kaydı yok; ilk mesajla birlikte doğar
  }, []);

  const sohbetSil = useCallback(async (id: number) => {
    await api.aiSohbetSil(id).catch((e) => setErr(String((e as Error).message)));
    await listeYukle();
    /* Açık sohbet silindiyse ona dönülemez; listede kalınır (silme zaten listeden yapılır).
       Oturum işaretçisi de düşer, yoksa sekmeden dönünce olmayan sohbete gidilmeye çalışılırdı. */
    if (id === convId) { setSohbet(null); setConvId(null); setCikarilan([]); oturumSohbet = null; }
  }, [convId, listeYukle]);

  /* Paylaşılan metni asistan hazır olur olmaz TEK KEZ ve YENİ bir sohbette gönder (ref,
     StrictMode'un çift effect'ine karşı). Ayrı sohbet olması bilinçli: her SMS kendi
     başına bir olaydır, önceki konuşmanın bağlamı modele gitmemeli. */
  const sharedSent = useRef(false);
  useEffect(() => {
    if (!initialText || sharedSent.current || !status?.enabled) return;
    sharedSent.current = true;
    onConsumed?.();
    send(initialText, true);
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

  if (listeAcik) {
    return (
      <SohbetListesi
        liste={liste} dahaVar={dahaVar} acikId={convId} acikVar={!!sohbet}
        onAc={async (id) => { setListeAcik(false); await sohbetYukle(id); }}
        onDaha={() => { const son = liste[liste.length - 1]; if (son) listeYukle({ at: son.at, id: son.id }); }}
        onSil={sohbetSil}
        onKapat={() => setListeAcik(false)}
        onYeni={yeniSohbet}
      />
    );
  }

  const pending = sohbet?.pending ?? null;
  const geriAlinabilir = sohbet?.plans.filter((p) => p.undoable > 0) ?? [];
  const gosterilen = pending ? pending.actions.map((a, i) => ({ a, i })).filter(({ i }) => !cikarilan.includes(i)) : [];
  const bos = !sohbet || sohbet.messages.length === 0;

  return (
    <div style={{ ...css.card, display: "flex", flexDirection: "column", gap: 14, minHeight: 480 }}>
      {/* Başlık TEK SATIR ve bu ölçülerek karara bağlandı: metinli düğmeler + model rozeti
          390px'te dört satıra sarıyor, ~300px yiyor ve sohbeti ekranın altına itiyordu
          (Faz 32'de Hareketler'de düzeltilen kusurun aynısı). Düğmeler ikona indi
          (title + aria-label taşıyor), model rozeti ise aşağıdaki gizlilik satırına
          taşındı — zaten "seçili model sağlayıcısı" cümlesinin yanına ait. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setListeAcik(true)} title="Sohbetler" aria-label="Sohbetler"
          style={{ ...css.ghost, padding: "8px 10px", flexShrink: 0, display: "flex", alignItems: "center" }}><ListIcon /></button>
        {/* Başlık tıklanınca alana döner. Portföy grubu adı (GrupBasligi) her zaman görünür
            bir alan olarak durur ve orada doğrudur — grup adları kısadır. Burada başlık
            OTOMATİK türetilmiş bir cümledir ve neredeyse her zaman kırpılır: `input`
            `text-overflow: ellipsis` yapamadığı için kırpma sessizleşir, kullanıcı adın
            devamı olduğunu göremez. Bu yüzden okuma hâli metin, yazma hâli alandır. */}
        {sohbet ? (adDuzenle ? (
          <input
            autoFocus defaultValue={sohbet.title} aria-label="Sohbet adı" maxLength={120}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { e.currentTarget.value = sohbet.title; e.currentTarget.blur(); }
            }}
            onBlur={(e) => {
              setAdDuzenle(false);
              const v = e.target.value.replace(/\s+/g, " ").trim();
              if (v && v !== sohbet.title) adlandir(v); // boş bırakmak adı silmez: eskisi kalır
            }}
            style={{ ...css.input, fontFamily: T.disp, fontWeight: 700, fontSize: 15, padding: "4px 7px", flex: 1, minWidth: 0 }} />
        ) : (
          <button onClick={() => setAdDuzenle(true)} title="Sohbet adını düzenle" aria-label={`Sohbet adını düzenle: ${sohbet.title}`}
            style={{
              flex: 1, minWidth: 0, background: "none", border: "1px solid transparent", padding: "4px 7px",
              font: "inherit", fontWeight: 700, fontSize: 15, color: T.text, cursor: "text", textAlign: "left",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sohbet.title}</span>
            {/* Kalem, başlığın HEMEN yanında ve aynı düğmenin içinde: sağa yaslanmış ayrı bir
                simge "başka bir eylem" gibi okunurdu, oysa söylediği şey "bu YAZI düzenlenir".
                Buna ihtiyaç ölçüldü — tek ipucu fare tooltip'iydi, yani telefonda hiç yoktu. */}
            <span aria-hidden="true" style={{ flexShrink: 0, color: T.mut3, display: "flex" }}><KalemIcon /></span>
          </button>
        )) : (
          <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Ne yaptın, anlat
          </div>
        )}
        {!bos && !busy && (
          <button onClick={yeniSohbet} title="Yeni sohbet başlat (bu sohbet listede kalır)" aria-label="Yeni sohbet"
            style={{ ...css.ghost, padding: "8px 10px", flexShrink: 0, display: "flex", alignItems: "center" }}><PlusIcon /></button>
        )}
      </div>

      {bos && !bekleyen && (
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

      {/* Sohbet gövdesi: mobilde kendi içinde kayar (App.tsx'teki .asistan-govde). Sayfa
          akışında büyüseydi uzun bir konuşmadan sonra yazma kutusu ekranın metrelerce
          altında kalıyordu — kullanıcı "chat alanı çok küçük" derken gördüğü buydu. */}
      <div className="asistan-govde" style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {sohbet?.truncated && (
          <div style={{ fontSize: 11.5, color: T.mut3, textAlign: "center" }}>
            Bu sohbetin yalnız son {sohbet.messages.length} mesajı gösteriliyor.
          </div>
        )}
        {sohbet?.messages.map((m) => {
          const durum = m.planId ? sohbet.plans.find((p) => p.planId === m.planId) : undefined;
          return (
            <div key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{
                background: m.role === "user" ? T.accSoft : T.panel2, color: m.role === "user" ? T.acc : T.text,
                border: `1px solid ${T.line}`, borderRadius: 14, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
              }}>{m.content}</div>
              {/* Geri al, olayın geçtiği yerde: eskiden sohbetin dışında ayrı bir listedeydi
                  ve yalnız son 5 planı gösteriyordu — eski bir planı geri almak imkânsızdı. */}
              {durum && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.mut3 }}>
                  {durum.undoable > 0 ? (
                    <button onClick={() => undoPlan(m.planId!)} disabled={busy}
                      style={{ ...css.ghost, padding: "4px 9px", fontSize: 11.5 }}>↩ Geri al</button>
                  ) : <span>geri alındı</span>}
                </div>
              )}
            </div>
          );
        })}
        {bekleyen && (
          <div style={{
            alignSelf: "flex-end", maxWidth: "86%", background: T.accSoft, color: T.acc, opacity: 0.7,
            border: `1px solid ${T.line}`, borderRadius: 14, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
          }}>{bekleyen}</div>
        )}
        {busy && <div style={{ fontSize: 12.5, color: T.mut3 }}>düşünüyor…</div>}
        <div ref={endRef} />
      </div>

      {/* Onay kartı sohbetin DIŞINDA: gövde mobilde kendi içinde kaydığından kart oraya
          konsaydı 320px'lik pencerede kırpılır, "Onayla" düğmesi kaydırmadan görünmezdi.
          Görülmeden verilen onay, onay değildir (Faz 24, kural 4 ile aynı gerekçe).
          Kart artık SUNUCUDAN gelir: sayfa yenilense ya da başka cihazdan bakılsa da
          onayını bekleyen plan yerinde durur (eskiden sekme belleğindeydi, uçuyordu). */}
      {pending && gosterilen.length > 0 && (
        <div style={{ border: `1px solid ${T.acc}`, borderRadius: 14, padding: 14, background: T.panel2 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.acc, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Onayını bekleyen {gosterilen.length} işlem
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {gosterilen.map(({ a, i }) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.2, lineHeight: 1.5 }}>
                <span style={{ color: T.mut3, fontFamily: T.mono, fontSize: 11.5, paddingTop: 2 }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{a.summary}</span>
                <button title="Bu işlemi çıkar" onClick={() => setCikarilan((cs) => [...cs, i])}
                  style={{ background: "none", border: "none", color: T.mut3, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={apply} disabled={busy} style={{ ...css.btn, opacity: busy ? 0.6 : 1 }}>Onayla ve uygula</button>
            <button onClick={() => setCikarilan(pending.actions.map((_, i) => i))} disabled={busy} style={css.ghost}>Vazgeç</button>
          </div>
        </div>
      )}

      {err && <div style={{ color: T.neg, fontSize: 13 }}>{err}</div>}

      {dict.listening && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.mut }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: T.neg, flexShrink: 0, animation: "dictPulse 1.2s ease-in-out infinite" }} />
          <span style={{ flex: 1, minWidth: 0, fontStyle: dict.interim ? "italic" : "normal", color: dict.interim ? T.mut : T.mut3 }}>
            {dict.interim || "dinliyor… konuşmayı bitirince mikrofona tekrar bas"}
          </span>
        </div>
      )}
      {dict.error && <div style={{ color: T.neg, fontSize: 12.5 }}>{dict.error}</div>}

      {/* Yazma kutusu tam satır, düğmeler kendi kümesinde: dar ekranda küme alt satıra
          iner (flex-basis 220px + wrap), böylece kutu 17 karaktere sıkışmaz. */}
      <form onSubmit={(e) => { e.preventDefault(); dict.stop(); send(input); }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <textarea ref={inputRef} value={input} rows={1} onChange={(e) => setInput(e.target.value)} disabled={busy}
          onKeyDown={(e) => {
            // Enter gönderir, Shift+Enter satır atlar (mobil klavyede "gönder" tuşu da buraya düşer)
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); dict.stop(); send(input); }
          }}
          enterKeyHint="send"
          placeholder={dict.listening ? "konuşabilirsin…" : "Örn: bugün 5.000 TL maaş yattı, Garanti'ye"}
          style={{
            ...css.input, fontFamily: T.disp, flex: "1 1 220px", minWidth: 0,
            resize: "none", overflowY: "auto", lineHeight: 1.5, maxHeight: 132,
          }} />
        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
          {dict.supported && (
            <button type="button" onClick={() => { dict.toggle(); inputRef.current?.focus(); }} disabled={busy}
              title={dict.listening ? "Dikteyi durdur" : "Sesle yaz"}
              aria-label={dict.listening ? "Dikteyi durdur" : "Sesle yaz"} aria-pressed={dict.listening}
              style={{
                ...css.ghost, padding: "9px 14px", flexShrink: 0, opacity: busy ? 0.6 : 1,
                background: dict.listening ? T.negSoft : T.panel2,
                color: dict.listening ? T.neg : T.mut,
                borderColor: dict.listening ? T.neg : T.line,
              }}><MicIcon stop={dict.listening} /></button>
          )}
          <button type="submit" disabled={busy || !input.trim()} style={{ ...css.btn, flexShrink: 0, opacity: busy || !input.trim() ? 0.6 : 1 }}>Gönder</button>
        </div>
      </form>

      {/* ————— Geri alınabilir işlemler —————
          Sohbetteki sonuç mesajının altında zaten bir "geri al" var ve o, olayın geçtiği
          yerdedir. Ama uzun bir sohbette "şunu geri alacaktım" derken mesajları taramak
          gerekiyordu — bulunabilirlik, erişilebilirlikten ayrı bir sorun. Bu panel o işi
          yapar ve ikisi ÇAKIŞMAZ çünkü işleri farklı: panel HÂLÂ GERİ ALINABİLENLERİN
          listesidir (geri alınınca satır düşer), sohbet ise ne olduğunun kaydıdır (geri
          alınmış mesaj "geri alındı" yazmaya devam eder). Yazma kutusunun ALTINDA:
          üstünde durunca mobilde kutuyu ekrandan aşağı itiyordu. */}
      {geriAlinabilir.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: T.mut3 }}>
            Geri alınabilir işlemler
          </div>
          {geriAlinabilir.map((p) => (
            <div key={p.planId} className="ui-row" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.mut }}>
              <span className="row-lead" style={{ fontFamily: T.mono, fontSize: 11, color: T.mut3, flexShrink: 0 }}>{shortTime(p.at)}</span>
              <span className="row-title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.summary}{p.total > 1 ? ` (+${p.total - 1} işlem)` : ""}
              </span>
              <button className="row-end" onClick={() => undoPlan(p.planId)} disabled={busy}
                style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, flexShrink: 0 }}>↩ Geri al</button>
            </div>
          ))}
        </div>
      )}

      {/* Bilgilendirme mobilde altı satır yer kaplayıp sohbeti yukarı sıkıştırıyordu.
          Özü (veri sağlayıcıya gider) görünür kalır — gizlilik uyarısı katlanmaz —
          ayrıntı ⓘ arkasına iner (Faz 24, kural 3). */}
      <div style={{ fontSize: 11.5, color: T.mut3, lineHeight: 1.5 }}>
        Mesajların ve hesap/kart/kategori adların (bakiyelerle birlikte) yanıtı üretmesi için seçili model sağlayıcısına gönderilir.
        {status?.model && (
          <span style={{ fontFamily: T.mono, border: `1px solid ${T.line}`, borderRadius: 999, padding: "2px 8px", marginLeft: 6, whiteSpace: "nowrap", display: "inline-block" }}>
            {status.model}
          </span>
        )}
      </div>
      <Aciklama label="asistan ne yapabilir?" k="asistan-yetki">
        Asistan senin yetkilerinle çalışır: yalnız kendi verine erişir, hesap silme gibi yıkıcı işlemleri yapamaz.
        Hiçbir kayıt sen onaylamadan yazılmaz; uyguladıklarını sonuç mesajının altındaki düğmeyle geri alabilirsin.
        Sohbetlerin hesabında saklanır — telefonda başlattığını bilgisayardan sürdürebilirsin; silmek istediğini
        Sohbetler listesinden silersin (indirilen veri paketine de dâhildir).
        {dict.supported && " Mikrofon, cihazın/tarayıcının kendi konuşma tanımasını kullanır — ses bu uygulamanın sunucusuna gitmez, yalnız yazıya dökülen metni sen gönderirsin."}
      </Aciklama>
    </div>
  );
}

/* ————— Sohbet listesi —————
   Sunucu sayfalar (30'ar): `ai_conversations` monoton büyür ve otomatik budanmaz —
   kullanıcının kararı "hiçbir şey kendiliğinden silinmesin". Kaç sohbetin gizlendiği
   "Daha eski sohbetler" düğmesiyle açıkça söylenir (bkz. ui/DahaFazla'nın gerekçesi);
   burada dilim istemcide değil sunucuda olduğundan `useSayfalama` kullanılmaz. */
function SohbetListesi({ liste, dahaVar, acikId, acikVar, onAc, onDaha, onSil, onKapat, onYeni }: {
  liste: AiKonusma[]; dahaVar: boolean; acikId: number | null;
  /** açık bir sohbet var mı — yoksa "geri dön" gidilecek yer olmadığından çizilmez */
  acikVar: boolean;
  onAc: (id: number) => void; onDaha: () => void; onSil: (id: number) => void;
  onKapat: () => void; onYeni: () => void;
}) {
  return (
    <div style={{ ...css.card, display: "flex", flexDirection: "column", gap: 12, minHeight: 480 }}>
      {/* Liste AÇILIŞ ekranı olduğundan "← Sohbete dön" çoğu zaman gidilecek yeri olmayan
          bir düğmedir; yalnız açık bir sohbetten gelindiğinde çizilir. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {acikVar && (
          <button onClick={onKapat} title="Açık sohbete dön" aria-label="Açık sohbete dön"
            style={{ ...css.ghost, padding: "8px 10px", flexShrink: 0, display: "flex", alignItems: "center" }}><GeriIcon /></button>
        )}
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15 }}>Sohbetler</div>
        <button onClick={onYeni} style={{ ...css.btn, fontSize: 12.5, padding: "7px 13px", flexShrink: 0 }}>+ Yeni sohbet</button>
      </div>

      {liste.length === 0 ? (
        <Empty>Henüz sohbet yok. Bir cümle yaz, ilk sohbetin burada listelensin.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {liste.map((k) => (
            <div key={k.id} className="ui-row" style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
              borderBottom: `1px solid ${T.line}`,
              background: k.id === acikId ? T.accSoft : "transparent", borderRadius: k.id === acikId ? 10 : 0,
            }}>
              <button onClick={() => onAc(k.id)} className="row-title" style={{
                flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer",
                textAlign: "left", padding: 0, font: "inherit", color: T.text,
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.title}</div>
                <div style={{ fontSize: 11.5, color: T.mut3, marginTop: 2 }}>
                  {shortTime(k.at)} · {k.messages} mesaj
                  {k.undoable > 0 && <span style={{ color: T.acc }}> · {k.undoable} geri alınabilir işlem</span>}
                </div>
              </button>
              <SilDugmesi
                ad={k.title}
                sonuc={k.undoable > 0
                  ? `Bu sohbetteki ${k.undoable} işlem bundan sonra buradan GERİ ALINAMAZ. Kayıtların kendisi silinmez — ilgili sekmesinden silebilirsin.`
                  : "Yalnız yazışma silinir; asistanın oluşturduğu kayıtlar defterde kalır."}
                onSil={() => onSil(k.id)}
                title="Sohbeti sil"
              />
            </div>
          ))}
        </div>
      )}

      {dahaVar && (
        <button onClick={onDaha} style={{ ...css.ghost, fontSize: 12.5, alignSelf: "center" }}>Daha eski sohbetler</button>
      )}
    </div>
  );
}

/** Kalem (düzenle) ikonu — repodaki ✎ karakterinin SVG karşılığı (tipografik simgeler Android'de tofu ▯ çiziyordu) */
const KalemIcon = () => (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M13.6 3.4a1.7 1.7 0 0 1 2.4 2.4L7.3 14.5l-3.2.8.8-3.2z" />
  </svg>
);

/** Geri ikonu */
const GeriIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </svg>
);

/** Yeni sohbet ikonu */
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" style={{ display: "block" }}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
);

/** Liste ikonu — simgeler SVG olmalı (tipografik karakterler Android'de tofu ▯ çiziyordu) */
const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ display: "block" }}>
    <path d="M4 5.5h12M4 10h12M4 14.5h12" />
  </svg>
);

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
