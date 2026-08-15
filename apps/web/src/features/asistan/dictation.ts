import { useCallback, useEffect, useRef, useState } from "react";

/* ————— Sesle yazdırma (Web Speech API) —————
   Cihazın KENDİ konuşma tanımasını kullanır — sunucuya ses gitmez, uygulamanın
   yazma yolu hiç değişmez: dikte yalnızca metin kutusunu doldurur, kullanıcı
   düzeltir ve "Gönder"e basar. Yani sesin yanlış anlaşılması da diğer her şey
   gibi ekranda kalır, deftere düşmez.

   Tarayıcı desteği kısmi (Chrome/Edge/Safari webkit önekiyle; Firefox yok), o
   yüzden `supported` false'ken düğme HİÇ gösterilmez — çalışmayan bir mikrofon
   simgesi, olmayan bir simgeden kötüdür. Güvenli bağlam (https/localhost) da
   şart: mikrofon izni yoksa API zaten patlar. */

type SRAlternative = { transcript: string };
type SRResult = ArrayLike<SRAlternative> & { isFinal: boolean };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SRErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type SRCtor = new () => SpeechRecognitionLike;

const ctor = (): SRCtor | null => {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Hata kodu → kullanıcıya söylenecek şey. Boş dönen kodlar sessizce yutulur. */
const HATA: Record<string, string> = {
  "not-allowed": "Mikrofon izni verilmedi. Tarayıcı ayarlarından bu siteye mikrofon izni ver.",
  "service-not-allowed": "Tarayıcı konuşma tanımayı engelledi.",
  "audio-capture": "Mikrofon bulunamadı.",
  network: "Konuşma tanıma servisine ulaşılamadı.",
  "language-not-supported": "Tarayıcı Türkçe dikteyi desteklemiyor.",
};

export function useDictation({ lang = "tr-TR", onText }: { lang?: string; onText: (text: string) => void }) {
  const [supported] = useState(() => ctor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");   // henüz kesinleşmemiş metin (canlı önizleme)
  const [error, setError] = useState("");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);                // kullanıcı hâlâ dinlenmek istiyor mu?
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  /* Tarayıcılar sessizlikte oturumu kendiliğinden bitirir; kullanıcı "dur" demediyse
     yeniden başlatırız. Kısa sürede üst üste biten oturum = kapanmayan bir hata
     döngüsüdür (izin yok, mikrofon meşgul) — o zaman ısrar etmeyip bırakırız. */
  const restarts = useRef({ n: 0, since: 0 });

  const stop = useCallback(() => {
    wantRef.current = false;
    setInterim("");
    setListening(false);
    try { recRef.current?.stop(); } catch { /* zaten durmuş */ }
  }, []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    setError("");
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;      // uzun cümle: sessizlikte kesme
    rec.interimResults = true;  // konuşurken canlı önizleme
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) onTextRef.current(text.trim());
        else live += text;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return; // olağan: kullanıcı durdurdu / sustu
      setError(HATA[e.error] ?? `Dikte hatası: ${e.error}`);
      wantRef.current = false;  // kalıcı hata: yeniden başlatma
    };
    rec.onend = () => {
      setInterim("");
      if (!wantRef.current) { setListening(false); return; }
      const now = Date.now();
      const r = restarts.current;
      if (now - r.since > 5000) { r.n = 0; r.since = now; }
      if (++r.n > 4) { wantRef.current = false; setListening(false); return; }
      try { rec.start(); } catch { wantRef.current = false; setListening(false); }
    };

    recRef.current = rec;
    wantRef.current = true;
    restarts.current = { n: 0, since: Date.now() };
    try { rec.start(); setListening(true); }
    catch { wantRef.current = false; setError("Mikrofon başlatılamadı."); }
  }, [lang]);

  const toggle = useCallback(() => { if (wantRef.current) stop(); else start(); }, [start, stop]);

  // Sekmeden çıkılırsa mikrofon açık kalmasın
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.abort(); } catch { /* yoktu */ } }, []);

  return { supported, listening, interim, error, toggle, stop };
}
