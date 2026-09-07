import { useCallback, useEffect, useRef, useState } from "react";

/* ————— Sesle yazdırma (Web Speech API) —————
   Cihazın KENDİ konuşma tanımasını kullanır — sunucuya ses gitmez, uygulamanın
   yazma yolu hiç değişmez: dikte yalnızca metin kutusunu doldurur, kullanıcı
   düzeltir ve "Gönder"e basar. Yani sesin yanlış anlaşılması da diğer her şey
   gibi ekranda kalır, deftere düşmez.

   Tarayıcı desteği kısmi (Chrome/Edge/Safari webkit önekiyle; Firefox yok), o
   yüzden `supported` false'ken düğme HİÇ gösterilmez — çalışmayan bir mikrofon
   simgesi, olmayan bir simgeden kötüdür. Güvenli bağlam (https/localhost) da
   şart: mikrofon izni yoksa API zaten patlar.

   ————— Mobilde tekrar sorunu (Faz 29) —————
   Android Chrome söylenen her kelimeyi kutuya birkaç kez yazıyordu. İki ayrı
   sebep vardı, ikisi de burada çözülür:
   1. `continuous = true` Android'de gerçekten sürekli dinlemez; oturum yine her
      sözden sonra biter, ama KESİNLEŞMİŞ sonuç sonraki her `onresult` olayında
      listede yeniden gelir. Eskiden `resultIndex`'ten itibaren okunduğu için
      aynı sonuç tekrar tekrar yazılıyordu → artık oturum içinde hangi sonuç
      indeksinin deftere geçtiği tutulur (`islenen`), aynı indeks bir daha yazılmaz.
   2. Oturum bitince AYNI tanıma nesnesi yeniden başlatılıyordu; bazı sürümler
      eski sonuç listesini koruyup hepsini yeniden yolluyor. Artık her yeniden
      başlatma TEMİZ bir nesne açar, üstüne de metin düzeyinde bir emniyet ağı
      var (aşağıdaki `yaz`). */

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

/** Mobil tarayıcılarda `continuous` ya yok sayılıyor ya da sonuçları tekrarlatıyor (yukarıdaki not). */
const MOBIL = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* Metin düzeyinde emniyet ağı: aynı kesin sonuç kısa süre içinde bir daha gelirse
   (yeniden başlatmada eski listenin tekrar yollanması) yazılmaz; öncekini KAPSAYAN
   bir sonuç gelirse yalnız yeni kısmı yazılır. Süre penceresi bilinçli dar — "market"
   deyip 10 sn sonra yine "market" demek gerçek bir tekrardır, yutulmamalı. */
const DUP_MS = 6000;
const sozcukler = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const sade = (w: string) => w.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantRef = useRef(false);                // kullanıcı hâlâ dinlenmek istiyor mu?
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  /* Tarayıcılar sessizlikte oturumu kendiliğinden bitirir; kullanıcı "dur" demediyse
     yeniden başlatırız. Kısa sürede üst üste biten oturum = kapanmayan bir hata
     döngüsüdür (izin yok, mikrofon meşgul) — o zaman ısrar etmeyip bırakırız. */
  const restarts = useRef({ n: 0, since: 0 });
  const sonKesin = useRef({ words: [] as string[], at: 0 });

  /** Kesinleşmiş bir sonucu metin kutusuna yazar — tekrarları eleyerek. */
  const yaz = useCallback((raw: string) => {
    const kelimeler = sozcukler(raw);
    if (!kelimeler.length) return;
    const norm = kelimeler.map(sade);
    const onceki = sonKesin.current;
    let yeni = kelimeler;
    if (
      onceki.words.length &&
      Date.now() - onceki.at < DUP_MS &&
      norm.length >= onceki.words.length &&
      onceki.words.every((w, i) => w === norm[i])
    ) {
      yeni = kelimeler.slice(onceki.words.length); // birebir aynıysa boş kalır → hiç yazılmaz
    }
    sonKesin.current = { words: norm, at: Date.now() };
    const metin = yeni.join(" ").trim();
    if (metin) onTextRef.current(metin);
  }, []);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const stop = useCallback(() => {
    wantRef.current = false;
    clearTimer();
    setInterim("");
    setListening(false);
    try { recRef.current?.stop(); } catch { /* zaten durmuş */ }
  }, []);

  /** Her seferinde TEMİZ bir tanıma oturumu açar (eski nesneyi yeniden başlatmak sonuçları tekrarlatıyordu). */
  const spawn = useCallback(() => {
    const C = ctor();
    if (!C) return;
    const rec = new C();
    rec.lang = lang;
    rec.continuous = !MOBIL;    // masaüstünde uzun cümle; mobilde sürekliliği onend sağlar
    rec.interimResults = true;  // konuşurken canlı önizleme
    rec.maxAlternatives = 1;

    const islenen = new Set<number>(); // bu oturumda kutuya yazılmış sonuç indeksleri
    rec.onresult = (e) => {
      let live = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (!r.isFinal) { live += text; continue; }
        if (islenen.has(i)) continue;  // Android kesinleşmiş sonucu her olayda yeniden yolluyor
        islenen.add(i);
        yaz(text);
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
      if (++r.n > 6) { wantRef.current = false; setListening(false); return; }
      clearTimer();
      timerRef.current = setTimeout(spawn, 250); // hemen başlatmak bazı cihazlarda InvalidState veriyor
    };

    recRef.current = rec;
    try { rec.start(); setListening(true); }
    catch { wantRef.current = false; setListening(false); setError("Mikrofon başlatılamadı."); }
  }, [lang, yaz]);

  const start = useCallback(() => {
    if (!ctor()) return;
    setError("");
    wantRef.current = true;
    restarts.current = { n: 0, since: Date.now() };
    sonKesin.current = { words: [], at: 0 };
    spawn();
  }, [spawn]);

  const toggle = useCallback(() => { if (wantRef.current) stop(); else start(); }, [start, stop]);

  // Sekmeden çıkılırsa mikrofon açık kalmasın
  useEffect(() => () => {
    wantRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    try { recRef.current?.abort(); } catch { /* yoktu */ }
  }, []);

  return { supported, listening, interim, error, toggle, stop };
}
