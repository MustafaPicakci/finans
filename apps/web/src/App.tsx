import React, { useState, useEffect, useMemo, useCallback } from "react";
import { project, positions, cardInfos, stmtKey, loanRemaining, portfolioValueTry, depositValueOn, convert, type Currency } from "@finans/engine";
import { api, ApiError, type SessionUser } from "./api";
import { T, css, fmtMoney, themeCSS, THEME_KEY, CCY_KEY, type ThemeMode } from "./theme";
import { Center } from "./ui";
import { NAV, NavIcon, PROFIL_META, TANIMLAR_META, type TabKey } from "./nav";
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
import { Asistan } from "./features/asistan";
import { AddSheet, type AddState, type KalemPrefill, type TradePrefill } from "./AddSheet";

/* ————— ana uygulama ————— */
export default function App() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.all>> | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<TabKey>("ozet");
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
    if (e instanceof ApiError && e.status === 401) { setUser(null); setData(null); } // oturum düştü → giriş ekranı
    else setErr(String(e));
  }), []);
  useEffect(() => {
    api.me().then(({ user }) => { setUser(user); if (user) reload(); }).catch((e) => setErr(String(e)));
  }, [reload]);
  const logout = useCallback(async () => { await api.logout().catch(() => {}); setUser(null); setData(null); }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await api.refreshPrices(); await reload(); } catch { /* best-effort */ } finally { setRefreshing(false); }
  }, [reload]);
  useEffect(() => {
    if (!shared) return;
    setTab("asistan");
    window.history.replaceState({}, "", window.location.pathname); // metin tüketildi; yenilemede tekrarlanmasın
  }, [shared]);
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

  const rates = useMemo(() => ({ usdTry: Number(data?.settings.fx_usd_try || 0) }), [data]);
  const days = useMemo(() => (data ? project(data, Number(data.settings.horizon || 6), rates) : []), [data, rates]);
  const pos = useMemo(() => (data ? positions(data.trades, data.prices) : []), [data]);
  const cash = useMemo(() => (data ? data.accounts.reduce((s, a) => s + a.balance, 0) : 0), [data]);
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

  if (err) return <Center>API'ye ulaşılamadı: {err}. Sunucu çalışıyor mu? (npm run dev)</Center>;
  // E-posta bağlantısıyla gelen reset/verify token'ı: oturum yüklenmesini beklemeden Auth ekranını göster
  if (urlAuth) return <Auth urlAuth={urlAuth} onAuthed={(u) => { setUser(u); setErr(""); setUrlAuth(null); reload(); }} />;
  if (user === undefined) return <Center>Yükleniyor…</Center>;
  if (user === null) return <Auth onAuthed={(u) => { setUser(u); setErr(""); reload(); }} />;
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
  const meta = NAV.find((n) => n.key === tab) ?? (tab === "tanimlar" ? TANIMLAR_META : PROFIL_META);
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
        input:focus, select:focus { border-color:${T.acc} !important; box-shadow: 0 0 0 3px color-mix(in srgb, ${T.acc} 18%, transparent); }
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
        /* İkili kart: masaüstünde ikisi de yan yana görünür, sekme çubuğu gizli.
           Mobilde çubuk belirir ve yalnız seçili olan render edilir (Özet, ozet/index.tsx). */
        .duo-tabs{display:none}
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
          input,select{max-width:100%}
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
                  { label: refreshing ? "Yenileniyor…" : "Fiyatları yenile", icon: <span style={{ display: "inline-block", animation: refreshing ? "spin 1s linear infinite" : "none" }}>↻</span>, on: () => refresh(), disabled: refreshing },
                  /* renkli emoji yerine kenar çubuğuyla aynı SVG: menüdeki simgeler tek renk kalsın */
                  { label: balancesHidden ? "Bakiyeleri göster" : "Bakiyeleri gizle", icon: <EyeIcon off={balancesHidden} />, on: toggleBalancesHidden },
                  { label: theme === "light" ? "Koyu tema" : "Açık tema", icon: <ThemeIcon />, on: () => setTheme((t) => (t === "light" ? "dark" : "light")) },
                ] as { label: string; icon: React.ReactNode; on: () => void; disabled?: boolean; danger?: boolean }[]).map((it) => (
                  <button key={it.label} disabled={it.disabled}
                    onClick={() => { it.on(); setMenuOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                      background: "none", border: "none", borderRadius: 9, padding: "10px 11px", cursor: "pointer",
                      fontSize: 13.5, fontFamily: T.disp, fontWeight: 500, color: it.danger ? T.neg : T.text,
                      opacity: it.disabled ? 0.5 : 1,
                    }}>
                    <span style={{ width: 18, display: "grid", placeItems: "center", fontSize: 13, color: it.danger ? T.neg : T.mut }}>{it.icon}</span>
                    {it.label}
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
          <div key={tab} className="tab-grid" style={{ animation: "fadeUp .4s ease both", display: "grid", gap: 16 }}>
            {tab === "ozet" && <Ozet data={data} days={days} pos={pos} cash={cash} rates={rates} reload={reload} summary={summary} m={m} onGoAccounts={() => setTab("hesaplar")}
              onGoPortfolio={() => setTab("portfoy")}
              onSellFund={(p: TradePrefill) => setAdd({ kind: "trade", tradePrefill: p })} />}
            {tab === "hesaplar" && <Hesaplar data={data} reload={reload} />}
            {tab === "profil" && <Profil user={user} onDeleted={() => { setUser(null); setData(null); }} />}
            {tab === "tanimlar" && <Tanimlar data={data} reload={reload} />}
            {tab === "nakit" && <Nakit days={days} data={data} />}
            {tab === "plan" && <Plan data={data} reload={reload} onRealize={(p) => openAdd("kalem", p)} />}
            {tab === "kart" && <Kartlar data={data} reload={reload} onAdd={(k) => openAdd(k)} />}
            {tab === "portfoy" && <Portfoy data={data} pos={pos} rates={rates} ccy={ccy} reload={reload} onAdd={(k) => openAdd(k)} />}
            {tab === "kayitlar" && <Kayitlar data={data} reload={reload} />}
            {tab === "asistan" && <Asistan reload={reload} initialText={shared} onConsumed={() => setShared(null)} />}
          </div>
        </div>
      </main>

      <button className="add-fab" aria-label="Ekle" onClick={() => openAdd("pick")} style={{
        position: "fixed", right: 18, bottom: "calc(70px + env(safe-area-inset-bottom))", zIndex: 30,
        width: 54, height: 54, borderRadius: 999, border: "none", cursor: "pointer",
        background: T.acc, color: T.accInk, fontSize: 26, fontWeight: 700, alignItems: "center", justifyContent: "center",
        boxShadow: `0 8px 22px -6px ${T.acc}`,
      }}>＋</button>

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
