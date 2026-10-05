import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { project, positions, cardInfos, stmtKey, loanRemaining, portfolioValueTry, depositValueOn, totalCash, convert,
  bekleyenDuzenli, bekleyenEkstreler, todayStr, kurulumGerekli, type Currency } from "@finans/engine";
import { api, ApiError, type SessionUser } from "./api";
import { T, css, fmtMoney, fiyatYasi, FIYAT_YASI_IPUCU, themeCSS, THEME_KEY, CCY_KEY, type ThemeMode } from "./theme";
import { Center } from "./ui";
import { NAV, NavIcon, PROFIL_META, TANIMLAR_META, KURULUM_META, ICE_AKTAR_META, MENU_META, type TabKey } from "./nav";
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
import { Menu } from "./features/menu";
import { ImportForm, iceAktarTemizle } from "./features/forms/ImportForm";
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
  /* Masaüstü kullanıcı menüsü (kenar çubuğunun dibindeki kimlik satırı): Hesabım, Tanımlar, tema,
     çıkış. Eskiden satırda üç simge düğmesi (göz/tema/çıkış) + ayrı bir "Tanımlar" düğmesi vardı;
     göz üst çubuğa çıktı (her ekranda lazım), gerisi burada. Telefonda bu işi Menü sayfası görür
     (eski ⋯ taşma menüsü kalktı). */
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
    await api.logout().catch(() => {}); await anahtarSil(); clearChat(); iceAktarTemizle(); setUser(null); setData(null);
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
  /** İçe aktarma sayfasından çıkınca dönülecek sekme (geldiğin yer); adresle doğrudan gelindiyse Özet. */
  const iceAktarDonus = useRef<TabKey>("ozet");
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
  const meta = NAV.find((n) => n.key === tab) ?? (tab === "tanimlar" ? TANIMLAR_META : tab === "kurulum" ? KURULUM_META : tab === "ice-aktar" ? ICE_AKTAR_META : tab === "menu" ? MENU_META : PROFIL_META);
  const iceAktaraGit = () => { if (tab !== "ice-aktar") iceAktarDonus.current = tab; setTab("ice-aktar"); };
  const summary = { netWorthTry, cash, portValueTry, depositsValueTry, cardDebt, loanDebt,
    accountCount: data.accounts.length, portTypes, cardsWaiting, loansActive };
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  /* Görüntü para birimi: GÖRÜNÜMÜ değiştirir → çukur şerit, seçili = beyaz yüzey + mor metin
     (Faz 24 kural 2; eskiden mor dolguydu ve üst çubuğun en baskın öğesiydi). */
  const ccyToggle = (
    <div role="group" aria-label="Görüntü para birimi" style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, flexShrink: 0, background: T.panel2, border: `1px solid ${T.line}` }}>
      {(["TRY", "USD"] as const).map((k) => {
        const disabled = k === "USD" && !usdReady;
        const on = ccy === k;
        return (
          <button key={k} className="ccy-btn" onClick={() => !disabled && setCcy(k)} disabled={disabled} aria-pressed={on}
            title={disabled ? "USD kuru için önce fiyatları yenile" : `Görüntü: ${k}`}
            style={{
              border: "none", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", width: 32, height: 28, fontSize: 13, fontWeight: on ? 700 : 500,
              /* mono font: Schibsted Grotesk'in ₺ (Lira) glifi bozuk (£ olarak render ediliyor) — bkz. tema notu */
              fontFamily: T.mono, background: on ? T.panel : "transparent", color: on ? T.acc : disabled ? T.mut3 : T.mut,
              boxShadow: on ? "var(--shadow-sm)" : "none",
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
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        /* grid item'ların varsayılan min-width:auto'su, içindeki taşan içeriği (örn. kaydırılabilir ay şeridi)
           sütunu genişletip sayfayı sağa taşırabilir — grid item'ları büzülebilir kılıyoruz. */
        .tab-grid > *, .grid2 > *, .grid3 > *, .ozet-ust > *, .ozet-alt > *, .ozet-bek > * { min-width: 0; }
        /* Özet (yeniden tasarım, Ekim 2026): net varlık + 2×2 kutu | senden bekleyenler (iki grup) |
           grafik + yaklaşan YAN YANA (eşit yükseklik — alt alta dizilince grafiğin altında ~400px
           boşluk kalıyordu). */
        .ozet-ust{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,500px);gap:16px}
        .ozet-kpi{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .ozet-bek{display:grid;grid-template-columns:1fr 1fr;column-gap:40px}
        .ozet-alt{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:stretch}
        .ozet-kutu{transition:border-color .15s}
        .ozet-kutu:hover{border-color:${T.mut3}!important}
        .kur-toggle{display:none!important}
        /* Hesaplar: masaüstünde iki sütun (hesaplar | virman + vadeli), telefonda tek */
        .hesap-ust{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);gap:16px;align-items:start}
        /* Portföy (grup 4): liste — üst kart | portföyler; detay — getiri grafiği | dağılım */
        .port-ust{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);gap:16px;align-items:start}
        .port-orta{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}
        .port-ust > *, .port-orta > *{min-width:0}
        /* Grup 5: Kayıtlar (arama+liste | özet), Nakit (takvim | gün), Plan (düzenli | tek seferlik + kredi) */
        .kayit-izgara{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);grid-template-areas:"ara ozet" "liste ozet";grid-template-rows:auto 1fr;gap:16px;align-items:start}
        .nakit-izgara{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);gap:16px;align-items:start}
        .plan-izgara{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,440px);grid-template-areas:"duzenli tek" "duzenli kredi";grid-template-rows:auto 1fr;gap:16px;align-items:start}
        .kayit-izgara > *, .nakit-izgara > *, .plan-izgara > *{min-width:0}
        /* Dokunulabilir liste satırı (grup 3 — satırda ✎ ✕ yok, satırın tamamı düzenlemeyi açar) */
        .liste-satir{transition:background .12s}
        .liste-satir:hover{background:${T.panel3}!important}
        /* Form alt çubuğu (forms/parcalar.tsx FormAlt): modal kutusunun dibine yapışık. Kutu
           padding'i 22px — çubuk kenara kadar uzansın diye negatif kenar boşluğu. */
        .form-alt{position:sticky;bottom:-22px;margin:18px -22px -22px;padding:12px 22px 18px;background:${T.panel};border-top:1px solid ${T.line2};display:grid;gap:10px;z-index:2}
        .modal-tutamak{display:none}
        .ekle-cipler{flex-wrap:wrap}
        .tutar-girdisi::placeholder{color:${T.mut3}}
        @keyframes sayfaYukari{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}
        /* İçe aktarma önizlemesinin eylem çubuğu: liste kayarken altta yapışık durur */
        .ice-eylem{position:sticky;bottom:12px}
        @media (max-width:900px){
          .grid2,.grid3,.ozet-ust,.ozet-alt,.ozet-bek,.hesap-ust,.port-ust,.port-orta,.nakit-izgara{grid-template-columns:1fr}
          .kayit-izgara{grid-template-columns:1fr;grid-template-areas:"ara" "ozet" "liste";grid-template-rows:auto}
          .plan-izgara{grid-template-columns:1fr;grid-template-areas:"duzenli" "tek" "kredi";grid-template-rows:auto}
          .treemap-kutu{height:190px!important}
          /* Kutular mobilde 2×2 kalır: tam genişlikte dört kart ~600px yiyordu */
          .ozet-kpi{gap:10px}
          .ozet-kutu{padding:13px 14px!important;border-radius:14px!important}
          .kpi-val{font-size:19px!important}
          .kpi-sub{font-size:11.5px!important}
          .nw-value{font-size:34px!important}
          .kur-toggle{display:flex!important}
          .kur-baslik{display:none}
          .kur-liste[data-acik="false"]{display:none}
          .ozet-secici{padding:7px 10px!important}
          .ice-eylem{bottom:calc(70px + env(safe-area-inset-bottom))}
          /* Modal → alttan açılan sayfa */
          .modal-zemin{place-items:end center!important;padding:0!important}
          .modal-kutu{max-width:none!important;border-radius:22px 22px 0 0!important;max-height:94dvh!important;padding:6px 20px 20px!important;border-bottom:none!important;animation:sayfaYukari .2s ease-out}
          .ekle-cipler{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
          .ekle-cipler::-webkit-scrollbar{display:none}
          .modal-tutamak{display:block;width:40px;height:5px;border-radius:3px;background:${T.line};margin:2px auto 10px}
          .form-alt{bottom:-20px;margin:18px -20px -20px;padding:12px 20px calc(16px + env(safe-area-inset-bottom))}
        }
        .bottom-nav{display:none}
        .mobile-only{display:none!important}
        .row-break{display:none} /* yalnız mobil sarmalamada iş görür (bkz. Row) */
        @media (max-width:900px){
          .desktop-only{display:none!important}
          .sidebar{display:none!important}
          .bottom-nav{display:flex}
          .mobile-only{display:grid!important}
          .content-pad{padding:18px 16px calc(90px + env(safe-area-inset-bottom))!important}
          .topbar{padding:12px 16px!important}
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

        {/* Kimlik satırı: Hesabım / Tanımlar / tema / çıkış tek menüde (eskiden satırda üç simge +
            ayrı Tanımlar düğmesi vardı). Menü yukarı açılır — satır kenar çubuğunun dibinde. */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${T.line}`, position: "relative" }}>
          {menuOpen && (
            <div onClick={(e) => e.stopPropagation()} role="menu" style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40,
              background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: "var(--shadow)",
              padding: 6, display: "grid", gap: 2,
            }}>
              {([
                { label: "Hesabım", icon: <NavIcon tab="profil" size={15} />, on: () => setTab("profil") },
                { label: "Tanımlar", icon: <NavIcon tab="tanimlar" size={15} />, on: () => setTab("tanimlar") },
                { label: theme === "light" ? "Koyu tema" : "Açık tema", icon: <ThemeIcon />, on: () => setTheme((t) => (t === "light" ? "dark" : "light")) },
              ]).map((it) => (
                <button key={it.label} role="menuitem" className="nav-btn" onClick={() => { it.on(); setMenuOpen(false); }} style={{
                  display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", background: "none", border: "none",
                  borderRadius: 9, padding: "9px 11px", cursor: "pointer", fontSize: 13.5, fontFamily: T.disp, fontWeight: 500, color: T.text,
                }}><span style={{ width: 18, display: "grid", placeItems: "center", color: T.mut }}>{it.icon}</span>{it.label}</button>
              ))}
              {/* Çıkış EN ALTTA ve ayırıcının altında: yanlışlıkla basılması en pahalı madde */}
              <button role="menuitem" className="nav-btn" onClick={() => { setMenuOpen(false); logout(); }} style={{
                display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", background: "none", border: "none",
                borderTop: `1px solid ${T.line}`, borderRadius: 0, marginTop: 4, padding: "11px 11px 8px", cursor: "pointer",
                fontSize: 13.5, fontFamily: T.disp, fontWeight: 500, color: T.neg,
              }}><span style={{ width: 18, display: "grid", placeItems: "center" }}><PowerIcon /></span>Çıkış yap</button>
            </div>
          )}
          <button className="nav-btn" aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              background: menuOpen || tab === "profil" || tab === "tanimlar" ? T.accSoft : "none", border: "none", borderRadius: 10,
              padding: "6px 6px", cursor: "pointer", fontFamily: T.disp,
            }}>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: T.accSoft, color: T.acc, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>{initials}</span>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: T.text }}>{user?.email?.split("@")[0]}</span>
              <span style={{ display: "block", fontSize: 11.5, color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill={T.mut} aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
          </button>
        </div>
      </aside>

      {/* ==================== MAIN ==================== */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="topbar" style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 12, padding: "16px 32px",
          background: `color-mix(in srgb, ${T.bg} 82%, transparent)`, backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.line}`,
        }}>
          {/* Alt başlık (meta.sub) kalktı: sekme başlığı zaten söylüyor, yeniden tasarımın 5. ilkesi */}
          <div style={{ minWidth: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{meta.title}</div>
          <div style={{ flex: 1 }} />
          {/* Fiyat yaşı + yenile TEK kontrol: yaşın cevap verdiği soru ("yenilemem gerekiyor mu?")
              düğmeye basmadan önce sorulur. Telefonda Menü sayfasında. */}
          <button className="icon-btn desktop-only" onClick={refresh} disabled={refreshing}
            title={fiyatTazelik ? `${FIYAT_YASI_IPUCU} Dokun: yenile.` : "Fiyatları yenile"} style={{
              display: "flex", alignItems: "center", gap: 7, width: "auto", height: 34, padding: "0 12px", borderRadius: 10,
              border: `1px solid ${T.line}`, background: T.panel, color: T.mut, fontSize: 13, fontWeight: 400, fontFamily: T.disp, cursor: "pointer",
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}><path d="M11.5 7A4.5 4.5 0 1 1 10 3.6" /><path d="M10.5 1.5v2.5H8" /></svg>
            {refreshing ? "Yenileniyor…" : fiyatTazelik ? `Fiyatlar ${fiyatTazelik}` : "Fiyatları yenile"}
          </button>
          {ccyToggle}
          {privacyBtn()}
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
            {tab === "ozet" && <Ozet data={data} days={days} pos={pos} cash={cash} rates={rates} reload={reload} summary={summary} m={m} onGo={setTab}
              onSellFund={(p: TradePrefill) => setAdd({ kind: "trade", tradePrefill: p })}
              onKurumsalOlay={(p: TradePrefill) => setAdd({ kind: "trade", tradePrefill: p })}
              onKurulum={() => setTab("kurulum")} />}
            {tab === "kurulum" && <Kurulum data={data} days={days} reload={reload} onBitir={kurulumBitir} />}
            {tab === "ice-aktar" && <ImportForm data={data} reload={reload} onClose={() => setTab(iceAktarDonus.current, true)} />}
            {tab === "hesaplar" && <Hesaplar data={data} reload={reload} />}
            {tab === "profil" && <Profil user={user} data={data} reload={reload} onDeleted={() => { anahtarSil(); setUser(null); setData(null); }} />}
            {tab === "tanimlar" && <Tanimlar data={data} reload={reload} />}
            {tab === "nakit" && <Nakit days={days} data={data} />}
            {tab === "plan" && <Plan data={data} reload={reload} onRealize={(p) => openAdd("kalem", p)} />}
            {tab === "kart" && <Kartlar data={data} reload={reload} onAdd={(k) => openAdd(k)} />}
            {tab === "portfoy" && <Portfoy data={data} pos={pos} rates={rates} ccy={ccy} reload={reload} />}
            {tab === "kayitlar" && <Kayitlar data={data} reload={reload} />}
            {tab === "menu" && <Menu data={data} user={user} theme={theme} setTheme={setTheme} refresh={refresh} refreshing={refreshing}
              fiyatTazelik={fiyatTazelik} onGo={setTab} onImport={iceAktaraGit} logout={logout} cardsWaiting={cardsWaiting} />}
            {tab === "asistan" && <Asistan data={data} reload={reload} initialText={shared} onConsumed={() => setShared(null)} />}
          </div>
        </div>
      </main>

      {add !== null && <AddSheet data={data} state={add} setState={setAdd} onClose={() => setAdd(null)} reload={reload}
        onImport={() => { setAdd(null); iceAktaraGit(); }} onAsistan={() => { setAdd(null); setTab("asistan"); }} />}

      {/* Telefon alt çubuğu (yeniden tasarım, Ekim 2026): sekiz sekme 390px'e sığmıyordu (10px etiket,
          kırpılmış adlar). Çubukta kullanıcının en sık kullandıkları — Özet, Asistan (harcamalar oradan
          söyleniyor), Portföy — ortada "+" ve kalanı için Menü. "+" çubuğun İÇİNDE: eski yüzen düğme
          içeriğin üstüne biniyordu. Menü, çubukta olmayan her sekmede seçili görünür (neredeyim?). */}
      <nav className="bottom-nav" style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30,
        background: `color-mix(in srgb, ${T.panel} 94%, transparent)`, backdropFilter: "blur(14px)", borderTop: `1px solid ${T.line}`,
        padding: "4px 6px calc(4px + env(safe-area-inset-bottom))", alignItems: "center",
      }}>
        {(["ozet", "asistan", "+", "portfoy", "menu"] as const).map((k) => {
          if (k === "+") return (
            <div key="+" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <button aria-label="Ekle" onClick={() => openAdd("pick")} style={{
                width: 50, height: 50, borderRadius: 16, border: "none", cursor: "pointer", background: T.acc, color: T.accInk,
                display: "grid", placeItems: "center", boxShadow: `0 6px 16px -6px ${T.acc}`,
              }}>
                <svg width="22" height="22" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 2v10M2 7h10" /></svg>
              </button>
            </div>
          );
          const on = k === "menu" ? !["ozet", "asistan", "portfoy"].includes(tab) : tab === k;
          const ad = k === "menu" ? MENU_META.short : NAV.find((n) => n.key === k)!.short;
          return (
            <button key={k} onClick={() => setTab(k)} aria-current={on ? "page" : undefined} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              background: "none", border: "none", height: 56, cursor: "pointer", color: on ? T.acc : T.mut,
              fontSize: 11, fontWeight: on ? 600 : 500, fontFamily: T.disp,
            }}><NavIcon tab={k} size={22} />{ad}</button>
          );
        })}
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
