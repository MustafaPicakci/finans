import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { project, positions, cardInfos, stmtKey, loanRemaining, portfolioValueTry, depositValueOn, totalCash, convert,
  bekleyenDuzenli, bekleyenEkstreler, todayStr, kurulumGerekli, type Currency } from "@finans/engine";
import { api, ApiError, type SessionUser } from "./api";
import { T, css, fmtMoney, fiyatYasi, FIYAT_YASI_IPUCU, themeCSS, THEME_KEY, CCY_KEY, type ThemeMode } from "./theme";
import { Center } from "./ui";
import { NAV, NavIcon, PROFIL_META, TANIMLAR_META, KURULUM_META } from "./nav";
import { useTabRoute } from "./route";
import { useBalancesHidden, toggleBalancesHidden } from "./privacy";
import { Auth, type UrlAuth } from "./features/auth";
import { Ozet } from "./features/ozet";
import { Hesaplar } from "./features/hesaplar";
import { Profil } from "./features/profil";
import { Tanimlar } from "./features/tanimlar";
import { Nakit } from "./features/nakit";
import { Plan } from "./features/plan";
import { Kartlar } from "./features/kart";
import { Portfoy } from "./features/portfoy";
import { Kayitlar } from "./features/kayitlar";
import { Kurulum } from "./features/kurulum";
import { planYukle, bildirimKapat, abonelikDegisti } from "./bildirim";
import { Asistan, clearChat } from "./features/asistan";
import { anahtarYukle, anahtarSil } from "./yazim/anahtar";
import { ZAYIF_PAROLA_KEY } from "./features/auth/e2ee";
import { sifrelemeGocu } from "./yazim/goc";
import { AddSheet, type AddState, type KalemPrefill, type TradePrefill } from "./AddSheet";

/** Kurulum sihirbazına "Sonra" denmiş mi — cihaz VE kullanıcı başına: yalnız cihaz başına olsaydı
    aynı cihazda açılan ikinci hesap birincinin "Sonra"sını miras alırdı */
const kurulumSonraKey = (uid: number) => `finans-kurulum-sonra:${uid}`;

/* ————— ana uygulama ————— */
export default function App() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.all>> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  /* Sekme adres çubuğundan gelir (route.ts): yenileme aynı ekranda kalsın, geri tuşu
     çalışsın, açık ekranın linki paylaşılabilsin. */
  const [tab, setTab] = useTabRoute();
  const [refreshing, setRefreshing] = useState(false);
  const balancesHidden = useBalancesHidden(); // gizlilik modu: açıkken tüm tutarlar maskelenir
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) as ThemeMode) || "light");
  const [ccy, setCcy] = useState<Currency>(() => (localStorage.getItem(CCY_KEY) as Currency) || "TRY");
  const [add, setAdd] = useState<AddState | null>(null); // global "+ Ekle" akışı
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = oturum kontrol ediliyor
  /* Faz 23 — paylaşılan metin (Android "Paylaş → Finans", ya da elle `?ekle=…`):
     harcama SMS'ini uygulamaya atmanın yolu. Açılışta Asistan sekmesine gider ve orada
     otomatik gönderilir; kayıt yine ancak onayla oluşur. URL bir kez okunup temizlenir ki
     sayfa yenilendiğinde aynı metin ikinci kez gönderilmesin. */
  const [shared, setShared] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const text = [p.get("ekle"), p.get("title"), p.get("url")].filter(Boolean).join(" ").trim();
    return text || null;
  });
  /* Mobil üst çubuk taşma menüsü: 390px'te beş kontrol (yenile/₺$/göz/tema/çıkış) başlığı
     eziyor, "Nakit Akışı" iki satıra kırılıyordu. Sık kullanılan ₺/$ üstte kalır, gerisi
     buranın altına iner. Masaüstünde bu düğme yok — orada zaten kenar çubuğu taşıyor. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [urlAuth, setUrlAuth] = useState<UrlAuth>(() => { // e-posta bağlantısındaki reset/verify token'ı
    const p = new URLSearchParams(window.location.search);
    const reset = p.get("reset"), verify = p.get("verify");
    return reset ? { kind: "reset", token: reset } : verify ? { kind: "verify", token: verify } : null;
  });

  const reload = useCallback(() => api.all().then(setData).catch((e) => {
    if (e instanceof ApiError && e.status === 401) { anahtarSil(); setUser(null); setData(null); } // oturum düştü → giriş ekranı
    else setErr(e);
  }), []);

  /* E2EE aşama 6 — oturum açıldıktan sonra, veriyi göstermeden önce: düz zarf kaldıysa
     (aşama 5'ten gelen veri) tarayıcıda şifrele. Birkaç yüz satır bir-iki saniye sürer.
     Başarısız olursa uygulama YİNE açılır: okuma yolu düz ve şifreli zarfı yan yana okur,
     kalan satırlar bir sonraki açılışta şifrelenir — ama hata SESSİZ geçmez, gösterilir. */
  const [goc, setGoc] = useState<string | null>(null);
  const [gocHata, setGocHata] = useState<string | null>(null);
  const oturumuBaslat = useCallback(async (u: SessionUser) => {
    if (!u.e2ee) {
      setGoc("Verilerin şifreleniyor…");
      try { await sifrelemeGocu((n) => setGoc(`Verilerin şifreleniyor… ${n} kayıt`)); }
      catch (e) { console.error("[e2ee] şifreleme göçü:", e); setGocHata(String((e as Error).message ?? e)); }
      setGoc(null);
    }
    await reload();
  }, [reload]);

  /* Oturum var ama bu cihazda veri anahtarı yoksa (IndexedDB temizlenmiş, aşama 6 öncesinden
     kalma oturum, gizli pencere) uygulama AÇILMAZ: anahtarsız oturum şifreli veriyi ne okur
     ne yazar. Oturum kapatılır ve parola bir kez daha sorulur. */
  const [girisNotu, setGirisNotu] = useState<string | undefined>(undefined);
  /* Girişte parola bugünkü kurala uymuyorsa (Auth işaretler) sekmelerin üstünde bir satır.
     Kapatılınca bu oturumda bir daha çıkmaz; Hesabım'daki parola kartı söylemeye devam eder.
     Bayrak girişte (Auth) yazılır — App o sırada zaten kurulu olduğundan burada tutulan yalnız
     "kapattı mı"dır, bayrağın kendisi her render'da okunur. */
  const [zayifKapatildi, setZayifKapatildi] = useState(false);
  const boot = useCallback(() => {
    api.me().then(async ({ user }) => {
      if (user && !(await anahtarYukle(user.id))) {
        await api.logout().catch(() => {});
        setGirisNotu("Güvenliğin için bu cihazda bir kez daha giriş yapman gerekiyor.");
        setUser(null);
        return;
      }
      setUser(user);
      if (user) oturumuBaslat(user);
    }).catch(setErr);
  }, [oturumuBaslat]);
  useEffect(boot, [boot]);
  const retry = useCallback(() => { setErr(null); setUser(undefined); setData(null); boot(); }, [boot]);
  /* Sohbetler Faz 34'ten beri sunucuda ve kullanıcıya scope'lu, yani çıkışta SİLİNMEZ
     (başka cihazdan devam edilebilsin diye). Temizlenen yalnız bu cihazın "en son şu
     sohbetteydim" işaretçisi + Faz 22-33'ün artık okunmayan localStorage sohbeti —
     ortak cihazda sonraki kullanıcı öncekinin konuşmasının açıldığını görmesin. */
  /* Çıkışta bu cihaz bildirimlerden çıkarılır (oturum kapanmadan ÖNCE — silme oturum ister):
     satılan ya da başkasına verilen telefona tutarlı bildirim gitmeye devam etmesin. Beklemesi
     sınırlı: ağ yoksa çıkış takılmamalı. */
  const logout = useCallback(async () => {
    await Promise.race([bildirimKapat().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await api.logout().catch(() => {}); await anahtarSil(); clearChat(); setUser(null); setData(null);
    // sonraki giriş (belki başka hesap) öncekinin ekranında açılmasın — Özet'ten başlasın
    setTab("ozet", true);
  }, [setTab]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await api.refreshPrices(); await reload(); } catch { /* best-effort */ } finally { setRefreshing(false); }
  }, [reload]);
  useEffect(() => {
    if (!shared) return;
    // `replace`: metin tüketildi — ne yenilemede ne de geri tuşuyla ikinci kez gönderilsin
    setTab("asistan", true);
  }, [shared, setTab]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem(CCY_KEY, ccy); }, [ccy]);
  useEffect(() => { // taşma menüsü: dışarı tıklama ve Escape kapatır
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", esc); };
  }, [menuOpen]);
  useEffect(() => { setMenuOpen(false); }, [tab]); // sekme değişince açık menü asılı kalmasın

  /* ————— OTOMATİK GERÇEKLEŞTİRME (E2EE aşama 2) —————
     15 dakikalık sunucu cron'u buraya taşındı: tutarı okumak zorundaydı ve şifreli dünyada
     yapamayacağı tek şey buydu. Karar engine'de (`otomatik.ts`), burası yalnız sürücü.

     Döngü riski yok: denenen her occurrence anahtarıyla işaretlenir, yani başarısız bir
     yazma bu oturumda tekrar denenmez (sonraki açılışta denenir). Başarılı olanlar zaten
     `recurring_realized` / `statement_payments` işaretiyle listeden düşer.

     Ekstre ödemesine VADE GÜNÜ tarihi gönderilir: talimat o gün işler, uygulamayı açtığın
     gün değil. Düzenli kalemde buna gerek yok — kaydın tarihi zaten occurrence tarihinden
     geliyor, yani geç yazılan kayıt zamanında yazılanla birebir aynı. */
  const otoDenenen = useRef<Set<string>>(new Set());
  const otoCalisiyor = useRef(false);
  useEffect(() => {
    if (!data || otoCalisiyor.current) return;
    const bugun = todayStr();
    const kalemler = bekleyenDuzenli(data, bugun).filter((k) => !otoDenenen.current.has(`r:${k.recurring_id}:${k.ym}`));
    const ekstreler = bekleyenEkstreler(data, bugun).filter((e) => !otoDenenen.current.has(`s:${e.card_id}:${e.due}`));
    if (!kalemler.length && !ekstreler.length) return;
    otoCalisiyor.current = true;
    (async () => {
      try {
        for (const k of kalemler) {
          otoDenenen.current.add(`r:${k.recurring_id}:${k.ym}`); // hata olsa da bu oturumda tekrarlanmasın
          await api.realizeRecurring(k.recurring_id, k.ym, {
            account_id: k.account_id, category_id: k.category_id, amount: k.amount,
          }).catch((e) => console.warn("[oto] düzenli kalem gerçekleştirilemedi:", e));
        }
        /* Karta düşen düzenli kalem az önce yazıldıysa ekstre tutarı BÜYÜMÜŞTÜR: listeyi
           taze veriden yeniden kur. Açılıştaki anlık görüntüyle ödemek ekstreyi eksik öder ve
           ödeme işareti düştüğü için eksik bir daha kapanmaz (ölçüldü: 300+75 kartta 300
           ödendi). Eski sunucu cron'u iki adımı ayrı sorgularla yaptığından bu sorun yoktu. */
        const guncelEkstreler = kalemler.length
          ? bekleyenEkstreler(await api.all(), bugun).filter((e) => !otoDenenen.current.has(`s:${e.card_id}:${e.due}`))
          : ekstreler;
        for (const e of guncelEkstreler) {
          otoDenenen.current.add(`s:${e.card_id}:${e.due}`);
          await api.payStatement(e.card_id, e.due, { account_id: e.account_id, amount: e.amount, date: e.due })
            .catch((err) => console.warn("[oto] ekstre ödenemedi:", err));
        }
        await reload();
      } finally { otoCalisiyor.current = false; }
    })();
  }, [data, reload]);

  /* Uygulama açık unutulup GÜN DEĞİŞİRSE veriyi tazele (PWA'da olağan): yukarıdaki efekt
     `data`'ya bağlı, yani kendiliğinden yeniden koşmaz ve o günün kalemleri yazılmazdı.
     Koşul gün değişimi — her sekme dönüşünde tazelemek `/api/all`'ı boşuna çağırırdı
     (o uç kullanıcının tüm verisini çeker, ucuz değil). */
  const sonGun = useRef(todayStr());
  useEffect(() => {
    const kontrol = () => {
      if (document.visibilityState !== "visible") return;
      const bugun = todayStr();
      if (bugun === sonGun.current) return;
      sonGun.current = bugun;
      reload();
    };
    document.addEventListener("visibilitychange", kontrol);
    return () => document.removeEventListener("visibilitychange", kontrol);
  }, [reload]);

  const rates = useMemo(() => ({ usdTry: Number(data?.settings.fx_usd_try || 0) }), [data]);
  const days = useMemo(() => (data ? project(data, Number(data.settings.horizon || 6), rates) : []), [data, rates]);
  /* Kurulum sihirbazı: hiçbir şey girilmemiş hesapta Özet yerine kendiliğinden açılır — bir kez
     (oturum başına), yalnız Özet'e gelindiyse (paylaşılan SMS asistana, e-postadaki bağlantı
     kendi ekranına gidiyor; onları kesmez) ve kullanıcı "Sonra" demediyse. "Sonra" cihaza
     yazılır: kurulum yine Özet'teki karttan açılabilir, yalnız her açılışta üstüne atlamaz.
     "Bir kez" KULLANICI başınadır, düz bayrak değil: çıkış App'i sökmez, yani aynı sekmede
     çıkıp yeni hesapla girince bayrak önceki hesaptan dolu kalıyor ve sihirbaz hiç
     denenmiyordu (yeni kayıtta yaşandı — doğrulama e-postasından dönüp aynı sekmede giriş). */
  const kurulumAcildi = useRef<number | null>(null);
  useEffect(() => {
    if (!data || !user || kurulumAcildi.current === user.id) return;
    kurulumAcildi.current = user.id;
    let sonra = false;
    try { sonra = localStorage.getItem(kurulumSonraKey(user.id)) === "1"; } catch { /* depolama yoksa sor */ }
    if (tab === "ozet" && !sonra && kurulumGerekli(data)) setTab("kurulum", true);
  }, [data, user, tab, setTab]);
  /* Faz 44 — bildirim planı: veri her değiştiğinde yeniden kurulup (şifreli) yüklenir. Gecikme,
     açılıştaki otomatik kayıtların ve art arda gelen reload()'ların tek yüklemede toplanması için;
     aynı plan ikinci kez gitmez (parmak izi, bildirim/index.ts). Hata sessizdir: bildirim yan iştir,
     ekranı bozmamalı. */
  const [bildirimTik, setBildirimTik] = useState(0); // abonelik değişince plan hemen yüklensin
  useEffect(() => abonelikDegisti(() => setBildirimTik((t) => t + 1)), []);
  useEffect(() => {
    if (!data || !user) return;
    const t = setTimeout(() => { planYukle(data, days).catch((e) => console.warn("[bildirim] plan yüklenemedi:", e)); }, 2500);
    return () => clearTimeout(t);
  }, [data, days, user, bildirimTik]);
  const kurulumBitir = useCallback(() => {
    if (user) try { localStorage.setItem(kurulumSonraKey(user.id), "1"); } catch { /* yalnız bu oturum */ }
    setTab("ozet");
  }, [user, setTab]);
  const pos = useMemo(() => (data ? positions(data.trades, data.prices) : []), [data]);
  // bakiye kolonu yok; nakit defterden türetilir (E2EE aşama 1a)
  const cash = useMemo(() => (data ? totalCash(data.account_entries) : 0), [data]);
  /* Fiyat boru hattının yaşı — "Fiyatları yenile"nin yanında durur, çünkü cevabı olduğu soru
     ("yenilemem gerekiyor mu?") o düğmeye basmadan önce sorulur.
     EN YENİ otomatik damga alınır, en eskisi değil: tek bir sembol çekilemediğinde (fon
     kotası, Yahoo'da olmayan sembol) en eski damga günlerce eski kalır ve sürekli yanlış
     alarm verirdi. Sorulan şey "her fiyat taze mi" değil, "tazeleme çalışıyor mu" — o da
     en son başarılı çekimdir. Elle girilenler dışarıda: onların yaşı kullanıcının kendi
     yazma anıdır, boru hattı hakkında hiçbir şey söylemez (satır ayrıntısında görünür). */
  const fiyatTazelik = useMemo(() => {
    const oto = (data?.prices ?? []).filter((p) => p.source !== "manual" && p.updated_at);
    if (!oto.length) return null;
    // "YYYY-MM-DD HH:MM:SS" sabit genişlikte → sözlük sırası zaman sırasıdır
    const enYeni = oto.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)).updated_at;
    return fiyatYasi(enYeni, data?.now);
  }, [data]);
  const portValueTry = useMemo(() => portfolioValueTry(pos, rates), [pos, rates]);
  const depositsValueTry = useMemo(() => {
    if (!data) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return data.deposits.reduce((s, d) => s + depositValueOn(d, t), 0);
  }, [data]);
  const cardInfoList = useMemo(() => {
    if (!data) return [];
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const paid = new Set(data.statement_payments.map((p) => stmtKey(p.card_id, p.due)));
    return cardInfos(data.cards, data.card_txs, t, paid);
  }, [data]);
  const cardDebt = useMemo(() => cardInfoList.reduce((s, c) => s + c.debt, 0), [cardInfoList]);
  const loanDebt = useMemo(() => {
    if (!data) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, t), 0);
  }, [data]);

  if (err) return <HataEkrani err={err} onRetry={retry} />;
  // E-posta bağlantısıyla gelen reset/verify token'ı: oturum yüklenmesini beklemeden Auth ekranını göster
  if (urlAuth) return <Auth urlAuth={urlAuth} onAuthed={(u) => { setUser(u); setErr(null); setUrlAuth(null); oturumuBaslat(u); }} />;
  if (user === undefined) return <Center>Yükleniyor…</Center>;
  if (user === null) return <Auth bilgi={girisNotu} onAuthed={(u) => { setUser(u); setErr(null); setGirisNotu(undefined); oturumuBaslat(u); }} />;
  if (goc) return <Center>{goc}</Center>;
  if (gocHata) return (
    <Center>
      <div style={{ maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
        Verilerinin bir kısmı şifrelenemedi ({gocHata}). Uygulama çalışmaya devam eder;
        kalan kayıtlar bir sonraki açılışta yeniden denenir.
        <div style={{ marginTop: 12 }}><button style={css.btn} onClick={() => setGocHata(null)}>Devam et</button></div>
      </div>
    </Center>
  );
  if (!data) return <Center>Yükleniyor…</Center>;

  // TRY canonical; görüntü para birimi saf sunum katmanı — nihai TRY rakamını çevirir
  const netWorthTry = cash + portValueTry + depositsValueTry - cardDebt - loanDebt;
  const m = (tryVal: number, dec = false) => fmtMoney(convert(tryVal, "TRY", ccy, rates), ccy, dec);
  const usdReady = rates.usdTry > 0; // FX kuru yoksa USD toggle pasif
  const portTypes = [...new Set(pos.filter((p) => (p.value ?? 0) > 0).map((p) => p.type))];
  const cardsWaiting = cardInfoList.filter((c) => c.debt > 0).length;
  const loansActive = data.loans.filter((l) => loanRemaining(l, new Date()) > 0).length;

  const openAdd = (kind: AddState["kind"], prefill?: KalemPrefill) => setAdd({ kind, prefill });
  // profil/tanimlar bilerek NAV dizisinde yok (bkz. nav.tsx) — başlıkları kendi META'larından gelir
  const meta = NAV.find((n) => n.key === tab) ?? (tab === "tanimlar" ? TANIMLAR_META : tab === "kurulum" ? KURULUM_META : PROFIL_META);
  const summary = { netWorthTry, cash, portValueTry, depositsValueTry, cardDebt, loanDebt,
    accountCount: data.accounts.length, portTypes, cardsWaiting, loansActive };
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  const ccyToggle = (
    <div style={{ display: "flex", border: `1px solid ${T.line}`, borderRadius: 999, overflow: "hidden", flexShrink: 0, background: T.panel }}>
      {(["TRY", "USD"] as const).map((k) => {
        const disabled = k === "USD" && !usdReady;
        return (
          <button key={k} onClick={() => !disabled && setCcy(k)} disabled={disabled}
            title={disabled ? "USD kuru için önce fiyatları yenile" : `Görüntü: ${k}`}
            style={{
              border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: "7px 15px", fontSize: 13, fontWeight: 700,
              /* mono font: Schibsted Grotesk'in ₺ (Lira) glifi bozuk (£ olarak render ediliyor) — bkz. tema notu */
              fontFamily: T.mono, background: ccy === k ? T.acc : "transparent", color: ccy === k ? T.accInk : disabled ? T.mut3 : T.mut,
            }}>{k === "TRY" ? "₺" : "$"}</button>
        );
      })}
    </div>
  );
  const iconBtn: React.CSSProperties = {
    width: 34, height: 34, borderRadius: 10, border: `1px solid ${T.line}`, background: T.panel,
    color: T.mut, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0,
  };
  /* ⏻ (U+23FB) ve ◐ tipografik karakterlerdi ve Android'de yazı tipinde bulunmayıp
     TOFU (▯) olarak çiziliyordu — "çıkış" düğmesi boş kutu görünüyordu. Simgeler artık
     SVG: hangi cihazda hangi yazı tipinin ne taşıdığına bağımlı değiliz. */
  const PowerIcon = () => (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M10 3v7" /><path d="M14.9 5.6a6.5 6.5 0 1 1-9.8 0" />
    </svg>
  );
  const ThemeIcon = () => (
    <svg width="15" height="15" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.6" fill="none">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 0 0 14Z" fill="currentColor" stroke="none" />
    </svg>
  );
  const EyeIcon = ({ off }: { off: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" />
      <circle cx="10" cy="10" r="2.6" />
      {off && <path d="M3 3l14 14" />}
    </svg>
  );
  const privacyBtn = (extra?: React.CSSProperties, cls = "") => (
    <button className={`icon-btn ${cls}`} onClick={toggleBalancesHidden}
      title={balancesHidden ? "Bakiyeleri göster" : "Bakiyeleri gizle"}
      aria-label={balancesHidden ? "Bakiyeleri göster" : "Bakiyeleri gizle"}
      style={{ ...iconBtn, ...(balancesHidden ? { color: T.acc, borderColor: T.acc } : {}), ...extra }}>
      <EyeIcon off={balancesHidden} />
    </button>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.disp }}>
      <style>{themeCSS}</style>
      <style>{`
        * { box-sizing: border-box; }
        input:focus, select:focus, textarea:focus { border-color:${T.acc} !important; box-shadow: 0 0 0 3px color-mix(in srgb, ${T.acc} 18%, transparent); }
        button:active{transform:scale(0.97)}
        ::-webkit-scrollbar{height:9px;width:9px} ::-webkit-scrollbar-thumb{background:${T.line};border-radius:6px;border:2px solid transparent;background-clip:padding-box}
        ::-webkit-scrollbar-thumb:hover{background:${T.mut3}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes dictPulse{0%,100%{opacity:1}50%{opacity:.25}}
        .nav-btn{transition:background .14s,color .14s}
        .nav-btn:hover{background:${T.panel2}}
        .icon-btn{transition:border-color .15s,color .15s}
        .icon-btn:hover{border-color:${T.mut3};color:${T.text}}
        /* Metin gibi duran satır içi seçici: salt-okunur bir listenin ortasındaki kalıcı giriş
           kutusu görsel gürültüdür. Kenarlık yalnız etkileşimde belirir. Mobildeki
           "input,select,button{min-height:40px}" dokunma hedefi kuralı bunu 40px'e şişirip
           satırı domine ediyordu — burada bilinçli olarak geri alınıyor (küçük, ikincil,
           yanlışlıkla basılsa da geri alınabilir bir kontrol). */
        .inline-select{background:transparent!important;border-color:transparent!important;min-height:0!important;cursor:pointer}
        .inline-select:hover,.inline-select:focus{border-color:${T.line}!important;background:${T.panel2}!important}
        .hero-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:16px}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        /* grid item'ların varsayılan min-width:auto'su, içindeki taşan içeriği (örn. kaydırılabilir ay şeridi)
           sütunu genişletip sayfayı sağa taşırabilir — grid item'ları büzülebilir kılıyoruz. */
        .tab-grid > *, .hero-grid > *, .grid2 > *, .grid3 > * { min-width: 0; }
        /* İkili kart: masaüstünde iki kart yan yana görünür, sekme çubuğu gizli. Mobilde
           çubuk belirir ve yalnız seçili pane render edilir (Özet, ozet/index.tsx).
           Taban kuralı MEDYA SORGULARINDAN ÖNCE durmalı: medya sorgusu özgüllük katmaz,
           eşit özgüllükte SONRAKİ kural kazanır — taban "display:none" aşağıdayken mobil
           "display:flex"i eziyordu, yani çubuk hiç çıkmıyordu. Görünen sonuç: mobilde
           Varlık Dağılımı kartı başlıksız kalıyor (.duo-baslik gizli) ve Yaklaşan
           Hareketler'e ulaşmanın hiçbir yolu kalmıyordu. */
        .duo-tabs{display:none}
        @media (max-width:900px){ .hero-grid,.grid2,.grid3{grid-template-columns:1fr} }
        /* KPI'lar mobilde 2×2 kalır. grid2'nin tek sütuna inmesi bunlar için yanlıştı:
           dört kart tam genişlikte ~600px yiyip Özet'i yedi ekran boyuna çıkarıyordu.
           İçerik tek satırlık sayı — dar sütun yeter, yeter ki yazı ölçeği küçülsün.
           !important gerekli: kartlar stillerini inline veriyor. */
        @media (max-width:900px){
          .kpi-grid{grid-template-columns:1fr 1fr!important;gap:10px!important}
          .kpi-card{padding:13px 14px!important}
          .kpi-val{font-size:17px!important;margin-top:5px!important}
          .kpi-sub{font-size:10.5px!important}
          .duo-tabs{display:flex}
          .duo-pane[data-on="false"]{display:none!important}
          .duo-baslik{display:none} /* başlığı sekme çubuğu söylüyor, tekrarlama */
        }
        .bottom-nav{display:none}
        .add-fab{display:none}
        .mobile-only{display:none!important}
        .row-break{display:none} /* yalnız mobil sarmalamada iş görür (bkz. Row) */
        @media (max-width:900px){
          .desktop-only{display:none!important}
          .sidebar{display:none!important}
          .bottom-nav{display:flex}
          .add-fab{display:flex}
          .mobile-only{display:grid!important}
          .content-pad{padding:18px 16px calc(90px + env(safe-area-inset-bottom))!important}
          .topbar{padding:14px 16px!important}
          .btn-label{display:none}
          input,select,button{min-height:40px}
          /* Liste satırı yerleşimi mobilde SABİT — bkz. ui/index.tsx'teki Row açıklaması.
             (Bu blok bir template literal içinde: yorumda backtick KULLANMA, dizgiyi kapatır.)
             Eskiden yalnız flex-wrap:wrap vardı ve nereye sarılacağı satırın içeriğine
             kalıyordu: tutar kimi satırda başlıkla yan yana, kimi satırda tek başına 3.
             satıra düşüyor, uzun adlar 110px'e sıkışıp kırpılıyordu. Artık order düzeni
             belirler, row-break de kontrolleri kesin olarak alt satıra iter.
             !important gerekli: bu bileşenler stillerini inline veriyor (flex:1 vb.) ve
             inline stil sınıf kuralını yener. */
          /* flex-start: başlık iki satıra sardığında tutar dikeyde ortalanıp alt satırın
             üstüne biniyordu; tutar adın İLK satırıyla hizalı kalmalı. */
          .ui-row{flex-wrap:wrap;row-gap:6px;align-items:flex-start!important}
          .ui-row > .row-lead{order:0;flex-shrink:0} /* tarih / ikon / renk noktası */
          /* basis 0 şart: "auto" olsaydı başlık kendi içeriği kadar genişler, uzun bir
             hesap adı tutarı alt satıra iterdi (aynı listede tutarlar farklı satırlara
             düşüyordu). basis 0 + min-width 0 → başlık artan yeri alır, içinde sarar. */
          .ui-row > .row-title{order:1;flex:1 1 0!important;min-width:0!important}
          .ui-row > .row-amount{order:2;margin-left:auto!important;flex:0 0 auto!important;text-align:right!important;min-width:0!important}
          /* satır düzeyindeki küçük eylemler (✎ ✕) tutarın yanında, 1. satırda kalır;
             alt satıra atılınca tek başlarına üçüncü bir satır açıyorlardı. */
          .ui-row > .row-end{order:3;flex:0 0 auto!important}
          .ui-row > .row-break{order:4;flex-basis:100%;height:0;display:block}
          .ui-row > *{order:5}
          input,select,textarea{max-width:100%}
          /* Asistan sohbeti mobilde KENDİ içinde kayar. Sayfa akışında büyüseydi (eski hâl)
             birkaç mesaj sonra yazma kutusu ekranın çok altında kalıyor, kullanıcı her
             cümle için sayfayı dibe kaydırmak zorunda kalıyordu. Üst sınır vh ile değil
             min(...) ile: klavye açıkken 48vh hâlâ ekranın yarısını yiyip kutuyu klavyenin
             altına itiyordu. */
          .asistan-govde{max-height:min(46vh,320px);overflow-y:auto;overscroll-behavior:contain}
          /* Üst çubuk: sekme alt başlığı dar ekranda üç satıra sarıp başlığı ikonlardan
             koparıyordu; başlık tek başına yeterli. */
          .topbar-sub{display:none}
        }
      `}</style>

      {/* ==================== SIDEBAR ==================== */}
      <aside className="sidebar" style={{
        width: 248, flexShrink: 0, position: "sticky", top: 0, height: "100vh", display: "flex", flexDirection: "column",
        background: T.panel3, borderRight: `1px solid ${T.line}`, padding: "20px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 8px 22px" }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: `linear-gradient(140deg,${T.acc},${T.acc2})`, color: "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 17, boxShadow: `0 4px 12px -3px ${T.acc}`,
            fontFamily: T.mono, /* Schibsted Grotesk'in ₺ glifi bozuk (£ render ediyor) */
          }}>₺</span>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>Finans</div>
            <div style={{ fontSize: 11, color: T.mut3, fontWeight: 500 }}>kişisel finans</div>
          </div>
        </div>

        <button onClick={() => openAdd("pick")} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginBottom: 18,
          padding: 11, border: "none", borderRadius: 12, background: T.acc, color: T.accInk, fontWeight: 600, fontSize: 13.5,
          fontFamily: T.disp, cursor: "pointer", boxShadow: `0 4px 14px -5px ${T.acc}`,
        }}><span style={{ fontSize: 16, lineHeight: 0 }}>＋</span> Ekle</button>

        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: T.mut3, padding: "2px 10px 8px" }}>Menü</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => {
            const on = tab === n.key;
            return (
              <button key={n.key} className="nav-btn" onClick={() => setTab(n.key)} style={{
                display: "flex", alignItems: "center", gap: 11, padding: "9px 11px", border: "none", borderRadius: 11,
                cursor: "pointer", fontSize: 13.5, fontFamily: T.disp, fontWeight: on ? 600 : 500, textAlign: "left",
                background: on ? T.accSoft : "none", color: on ? T.acc : T.mut,
              }}><NavIcon tab={n.key} /> {n.label}</button>
            );
          })}
        </nav>

        {/* Tanımlar: ana menüde değil ama kenar çubuğunun dibinde erişilebilir — günlük iş
            listesini şişirmeden, aradığında bulunabilir bir yerde. */}
        <button className="nav-btn" onClick={() => setTab("tanimlar")} style={{
          marginTop: "auto", display: "flex", alignItems: "center", gap: 11, padding: "9px 11px",
          border: "none", borderRadius: 11, cursor: "pointer", fontSize: 13, fontFamily: T.disp,
          fontWeight: tab === "tanimlar" ? 600 : 500, textAlign: "left",
          background: tab === "tanimlar" ? T.accSoft : "none", color: tab === "tanimlar" ? T.acc : T.mut3,
        }}><NavIcon tab="tanimlar" /> Tanımlar</button>

        <div style={{ paddingTop: 12, borderTop: `1px solid ${T.line}`, display: "flex", alignItems: "center", gap: 10 }}>
          {/* Kullanıcı kartı artık tıklanabilir: kimliğin durduğu yer, kullanıcı hesabı
              ekranının da giriş kapısıdır (Hesabım — banka "Hesaplar"ıyla karıştırılmasın). */}
          <button className="nav-btn" onClick={() => setTab("profil")} title="Hesabım"
            style={{
              display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textAlign: "left",
              background: tab === "profil" ? T.accSoft : "none", border: "none", borderRadius: 10,
              padding: "4px 6px", cursor: "pointer", fontFamily: T.disp,
            }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: T.accSoft, color: T.acc, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{initials}</span>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: tab === "profil" ? T.acc : T.text }}>{user?.email?.split("@")[0]}</span>
              <span style={{ display: "block", fontSize: 11, color: T.mut3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</span>
            </span>
          </button>
          {privacyBtn({ width: 30, height: 30, borderRadius: 9 })}
          <button className="icon-btn" title="Açık / koyu tema" aria-label="Açık / koyu tema" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} style={{ ...iconBtn, width: 30, height: 30, borderRadius: 9 }}><ThemeIcon /></button>
          <button className="icon-btn" title="Çıkış yap" aria-label="Çıkış yap" onClick={logout} style={{ ...iconBtn, width: 30, height: 30, borderRadius: 9 }}><PowerIcon /></button>
        </div>
      </aside>

      {/* ==================== MAIN ==================== */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="topbar" style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 12, padding: "16px 32px",
          background: `color-mix(in srgb, ${T.bg} 82%, transparent)`, backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.line}`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>{meta.title}</div>
            <div className="topbar-sub" style={{ fontSize: 12.5, color: T.mut3, marginTop: 1 }}>{meta.sub}</div>
          </div>
          <div style={{ flex: 1 }} />
          {fiyatTazelik && (
            <span className="desktop-only" title={FIYAT_YASI_IPUCU}
              style={{ fontSize: 12, color: T.mut3, whiteSpace: "nowrap" }}>Fiyatlar {fiyatTazelik}</span>
          )}
          <button className="icon-btn desktop-only" onClick={refresh} disabled={refreshing} title="Fiyatları yenile" style={{
            display: "flex", alignItems: "center", gap: 7, width: "auto", height: 34, padding: "0 13px", borderRadius: 10,
            border: `1px solid ${T.line}`, background: T.panel, color: T.mut, fontSize: 12.5, fontWeight: 500, fontFamily: T.disp, cursor: "pointer",
          }}>
            <span style={{ fontSize: 13, display: "inline-block", animation: refreshing ? "spin 1s linear infinite" : "none" }}>↻</span>
            <span className="btn-label">{refreshing ? "Yenileniyor…" : "Fiyatları yenile"}</span>
          </button>
          {ccyToggle}
          {/* Mobil taşma menüsü — masaüstünde gizli (orada kenar çubuğu bu işi görür) */}
          <div className="mobile-only" style={{ position: "relative", placeItems: "center" }}>
            <button className="icon-btn" aria-label="Diğer" aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              style={{ ...iconBtn, ...(menuOpen ? { borderColor: T.acc, color: T.acc } : {}) }}>⋯</button>
            {menuOpen && (
              <div onClick={(e) => e.stopPropagation()} style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, minWidth: 210,
                background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: "var(--shadow)",
                padding: 6, display: "grid", gap: 2,
              }}>
                {([
                  /* `alt`: mobilde fiyat yaşının durabileceği tek yer burası — üst çubukta
                     390px'te yer yok, kartlara koymak Faz 32'de çıkarılan üçüncü kopyayı
                     geri getirirdi. Eylemin altında duran bir DURUM satırı, ayrı bir eylem
                     gibi okunmasın diye küçük ve soluk. */
                  { label: refreshing ? "Yenileniyor…" : "Fiyatları yenile", alt: fiyatTazelik ? `son çekim ${fiyatTazelik}` : undefined, icon: <span style={{ display: "inline-block", animation: refreshing ? "spin 1s linear infinite" : "none" }}>↻</span>, on: () => refresh(), disabled: refreshing },
                  /* renkli emoji yerine kenar çubuğuyla aynı SVG: menüdeki simgeler tek renk kalsın */
                  { label: balancesHidden ? "Bakiyeleri göster" : "Bakiyeleri gizle", icon: <EyeIcon off={balancesHidden} />, on: toggleBalancesHidden },
                  { label: theme === "light" ? "Koyu tema" : "Açık tema", icon: <ThemeIcon />, on: () => setTheme((t) => (t === "light" ? "dark" : "light")) },
                ] as { label: string; alt?: string; icon: React.ReactNode; on: () => void; disabled?: boolean; danger?: boolean }[]).map((it) => (
                  <button key={it.label} disabled={it.disabled}
                    onClick={() => { it.on(); setMenuOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                      background: "none", border: "none", borderRadius: 9, padding: "10px 11px", cursor: "pointer",
                      fontSize: 13.5, fontFamily: T.disp, fontWeight: 500, color: it.danger ? T.neg : T.text,
                      opacity: it.disabled ? 0.5 : 1,
                    }}>
                    <span style={{ width: 18, display: "grid", placeItems: "center", fontSize: 13, color: it.danger ? T.neg : T.mut }}>{it.icon}</span>
                    {it.alt
                      ? <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                        {it.label}
                        <span style={{ fontSize: 11, fontWeight: 500, color: T.mut3 }}>{it.alt}</span>
                      </span>
                      : it.label}
                  </button>
                ))}
                {/* Mobilde kenar çubuğu yok — kullanıcı hesabı ekranının kapısı burası.
                    E-posta salt metin değil, tıklanabilir: kimliğin durduğu yer. */}
                <button onClick={() => { setTab("tanimlar"); setMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                    background: "none", border: "none", borderRadius: 9,
                    padding: "10px 11px", cursor: "pointer", fontFamily: T.disp,
                    fontSize: 13.5, fontWeight: 500, color: T.text,
                  }}>
                  <span style={{ width: 18, display: "grid", placeItems: "center", color: T.mut }}><NavIcon tab="tanimlar" size={15} /></span>
                  Tanımlar
                </button>
                <button onClick={() => { setTab("profil"); setMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                    background: "none", border: "none", borderRadius: 9,
                    padding: "10px 11px", cursor: "pointer", fontFamily: T.disp,
                  }}>
                  <span style={{ width: 18, display: "grid", placeItems: "center", color: T.mut }}><NavIcon tab="profil" size={15} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: T.text }}>Hesabım</span>
                    <span style={{ display: "block", fontSize: 11, color: T.mut3, overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</span>
                  </span>
                </button>
                {/* Çıkış EN ALTTA ve ayırıcının altında: oturumu bitiren eylem, ayar
                    değiştiren ve ekran açan maddelerle aynı öbekte durmamalı — yanlışlıkla
                    basılması en pahalı madde odur. */}
                <button onClick={() => { logout(); setMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                    background: "none", border: "none", borderTop: `1px solid ${T.line}`, borderRadius: 0,
                    marginTop: 4, padding: "12px 11px 8px", cursor: "pointer",
                    fontSize: 13.5, fontFamily: T.disp, fontWeight: 500, color: T.neg,
                  }}>
                  <span style={{ width: 18, display: "grid", placeItems: "center", color: T.neg }}><PowerIcon /></span>
                  Çıkış yap
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="content-pad" style={{ flex: 1, padding: "26px 32px 56px", maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          {/* bayrak her render'da yeniden okunur: Hesabım'da parola değişince (bayrak silinir) uyarı da kalkar */}
          {!zayifKapatildi && tab !== "profil" && (() => { try { return sessionStorage.getItem(ZAYIF_PAROLA_KEY) === "1"; } catch { return false; } })() && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 12, borderRadius: 12, border: `1px solid ${T.warn}`, background: T.warnSoft, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0 }}>Parolan bugünkü güvenlik kurallarına uymuyor. Verilerin parolanla korunduğu için değiştirmeni öneririz.</span>
              <button style={{ ...css.ghost, padding: "6px 10px", whiteSpace: "nowrap" }} onClick={() => setTab("profil")}>Değiştir</button>
              <button aria-label="Kapat" title="Kapat" style={{ ...css.del, fontSize: 14 }} onClick={() => setZayifKapatildi(true)}>✕</button>
            </div>
          )}
          <div key={tab} className="tab-grid" style={{ animation: "fadeUp .4s ease both", display: "grid", gap: 16 }}>
            {tab === "ozet" && <Ozet data={data} days={days} pos={pos} cash={cash} rates={rates} reload={reload} summary={summary} m={m} onGoAccounts={() => setTab("hesaplar")}
              onGoPortfolio={() => setTab("portfoy")}
              onSellFund={(p: TradePrefill) => setAdd({ kind: "trade", tradePrefill: p })}
              onKurumsalOlay={(p: TradePrefill) => setAdd({ kind: "trade", tradePrefill: p })}
              onKurulum={() => setTab("kurulum")} />}
            {tab === "kurulum" && <Kurulum data={data} days={days} reload={reload} onBitir={kurulumBitir} />}
            {tab === "hesaplar" && <Hesaplar data={data} reload={reload} />}
            {tab === "profil" && <Profil user={user} data={data} reload={reload} onDeleted={() => { anahtarSil(); setUser(null); setData(null); }} />}
            {tab === "tanimlar" && <Tanimlar data={data} reload={reload} />}
            {tab === "nakit" && <Nakit days={days} data={data} />}
            {tab === "plan" && <Plan data={data} reload={reload} onRealize={(p) => openAdd("kalem", p)} />}
            {tab === "kart" && <Kartlar data={data} reload={reload} onAdd={(k) => openAdd(k)} />}
            {tab === "portfoy" && <Portfoy data={data} pos={pos} rates={rates} ccy={ccy} reload={reload} />}
            {tab === "kayitlar" && <Kayitlar data={data} reload={reload} />}
            {tab === "asistan" && <Asistan data={data} reload={reload} initialText={shared} onConsumed={() => setShared(null)} />}
          </div>
        </div>
      </main>

      {/* Kurulumda gizli: sihirbaz kendi giriş akışıdır ve mobilde düğme "İleri"nin üstüne biniyordu */}
      {tab !== "kurulum" && <button className="add-fab" aria-label="Ekle" onClick={() => openAdd("pick")} style={{
        position: "fixed", right: 18, bottom: "calc(70px + env(safe-area-inset-bottom))", zIndex: 30,
        width: 54, height: 54, borderRadius: 999, border: "none", cursor: "pointer",
        background: T.acc, color: T.accInk, fontSize: 26, fontWeight: 700, alignItems: "center", justifyContent: "center",
        boxShadow: `0 8px 22px -6px ${T.acc}`,
      }}>＋</button>}

      {add !== null && <AddSheet data={data} state={add} setState={setAdd} onClose={() => setAdd(null)} reload={reload} />}

      <nav className="bottom-nav" style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30,
        background: `color-mix(in srgb, ${T.panel} 92%, transparent)`, backdropFilter: "blur(14px)", borderTop: `1px solid ${T.line}`,
        padding: "6px 2px calc(6px + env(safe-area-inset-bottom))", justifyContent: "space-around", alignItems: "center",
      }}>
        {NAV.map((n) => (
          <button key={n.key} onClick={() => setTab(n.key)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none",
            padding: "6px 2px", cursor: "pointer", color: tab === n.key ? T.acc : T.mut3, fontSize: 9.5, fontWeight: 600, fontFamily: T.disp,
          }}><NavIcon tab={n.key} size={18} /> {n.short}</button>
        ))}
      </nav>
    </div>
  );
}

/* Açılışta ya da yeniden yüklemede API cevap vermediğinde tüm uygulamanın yerini alan ekran.
   Eskiden ham hatayı ve bir geliştirici talimatını basıyordu ("Error: Sunucu hatası. Sunucu
   çalışıyor mu? (npm run dev)") — prod'da kullanıcıya hiçbir şey söylemeyen bir metin (Faz 41.6,
   Neon kotası bitince görüldü). Ham hata metni hiçbir ortamda basılmaz (geliştirici için
   tarayıcı konsolu ve sunucu log'u var). Hata üç cinse indirilir çünkü kullanıcının yapabileceği şey
   cinse göre değişir; 503'ü sunucu yalnız DB'ye ULAŞILAMADIĞINDA döner (bkz. index.ts onError). */
function HataEkrani({ err, onRetry }: { err: unknown; onRetry: () => void }) {
  /* `fetch` ağ hatasında TypeError fırlatır; E2EE'de yükleme şifre çözmede de patlayabilir —
     o ağ sorunu değildir, "bağlantını kontrol et" demek yanlış yere yönlendirirdi. */
  const status = err instanceof ApiError ? err.status : 0;
  const ag = !status && err instanceof TypeError;
  const [baslik, metin] =
    status === 503 ? ["Hizmete şu an ulaşılamıyor", "Veritabanı geçici olarak yanıt vermiyor. Verilerin güvende — birkaç dakika sonra tekrar dene."]
    : status >= 500 ? ["Bir sorun oluştu", "Sunucu isteği tamamlayamadı. Verilerin güvende — biraz sonra tekrar dene."]
    : ag ? ["Sunucuya ulaşılamadı", "İnternet bağlantını kontrol edip tekrar dene."]
    : ["Bir sorun oluştu", "Veriler yüklenemedi. Tekrar deneyebilirsin."];
  return (
    <Center>
      <style>{themeCSS}</style>{/* erken dönüş: kabuğun <style>'ı henüz render edilmedi (Auth'taki gibi) */}
      <div style={{ maxWidth: 360, display: "grid", gap: 12, justifyItems: "center" }}>
        <div style={{ color: T.text, fontSize: 18, fontWeight: 640 }}>{baslik}</div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{metin}</div>
        <button style={css.btn} onClick={onRetry}>Tekrar dene</button>
      </div>
    </Center>
  );
}
