import React from "react";

/* Kenar çubuğu / alt menü sekmeleri — Finans.dc.html tasarımındaki sıra, başlık, alt başlık ve ikonlar. */
export type TabKey = "ozet" | "nakit" | "plan" | "kart" | "portfoy" | "rapor" | "hesaplar";

export const NAV: { key: TabKey; label: string; short: string; title: string; sub: string }[] = [
  { key: "ozet", label: "Özet", short: "Özet", title: "Özet", sub: "genel finansal durumun" },
  { key: "nakit", label: "Nakit Akışı", short: "Nakit", title: "Nakit Akışı", sub: "günlük nakit projeksiyonu" },
  { key: "plan", label: "Plan", short: "Plan", title: "Plan", sub: "düzenli & tek seferlik kalemler" },
  { key: "kart", label: "Kartlar", short: "Kart", title: "Kartlar", sub: "kredi kartı borç takibi" },
  { key: "portfoy", label: "Portföy", short: "Portföy", title: "Portföy", sub: "çok varlıklı yatırım pozisyonların" },
  { key: "rapor", label: "Rapor", short: "Rapor", title: "Rapor", sub: "gerçekleşen gelir & giderler" },
  { key: "hesaplar", label: "Hesaplar", short: "Hesap", title: "Hesaplar", sub: "banka hesapları & vadeli mevduat" },
];

const PATHS: Record<TabKey, React.ReactNode> = {
  ozet: <><rect x="1.5" y="1.5" width="6" height="6" rx="1.5" /><rect x="9.5" y="1.5" width="6" height="6" rx="1.5" /><rect x="1.5" y="9.5" width="6" height="6" rx="1.5" /><rect x="9.5" y="9.5" width="6" height="6" rx="1.5" /></>,
  nakit: <><rect x="1.5" y="3" width="14" height="12" rx="2" /><path d="M1.5 6.5h14M4.5 10.5h3" /></>,
  plan: <path d="M2.5 4.5h12M2.5 8.5h12M2.5 12.5h7" />,
  kart: <><rect x="1.5" y="3.5" width="14" height="10" rx="2" /><path d="M1.5 7h14" /></>,
  portfoy: <><path d="M2 11.5l3.5-4 3 2.5L14 4" /><path d="M10.5 4H14v3.5" /></>,
  rapor: <path d="M2.5 14.5v-5M6.5 14.5V3.5M10.5 14.5v-7M14.5 14.5V6" />,
  hesaplar: <><path d="M2 6l6.5-3.5L15 6" /><path d="M3.5 6.5v6M13.5 6.5v6M6.8 6.5v6M10.2 6.5v6M2 14.5h13" /></>,
};

export const NavIcon = ({ tab, size = 17 }: { tab: TabKey; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {PATHS[tab]}
  </svg>
);
