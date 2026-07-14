import React, { useState, useEffect, useMemo, useCallback } from "react";
import { project, positions, cardInfos, loanRemaining, portfolioValueTry, convert, type Currency } from "@finans/engine";
import { api, ApiError, type SessionUser } from "./api";
import { T, css, fmtMoney, themeCSS, THEME_KEY, CCY_KEY, type ThemeMode } from "./theme";
import { Center } from "./ui";
import { Auth, type UrlAuth } from "./features/auth";
import { Ozet } from "./features/ozet";
import { Nakit } from "./features/nakit";
import { Plan } from "./features/plan";
import { Kartlar } from "./features/kart";
import { Portfoy } from "./features/portfoy";
import { Rapor } from "./features/rapor";
import { AddSheet, type AddState, type KalemPrefill } from "./AddSheet";

/* ————— ana uygulama ————— */
export default function App() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.all>> | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"ozet" | "nakit" | "plan" | "kart" | "portfoy" | "rapor">("ozet");
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) as ThemeMode) || "light");
  const [ccy, setCcy] = useState<Currency>(() => (localStorage.getItem(CCY_KEY) as Currency) || "TRY");
  const [add, setAdd] = useState<AddState | null>(null); // global "+ Ekle" akışı
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = oturum kontrol ediliyor
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
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem(CCY_KEY, ccy); }, [ccy]);

  const rates = useMemo(() => ({ usdTry: Number(data?.settings.fx_usd_try || 0) }), [data]);
  const days = useMemo(() => (data ? project(data, Number(data.settings.horizon || 6), rates) : []), [data, rates]);
  const pos = useMemo(() => (data ? positions(data.trades, data.prices) : []), [data]);
  const cash = useMemo(() => (data ? data.accounts.reduce((s, a) => s + a.balance, 0) : 0), [data]);
  const portValueTry = useMemo(() => portfolioValueTry(pos, rates), [pos, rates]);
  const cardInfoList = useMemo(() => {
    if (!data) return [];
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return cardInfos(data.cards, data.card_txs, t);
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
  const netWorthTry = cash + portValueTry - cardDebt - loanDebt;
  const m = (tryVal: number, dec = false) => fmtMoney(convert(tryVal, "TRY", ccy, rates), ccy, dec);
  const usdReady = rates.usdTry > 0; // FX kuru yoksa USD toggle pasif
  const portTypes = [...new Set(pos.filter((p) => (p.value ?? 0) > 0).map((p) => p.type))];
  const cardsWaiting = cardInfoList.filter((c) => c.debt > 0).length;
  const loansActive = data.loans.filter((l) => loanRemaining(l, new Date()) > 0).length;

  const tabs: [typeof tab, string, string][] = [
    ["ozet", "Özet", "Özet"], ["nakit", "Nakit Akışı", "Nakit"], ["plan", "Plan", "Plan"],
    ["kart", "Kartlar", "Kart"], ["portfoy", "Portföy", "Portföy"], ["rapor", "Rapor", "Rapor"],
  ];
  const openAdd = (kind: AddState["kind"], prefill?: KalemPrefill) => setAdd({ kind, prefill });

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: T.disp }}>
      <style>{themeCSS}</style>
      <style>{`
        * { box-sizing: border-box; }
        input:focus, select:focus { border-color:${T.acc} !important; box-shadow: 0 0 0 3px color-mix(in srgb, ${T.acc} 18%, transparent); }
        button:active{transform:scale(0.97)}
        ::-webkit-scrollbar{height:6px;width:6px} ::-webkit-scrollbar-thumb{background:${T.line};border-radius:3px}
        .top-tabs{display:flex}
        .bottom-nav{display:none}
        .main-content{padding-bottom:16px}
        .tab-btn{transition:background .15s,color .15s}
        .tab-btn:hover{background:${T.line2}}
        .theme-toggle{transition:border-color .15s,color .15s}
        .theme-toggle:hover{border-color:${T.mut3};color:${T.text}}
        .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .add-fab{display:none}
        @media (max-width:720px){
          .top-tabs{display:none}
          .bottom-nav{display:grid}
          .main-content{padding-bottom:calc(72px + env(safe-area-inset-bottom))}
          .kpis{grid-template-columns:repeat(2,1fr)}
          input,select,button{min-height:40px}
          .add-btn-top{display:none}
          .add-fab{display:grid}
        }
      `}</style>

      <div style={{ position: "sticky", top: 0, zIndex: 10, background: `color-mix(in srgb, ${T.bg} 90%, transparent)`, backdropFilter: "blur(10px)", borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 680, fontSize: 16, letterSpacing: "-0.02em", flexShrink: 0 }}>
            <span style={{
              width: 26, height: 26, borderRadius: 8, background: T.acc, color: T.accInk,
              display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800,
            }}>₺</span>
            finans
          </div>
          <div className="top-tabs" style={{ gap: 2, overflowX: "auto", flex: 1 }}>
            {tabs.map(([k, l]) => (
              <button key={k} className="tab-btn" onClick={() => setTab(k)} style={{
                background: tab === k ? T.accSoft : "none", border: "none", cursor: "pointer", padding: "8px 12px", fontSize: 14,
                fontFamily: T.disp, fontWeight: tab === k ? 640 : 500, whiteSpace: "nowrap", borderRadius: 10,
                color: tab === k ? T.acc : T.mut,
              }}>{l}</button>
            ))}
          </div>
          <button className="add-btn-top" onClick={() => openAdd("pick")} style={{
            ...css.btn, padding: "8px 14px", flexShrink: 0,
          }}>+ Ekle</button>
          <div style={{ display: "flex", border: `1px solid ${T.line}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
            {(["TRY", "USD"] as const).map((k) => {
              const disabled = k === "USD" && !usdReady;
              return (
                <button key={k} onClick={() => !disabled && setCcy(k)} disabled={disabled}
                  title={disabled ? "USD kuru için önce fiyatları yenile" : `Görüntü: ${k}`}
                  style={{
                    border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: "7px 11px", fontSize: 13, fontWeight: 700,
                    fontFamily: T.disp, background: ccy === k ? T.acc : T.panel, color: ccy === k ? T.accInk : disabled ? T.mut3 : T.mut,
                  }}>{k === "TRY" ? "₺" : "$"}</button>
              );
            })}
          </div>
          <button className="theme-toggle" aria-label="Temayı değiştir" title="Açık / koyu tema"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            style={{
              width: 36, height: 36, borderRadius: 999, border: `1px solid ${T.line}`, background: T.panel,
              color: T.mut, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0,
            }}>◐</button>
          <button aria-label="Çıkış yap" title={`Çıkış yap${user ? ` (${user.email})` : ""}`} onClick={logout}
            style={{
              width: 36, height: 36, borderRadius: 999, border: `1px solid ${T.line}`, background: T.panel,
              color: T.mut, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0,
            }}>⏻</button>
        </div>
      </div>

      <div className="main-content" style={{ maxWidth: 960, margin: "0 auto", padding: 16, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
        <div style={{ padding: "10px 4px 4px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.mut }}>Net Varlık</div>
          <div style={{ ...css.mono, fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{m(netWorthTry)}</div>
          <div style={{ fontSize: 13, color: T.mut3, marginTop: 6 }}>nakit + portföy − kart borcu − kredi borcu</div>
        </div>

        <div className="kpis">
          <div style={css.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 550, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: "var(--type-nakit)", display: "inline-block" }} />Nakit
            </div>
            <div style={{ ...css.mono, fontSize: 22, fontWeight: 680, letterSpacing: "-0.01em", marginTop: 4 }}>{m(cash)}</div>
            <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>{data.accounts.length} hesap</div>
          </div>
          <div style={css.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 550, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: T.acc, display: "inline-block" }} />Portföy
            </div>
            <div style={{ ...css.mono, fontSize: 22, fontWeight: 680, letterSpacing: "-0.01em", marginTop: 4 }}>{m(portValueTry)}</div>
            <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>{portTypes.length ? portTypes.join(" · ") : "henüz işlem yok"}</div>
          </div>
          <div style={css.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 550, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: T.neg, display: "inline-block" }} />Kart Borcu
            </div>
            <div style={{ ...css.mono, fontSize: 22, fontWeight: 680, letterSpacing: "-0.01em", marginTop: 4, color: cardDebt > 0 ? T.neg : T.text }}>
              {cardDebt > 0 ? "−" : ""}{m(cardDebt)}
            </div>
            <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>{cardsWaiting > 0 ? `${cardsWaiting} ekstre bekliyor` : "borç yok"}</div>
          </div>
          <div style={css.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 550, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: T.neg, display: "inline-block" }} />Kredi Borcu
            </div>
            <div style={{ ...css.mono, fontSize: 22, fontWeight: 680, letterSpacing: "-0.01em", marginTop: 4, color: loanDebt > 0 ? T.neg : T.text }}>
              {loanDebt > 0 ? "−" : ""}{m(loanDebt)}
            </div>
            <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>{loansActive > 0 ? `${loansActive} aktif kredi` : "borç yok"}</div>
          </div>
        </div>

        {tab === "ozet" && <Ozet data={data} days={days} pos={pos} cash={cash} rates={rates} reload={reload} user={user} onAccountDeleted={() => { setUser(null); setData(null); }} />}
        {tab === "nakit" && <Nakit days={days} />}
        {tab === "plan" && <Plan data={data} reload={reload} onRealize={(p) => openAdd("kalem", p)} />}
        {tab === "kart" && <Kartlar data={data} reload={reload} onAdd={(k) => openAdd(k)} />}
        {tab === "portfoy" && <Portfoy data={data} pos={pos} rates={rates} ccy={ccy} reload={reload} onAdd={(k) => openAdd(k)} />}
        {tab === "rapor" && <Rapor data={data} reload={reload} />}
      </div>

      <button className="add-fab" aria-label="Ekle" onClick={() => openAdd("pick")} style={{
        position: "fixed", right: 16, bottom: "calc(64px + env(safe-area-inset-bottom))", zIndex: 20,
        width: 52, height: 52, borderRadius: 999, border: "none", cursor: "pointer",
        background: T.acc, color: T.accInk, fontSize: 26, fontWeight: 700, placeItems: "center",
        boxShadow: "var(--shadow)",
      }}>+</button>

      {add !== null && <AddSheet data={data} state={add} setKind={(k) => setAdd({ kind: k })} onClose={() => setAdd(null)} reload={reload} />}

      <div className="bottom-nav" style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 10,
        gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
        background: `color-mix(in srgb, ${T.bg} 90%, transparent)`, backdropFilter: "blur(10px)", borderTop: `1px solid ${T.line}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {tabs.map(([k, , short]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 4px", fontSize: 11,
            fontFamily: T.disp, fontWeight: tab === k ? 700 : 400, color: tab === k ? T.acc : T.mut,
          }}>{short}</button>
        ))}
      </div>
    </div>
  );
}
