import React from "react";
import type { AllData } from "@finans/engine";
import type { SessionUser } from "../../api";
import { T, css, type ThemeMode } from "../../theme";
import { NavIcon, type TabKey } from "../../nav";

/* ————— Menü (telefon) —————
   Alt çubuk yalnız en sık kullanılanları taşır (Özet · Asistan · Portföy — kullanıcının kendi
   kullanımı: harcamayı asistana söylüyor, portföyü izliyor). Eskiden sekiz sekme 390px'e
   sığdırılıyordu: 10px etiketler, kırpılmış adlar, ~45px dokunma hedefleri. Kalan sekmeler ve
   eski ⋯ menüsündeki ayarlar burada: üstte büyük karolar (ekranlar), altta ayar satırları.
   Masaüstünde bu sayfaya bağlantı yoktur (orada kenar çubuğu her şeyi taşıyor). */

type Karo = { tab: TabKey; ad: string; alt: string };

export function Menu({ data, user, theme, setTheme, refresh, refreshing, fiyatTazelik, onGo, onImport, logout, cardsWaiting }: {
  data: AllData; user: SessionUser | null; theme: ThemeMode; setTheme: (t: ThemeMode) => void;
  refresh: () => void; refreshing: boolean; fiyatTazelik: string | null;
  onGo: (t: TabKey) => void; onImport: () => void; logout: () => void; cardsWaiting: number;
}) {
  const karolar: Karo[] = [
    { tab: "nakit", ad: "Nakit Akışı", alt: "takvim · projeksiyon" },
    { tab: "kart", ad: "Kartlar", alt: cardsWaiting > 0 ? `${cardsWaiting} ekstre bekliyor` : "ekstre takibi" },
    { tab: "hesaplar", ad: "Hesaplar", alt: `${data.accounts.length} hesap · mevduat` },
    { tab: "plan", ad: "Plan", alt: "düzenli · kredi" },
    { tab: "kayitlar", ad: "Kayıtlar", alt: "ara · harcama özeti" },
    { tab: "ice-aktar", ad: "İçe aktar", alt: "ekstre, döküm" },
  ];
  const satir: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "0 16px",
    background: "none", border: "none", borderTop: `1px solid ${T.line2}`, cursor: "pointer",
    fontFamily: T.disp, fontSize: 15, color: T.text, textAlign: "left",
  };
  const ok = (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.mut} strokeWidth="1.6" strokeLinecap="round"><path d="M5 3l4 4-4 4" /></svg>
  );
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {karolar.map((k) => (
        <button key={k.tab} onClick={() => (k.tab === "ice-aktar" ? onImport() : onGo(k.tab))} style={{
          ...css.card, borderRadius: 14, padding: 14, minHeight: 92, display: "flex", flexDirection: "column", gap: 8,
          alignItems: "flex-start", textAlign: "left", cursor: "pointer", fontFamily: T.disp, color: T.text,
        }}>
          <span style={{ color: T.acc }}><NavIcon tab={k.tab} size={22} /></span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{k.ad}</span>
          <span style={{ fontSize: 12, color: T.mut, marginTop: -4 }}>{k.alt}</span>
        </button>
      ))}
    </div>

    <div style={{ ...css.card, padding: 0, overflow: "hidden", borderRadius: 14 }}>
      <button style={{ ...satir, borderTop: "none" }} onClick={() => onGo("profil")}>
        <span style={{ width: 32, height: 32, borderRadius: 999, background: T.accSoft, color: T.acc, fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center", flexShrink: 0 }}>{initials}</span>
        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
          <span style={{ display: "block" }}>Hesabım</span>
          <span style={{ display: "block", fontSize: 12, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</span>
        </span>
        {ok}
      </button>
      <button style={satir} onClick={() => onGo("tanimlar")}>
        <span style={{ color: T.mut, display: "grid" }}><NavIcon tab="tanimlar" size={18} /></span>
        <span style={{ flex: 1 }}>Tanımlar</span>
        <span style={{ fontSize: 12.5, color: T.mut }}>kategoriler</span>
        {ok}
      </button>
      <button style={{ ...satir, opacity: refreshing ? 0.6 : 1 }} onClick={refresh} disabled={refreshing}>
        <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke={T.mut} strokeWidth="1.4" strokeLinecap="round" style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}><path d="M11.5 7A4.5 4.5 0 1 1 10 3.6" /><path d="M10.5 1.5v2.5H8" /></svg>
        <span style={{ flex: 1, lineHeight: 1.25 }}>
          <span style={{ display: "block" }}>{refreshing ? "Yenileniyor…" : "Fiyatları yenile"}</span>
          {fiyatTazelik && <span style={{ display: "block", fontSize: 12, color: T.mut }}>son çekim {fiyatTazelik}</span>}
        </span>
      </button>
      <button style={satir} role="switch" aria-checked={theme === "dark"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
        <svg width="18" height="18" viewBox="0 0 20 20" stroke={T.mut} strokeWidth="1.6" fill="none"><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 0 0 14Z" fill={T.mut} stroke="none" /></svg>
        <span style={{ flex: 1 }}>Koyu tema</span>
        <span style={{ width: 44, height: 26, borderRadius: 13, background: theme === "dark" ? T.acc : T.line, position: "relative", flexShrink: 0, transition: "background .15s" }}>
          <span style={{ position: "absolute", top: 3, left: theme === "dark" ? 21 : 3, width: 20, height: 20, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s" }} />
        </span>
      </button>
      {/* Çıkış EN ALTTA: oturumu bitiren eylem ayar satırlarıyla aynı öbekte durmamalı */}
      <button style={{ ...satir, color: T.neg }} onClick={logout}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 3v7" /><path d="M14.9 5.6a6.5 6.5 0 1 1-9.8 0" /></svg>
        Çıkış yap
      </button>
    </div>
  </>);
}
