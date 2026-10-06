import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, type AiKonusma, type AiSohbet, type AllData } from "../../api";
import { sohbetEt, planUygula, planGeriAl } from "./istemci";
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

/* Örnekler kullanıcının gerçek kullanımından (yeniden tasarım, grup 7): kısa harcama cümlesi en üstte,
   bir alım-satım, bir ekstre ödemesi ve bir SORU — asistan soru da cevaplıyor (Faz 35). */
const ORNEKLER = [
  "akbank 400 tl harcama",
  "11 temmuzda 12,71 TL'den 20 adet ASELS aldım",
  "Akbank kartının ekstresini ödedim",
  "bu ay markete ne kadar harcadım?",
];

/** Telefon genişliği mi (App.tsx'teki 900px kırılımıyla aynı) — masaüstünde liste solda hep açık */
function useDar() {
  const sorgu = "(max-width: 900px)";
  const [dar, setDar] = useState(() => typeof window !== "undefined" && window.matchMedia(sorgu).matches);
  useEffect(() => {
    const m = window.matchMedia(sorgu);
    const f = () => setDar(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return dar;
}

/** Onay kartı satırının tür rozeti — aracın adından (tools.ts); bilinmeyen araç rozetsiz kalır */
function aracTuru(tool: string): { ad: string; renk: string } | null {
  if (tool.endsWith("_sil")) return { ad: "Silme", renk: T.neg };
  if (tool.endsWith("_duzenle")) return { ad: "Düzenleme", renk: T.warn };
  if (tool.startsWith("kart_harcamasi")) return { ad: "Kart", renk: "var(--cat-8)" };
  if (tool.startsWith("islem")) return { ad: "Gelir/gider", renk: T.text };
  if (tool.startsWith("portfoy_islemi")) return { ad: "Portföy", renk: T.acc };
  if (tool.startsWith("virman")) return { ad: "Virman", renk: "var(--cat-3)" };
  if (tool === "ekstre_ode") return { ad: "Ekstre", renk: "var(--cat-8)" };
  if (tool.startsWith("duzenli_kalem")) return { ad: "Düzenli", renk: T.mut };
  if (tool.startsWith("plan_kalemi")) return { ad: "Plan", renk: T.mut };
  if (tool.startsWith("kredi")) return { ad: "Kredi", renk: T.mut };
  if (tool.startsWith("mevduat")) return { ad: "Mevduat", renk: T.mut };
  if (tool.startsWith("kart_ekle")) return { ad: "Yeni kart", renk: T.mut };
  if (tool.startsWith("hesap")) return { ad: "Hesap", renk: T.mut };
  return null;
}
/** Özet metnindeki tutarları kalın + mono yazar ("1.250,00 ₺", "₺480") — onayda göz önce rakama gitmeli */
function tutarVurgula(metin: string): React.ReactNode {
  const parca = metin.split(/((?:₺\s?)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s?(?:₺|TL)|₺\s?\d[\d.,]*)/g);
  return parca.map((p, i) => (i % 2 === 1 ? <b key={i} style={{ fontFamily: T.mono, fontWeight: 600 }}>{p}</b> : p));
}

export function Asistan({ data, reload, initialText, onConsumed }: {
  /** E2EE aşama 4: ajan döngüsü tarayıcıda koşar, bağlamı ve okuma araçlarını bu veriden kurar. */
  data: AllData;
  reload: () => void;
  /** Paylaşımdan gelen metin (Faz 23) — YENİ bir sohbette bir kez otomatik gönderilir */
  initialText?: string | null;
  onConsumed?: () => void;
}) {
  type Durum = { enabled: boolean; model: string | null; neden: "anahtar" | "kapali" | null };
  const [status, setStatus] = useState<Durum | null>(null);
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
  /** "↩ N geri alınabilir işlem" çipinin açılır listesi */
  const [geriAcik, setGeriAcik] = useState(false);
  const dar = useDar();
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
    }).catch(() => setStatus({ enabled: false, model: null, neden: "anahtar" }));
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
      /* Geçmiş yalnız AYNI sohbete devam ediliyorsa verilir (yeni sohbet boş başlar). */
      const onceki = hedef && sohbet?.id === hedef
        ? sohbet.messages.map((m) => ({ role: m.role, content: m.content }))
        : [];
      const res = await sohbetEt(data, t, hedef, onceki);
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
  }, [busy, convId, sohbet, data, sohbetYukle, listeYukle]);

  const apply = useCallback(async () => {
    const p = sohbet?.pending;
    if (!p || busy) return;
    setBusy(true); setErr("");
    try {
      await planUygula(p.planId, cikarilan);
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
      await planGeriAl(planId);
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

  /* Kapalı ekranı İKİ HÂLLİ: kullanıcının kendi kapattığı durumda env kurulumunu anlatmak
     anlamsız (ve "bir şey bozuk" izlenimi verir) — orada gereken tek şey geri açma düğmesi,
     ve kararı burada da verebilmeli: ayarın yaşadığı yer Hesabım ama kullanıcı asistanı
     ararken buraya geliyor, "git şu sekmeyi bul" demek gereksiz bir yolculuk. */
  if (status && !status.enabled) {
    return (
      <div style={{ ...css.card }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Asistan kapalı</div>
        {status.neden === "kapali" ? (<>
          <div style={{ fontSize: 13.5, color: T.mut, lineHeight: 1.6, marginBottom: 12 }}>
            Asistanı Hesabım ekranından kapatmışsın. Açtığında yazdığın mesajlar ve hesap/kart/kategori
            adların (bakiyelerle birlikte) yanıtı üretmesi için seçili model sağlayıcısına gönderilir.
          </div>
          <button style={css.btn} onClick={async () => {
            await api.put("settings", { ai_enabled: "1" });
            reload(); // ayar `data.settings`'te de yaşıyor (Hesabım'daki anahtar onu okuyor)
            setStatus(await api.aiStatus());
            /* Liste elle yüklenir: açılış efekti `[listeYukle, sohbetYukle]`'ye bağlı, yani
               status değişince yeniden koşmaz — kapatmadan önce sohbeti olan kullanıcı
               yoksa boş bir ekrana düşerdi. */
            const ks = await listeYukle();
            setListeAcik(!!ks && ks.length > 0);
          }}>Asistanı aç</button>
        </>) : (
          <div style={{ fontSize: 13.5, color: T.mut, lineHeight: 1.6 }}>
            Sunucuda <code style={{ fontFamily: T.mono }}>AI_API_KEY</code> tanımlı değil. Ücretsiz bir anahtarla açabilirsin:
            Google AI Studio (varsayılan, <code style={{ fontFamily: T.mono }}>AI_PROVIDER=gemini</code>) veya
            OpenAI uyumlu bir servis (<code style={{ fontFamily: T.mono }}>AI_PROVIDER=openai</code> + <code style={{ fontFamily: T.mono }}>AI_BASE_URL</code>).
            Ayrıntılar <code style={{ fontFamily: T.mono }}>apps/server/.env.example</code> dosyasında.
          </div>
        )}
      </div>
    );
  }

  const listeElemani = (
    <SohbetListesi
      liste={liste} dahaVar={dahaVar} acikId={convId} gomulu={!dar}
      onAc={async (id) => { setListeAcik(false); await sohbetYukle(id); }}
      onDaha={() => { const son = liste[liste.length - 1]; if (son) listeYukle({ at: son.at, id: son.id }); }}
      onYeni={yeniSohbet}
    />
  );
  /* Telefonda iki seviye (liste ↔ sohbet); masaüstünde liste solda hep açık (yeniden tasarım, grup 7) */
  if (dar && listeAcik) return <div className="asistan-kabuk">{listeElemani}</div>;

  const pending = sohbet?.pending ?? null;
  const geriAlinabilir = sohbet?.plans.filter((p) => p.undoable > 0) ?? [];
  const gosterilen = pending ? pending.actions.map((a, i) => ({ a, i })).filter(({ i }) => !cikarilan.includes(i)) : [];
  const bos = !sohbet || sohbet.messages.length === 0;
  const ikonDugme: React.CSSProperties = {
    width: 36, height: 36, minHeight: 0, borderRadius: 10, border: "none", background: T.panel2, color: T.text,
    display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0, padding: 0,
  };

  return (
    <div className="asistan-kabuk">
      {!dar && listeElemani}
      <section style={{ ...css.card, padding: "10px 16px 10px", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, height: "100%", boxSizing: "border-box" }}>
        {/* Başlık TEK SATIR (ölçülerek: metinli düğmeler 390px'te dört satıra sarıyordu). Sil burada
            — liste satırında ✕ yok (Faz 24 kural 1'in yeni hâli). */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, borderBottom: `1px solid ${T.line2}` }}>
          {dar && (
            <button type="button" onClick={() => setListeAcik(true)} title="Sohbetler" aria-label="Sohbetler" style={ikonDugme}><ListIcon /></button>
          )}
          {/* Başlık tıklanınca alana döner: otomatik başlık neredeyse hep kırpılır, `input`
              ellipsis yapamadığı için okuma hâli metin, yazma hâli alandır. */}
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
              style={{ ...css.input, fontFamily: T.disp, fontWeight: 700, fontSize: 16, padding: "4px 7px", flex: 1, minWidth: 0 }} />
          ) : (
            <button onClick={() => setAdDuzenle(true)} title="Sohbet adını düzenle" aria-label={`Sohbet adını düzenle: ${sohbet.title}`}
              style={{
                flex: 1, minWidth: 0, background: "none", border: "1px solid transparent", padding: "4px 4px", minHeight: 0,
                font: "inherit", fontWeight: 700, fontSize: 16, color: T.text, cursor: "text", textAlign: "left",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sohbet.title}</span>
              {/* Kalem başlığın HEMEN yanında: telefonda tek ipucu bu (tooltip yok) */}
              <span aria-hidden="true" style={{ flexShrink: 0, color: T.mut3, display: "flex" }}><KalemIcon /></span>
            </button>
          )) : (
            <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16, padding: "4px 4px" }}>Yeni sohbet</div>
          )}
          {sohbet && convId != null && !busy && (
            <SilDugmesi className="" ikon={<CopIcon />} title="Sohbeti sil" ad={sohbet.title}
              style={{ ...ikonDugme, color: T.mut }}
              sonuc={geriAlinabilir.length > 0
                ? `Bu sohbetteki ${geriAlinabilir.length} işlem bundan sonra buradan GERİ ALINAMAZ. Kayıtların kendisi silinmez — ilgili sekmesinden silebilirsin.`
                : "Yalnız yazışma silinir; asistanın oluşturduğu kayıtlar defterde kalır."}
              onSil={() => sohbetSil(convId)} />
          )}
          {!bos && !busy && (
            <button onClick={yeniSohbet} title="Yeni sohbet başlat (bu sohbet listede kalır)" aria-label="Yeni sohbet" style={ikonDugme}><PlusIcon /></button>
          )}
        </div>

        {/* Gövde kendi içinde kayar; yazma kutusu altta sabit kalır (mesajlaşma uygulaması gibi) */}
        <div className="asistan-govde" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
          {/* Geri alınabilir işlemler: eskiden yazma kutusunun altında ayrı bir bloktu; şimdi
              sohbetin tepesinde tek çip. Panelin işi aynı — HÂLÂ geri alınabilenlerin listesi
              (geri alınınca satır düşer); mesaj altındaki "geri al" ise olayın kaydında kalır. */}
          {geriAlinabilir.length > 0 && (
            <div style={{ alignSelf: geriAcik ? "stretch" : "center", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6, minWidth: 0, flexShrink: 0 }}>
              <button type="button" onClick={() => setGeriAcik((v) => !v)} aria-expanded={geriAcik} style={{
                justifySelf: "center", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", minHeight: 0,
                borderRadius: 16, border: "none", background: T.accSoft, color: T.acc, fontFamily: T.disp, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>↩ {geriAlinabilir.length} geri alınabilir işlem {geriAcik ? "▴" : "▾"}</button>
              {geriAcik && (
                <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: "4px 12px", minWidth: 0 }}>
                  {geriAlinabilir.map((p, i) => (
                    <div key={p.planId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : `1px solid ${T.line2}`, fontSize: 13.5 }}>
                      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.mut, flexShrink: 0 }}>{shortTime(p.at)}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.summary}{p.total > 1 ? ` (+${p.total - 1} işlem)` : ""}
                      </span>
                      <button onClick={() => undoPlan(p.planId)} disabled={busy} style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: "4px 0", minHeight: 0, flexShrink: 0 }}>Geri al</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {bos && !bekleyen && (
            <div style={{ marginTop: "auto", display: "grid", gap: 14 }}>
              <div style={{ textAlign: "center", padding: "0 8px" }}>
                <div style={{ fontWeight: 700, fontSize: 19 }}>Ne yaptın, anlat</div>
                <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.5, marginTop: 4 }}>
                  Harcamanı, gelirini, alım-satımını bir cümleyle yaz ya da söyle. Hangi kaydı açacağımı gösteririm; <b style={{ color: T.text }}>onaylamadan hiçbir şey yazılmaz</b>.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                {ORNEKLER.map((o) => (
                  <button key={o} type="button" onClick={() => send(o)} style={{
                    padding: "9px 14px", minHeight: 0, border: `1px solid ${T.line}`, borderRadius: 18, background: T.panel,
                    color: T.text, fontFamily: T.disp, fontSize: 14, textAlign: "left", cursor: "pointer",
                  }}>{o}</button>
                ))}
              </div>
            </div>
          )}

          {!bos && <div style={{ marginTop: "auto" }} />}
          {sohbet?.truncated && (
            <div style={{ fontSize: 12, color: T.mut, textAlign: "center" }}>Bu sohbetin yalnız son {sohbet.messages.length} mesajı gösteriliyor.</div>
          )}
          {sohbet?.messages.map((m) => {
            const durum = m.planId ? sohbet.plans.find((p) => p.planId === m.planId) : undefined;
            const ben = m.role === "user";
            return (
              <div key={m.id} style={{ alignSelf: ben ? "flex-end" : "flex-start", maxWidth: "86%", display: "flex", flexDirection: "column", gap: 5, alignItems: ben ? "flex-end" : "flex-start" }}>
                <div style={{
                  background: ben ? T.acc : T.panel2, color: ben ? T.accInk : T.text,
                  borderRadius: ben ? "18px 18px 6px 18px" : "18px 18px 18px 6px", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap",
                }}>{m.content}</div>
                {/* Geri al, olayın geçtiği yerde (eski planlar da geri alınabilsin) */}
                {durum && (durum.undoable > 0 ? (
                  <button onClick={() => undoPlan(m.planId!)} disabled={busy}
                    style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: "0 4px", minHeight: 0 }}>↩ Geri al</button>
                ) : <span style={{ fontSize: 12.5, color: T.mut, padding: "0 4px" }}>geri alındı</span>)}
              </div>
            );
          })}
          {bekleyen && (
            <div style={{
              alignSelf: "flex-end", maxWidth: "86%", background: T.acc, color: T.accInk, opacity: 0.7,
              borderRadius: "18px 18px 6px 18px", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap",
            }}>{bekleyen}</div>
          )}
          {busy && <div style={{ fontSize: 13, color: T.mut }}>düşünüyor…</div>}
          <div ref={endRef} />
        </div>

        {/* Onay kartı gövdenin DIŞINDA: kaydırılan pencerede kırpılsaydı "Onayla" görülmeden
            basılan bir düğme olurdu (görülmeden verilen onay, onay değildir). */}
        {pending && gosterilen.length > 0 && (
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: "var(--shadow)", background: T.panel, marginBottom: 10, overflow: "hidden", maxHeight: "45vh", overflowY: "auto" }}>
            <div style={{ padding: "12px 14px 6px", fontSize: 13, color: T.mut }}>
              Onayını bekleyen {gosterilen.length} işlem · onaylamadan hiçbir şey yazılmaz
            </div>
            {gosterilen.map(({ a, i }) => {
              const tur = aracTuru(a.tool);
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderTop: `1px solid ${T.line2}` }}>
                  {tur && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: T.panel2, color: tur.renk, flexShrink: 0, marginTop: 2 }}>{tur.ad}</span>
                  )}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 1.45 }}>{tutarVurgula(a.summary)}</span>
                  <button type="button" title="Bu işlemi çıkar" aria-label="Bu işlemi çıkar" onClick={() => setCikarilan((cs) => [...cs, i])}
                    style={{ background: "none", border: "none", color: T.mut, cursor: "pointer", padding: 2, minHeight: 0, flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                  </button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px" }}>
              <button onClick={apply} disabled={busy} style={{
                flex: 1, height: 46, border: "none", borderRadius: 12, background: T.acc, color: T.accInk,
                fontFamily: T.disp, fontSize: 15, fontWeight: 650, cursor: "pointer", opacity: busy ? 0.6 : 1,
              }}>Onayla ve uygula</button>
              <button onClick={() => setCikarilan(pending.actions.map((_, i) => i))} disabled={busy} style={{
                height: 46, padding: "0 16px", border: `1px solid ${T.line}`, borderRadius: 12, background: T.panel,
                color: T.text, fontFamily: T.disp, fontSize: 15, fontWeight: 500, cursor: "pointer",
              }}>Vazgeç</button>
            </div>
          </div>
        )}

        {err && <div style={{ color: T.neg, fontSize: 13.5, marginBottom: 8 }}>{err}</div>}
        {dict.listening && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.mut, marginBottom: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: T.neg, flexShrink: 0, animation: "dictPulse 1.2s ease-in-out infinite" }} />
            <span style={{ flex: 1, minWidth: 0, fontStyle: dict.interim ? "italic" : "normal" }}>
              {dict.interim || "dinliyor… konuşmayı bitirince mikrofona tekrar bas"}
            </span>
          </div>
        )}
        {dict.error && <div style={{ color: T.neg, fontSize: 13, marginBottom: 6 }}>{dict.error}</div>}

        {/* Yazma kutusu TEK satır: metin + mikrofon + yuvarlak gönder (eskiden düğmeler ikinci satıra düşüyordu) */}
        <form onSubmit={(e) => { e.preventDefault(); dict.stop(); send(input); }}
          style={{ display: "flex", alignItems: "flex-end", gap: 4, padding: "4px 4px 4px 14px", border: `1px solid ${dict.listening ? T.neg : T.line}`, borderRadius: 24, background: T.panel }}>
          <textarea ref={inputRef} value={input} rows={1} onChange={(e) => setInput(e.target.value)} disabled={busy}
            onKeyDown={(e) => {
              // Enter gönderir, Shift+Enter satır atlar (mobil klavyede "gönder" tuşu da buraya düşer)
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); dict.stop(); send(input); }
            }}
            enterKeyHint="send" aria-label="Asistana yaz"
            placeholder={dict.listening ? "konuşabilirsin…" : "örn. akbank 400 tl harcama"}
            style={{
              flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", resize: "none",
              fontFamily: T.disp, fontSize: 16, lineHeight: 1.45, color: T.text, padding: "9px 0", minHeight: 0, maxHeight: 132, overflowY: "auto",
            }} />
          {dict.supported && (
            <button type="button" onClick={() => { dict.toggle(); inputRef.current?.focus(); }} disabled={busy}
              title={dict.listening ? "Dikteyi durdur" : "Sesle yaz"}
              aria-label={dict.listening ? "Dikteyi durdur" : "Sesle yaz"} aria-pressed={dict.listening}
              style={{
                width: 40, height: 40, minHeight: 0, borderRadius: 20, border: "none", flexShrink: 0, cursor: "pointer",
                display: "grid", placeItems: "center", padding: 0,
                background: dict.listening ? T.negSoft : "transparent", color: dict.listening ? T.neg : T.mut,
              }}><MicIcon stop={dict.listening} /></button>
          )}
          <button type="submit" disabled={busy || !input.trim()} aria-label="Gönder" title="Gönder" style={{
            width: 40, height: 40, minHeight: 0, borderRadius: 20, border: "none", flexShrink: 0, cursor: "pointer", padding: 0,
            display: "grid", placeItems: "center", background: T.acc, color: T.accInk, opacity: busy || !input.trim() ? 0.4 : 1,
          }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" /></svg>
          </button>
        </form>

        {/* Gizlilik cümlesi görünür kalır (katlanmaz) ama tek satır; model adı ve yetki
            açıklaması ⓘ arkasında (Faz 24 kural 3). */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6, flexWrap: "wrap", fontSize: 12, color: T.mut, marginTop: 6, textAlign: "center" }}>
          <span>Mesajların yanıt için model sağlayıcısına gider</span>
          <Aciklama label="ayrıntı" k="asistan-yetki">
            Mesajların ve hesap/kart/kategori adların (bakiyelerle birlikte) yanıtı üretmesi için seçili model sağlayıcısına gönderilir
            {status?.model ? <> (<span style={{ fontFamily: T.mono }}>{status.model}</span>)</> : null}.
            Asistan senin yetkilerinle çalışır: yalnız kendi verine erişir, hesap silme gibi yıkıcı işlemleri yapamaz.
            Hiçbir kayıt sen onaylamadan yazılmaz; uyguladıklarını sonuç mesajının altındaki düğmeyle geri alabilirsin.
            Sohbetlerin hesabında saklanır — telefonda başlattığını bilgisayardan sürdürebilirsin.
            {dict.supported && " Mikrofon, cihazın/tarayıcının kendi konuşma tanımasını kullanır — ses bu uygulamanın sunucusuna gitmez, yalnız yazıya dökülen metni sen gönderirsin."}
          </Aciklama>
        </div>
      </section>
    </div>
  );
}

/* ————— Sohbet listesi —————
   Sunucu sayfalar (30'ar): `ai_conversations` monoton büyür ve otomatik budanmaz —
   kullanıcının kararı "hiçbir şey kendiliğinden silinmesin". Kaç sohbetin gizlendiği
   "Daha eski sohbetler" düğmesiyle açıkça söylenir (bkz. ui/DahaFazla'nın gerekçesi);
   burada dilim istemcide değil sunucuda olduğundan `useSayfalama` kullanılmaz. */
function SohbetListesi({ liste, dahaVar, acikId, gomulu, onAc, onDaha, onYeni }: {
  liste: AiKonusma[]; dahaVar: boolean; acikId: number | null;
  /** masaüstü: sohbetin solunda sabit sütun */
  gomulu: boolean;
  onAc: (id: number) => void; onDaha: () => void; onYeni: () => void;
}) {
  /* Satırın tamamı sohbeti açar; ✕ satırdan kalktı, silme sohbetin başlığında (Faz 24 kural 1'in yeni hâli). */
  return (
    <div style={{ ...css.card, padding: gomulu ? 12 : "8px 12px", display: "flex", flexDirection: "column", gap: 2, minHeight: 0, height: "100%", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: gomulu ? "2px 4px 8px" : "8px 4px 8px" }}>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: gomulu ? 16 : 17 }}>Sohbetler</div>
        <button onClick={onYeni} style={gomulu ? {
          background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "4px 0", minHeight: 0,
        } : {
          height: 36, minHeight: 0, padding: "0 14px", border: "none", borderRadius: 10, background: T.acc, color: T.accInk,
          fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}>+ Yeni sohbet</button>
      </div>

      {liste.length === 0 ? (
        <Empty>Henüz sohbet yok. Bir cümle yaz, ilk sohbetin burada listelensin.</Empty>
      ) : liste.map((k) => (
        <button key={k.id} type="button" onClick={() => onAc(k.id)} className="liste-satir" style={{
          display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 12, border: "none", cursor: "pointer",
          background: k.id === acikId ? T.accSoft : "transparent", color: T.text, fontFamily: T.disp, minHeight: 0,
        }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: k.id === acikId ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.title}</span>
          <span style={{ display: "block", fontSize: 12.5, color: T.mut, marginTop: 2 }}>
            {shortTime(k.at)} · {k.messages} mesaj
            {k.undoable > 0 && <span style={{ color: T.acc }}> · {k.undoable} geri alınabilir</span>}
          </span>
        </button>
      ))}

      {dahaVar && (
        <button onClick={onDaha} style={{ ...css.ghost, fontSize: 13, alignSelf: "center", marginTop: 6 }}>Daha eski sohbetler</button>
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

/** Çöp kutusu (sohbeti sil) */
const CopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
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
