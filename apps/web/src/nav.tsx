import React from "react";

/* Kenar çubuğu / alt menü sekmeleri — Finans.dc.html tasarımındaki sıra, başlık, alt başlık ve ikonlar. */
/* "profil" bilerek NAV dizisinde DEĞİL: ana menü zaten sekiz sekme ve orası günlük iş için.
   Kullanıcı hesabı ekranı kimliğin durduğu yerden açılır (kenar çubuğu kullanıcı kartı /
   mobil ⋯ menüsü). Sekme başlığı NAV'da bulunmadığından App.tsx PROFIL_META'ya düşer. */
export type TabKey = "ozet" | "nakit" | "plan" | "kart" | "portfoy" | "kayitlar" | "hesaplar" | "asistan" | "profil" | "tanimlar";

export const NAV: { key: TabKey; label: string; short: string; title: string; sub: string }[] = [
  { key: "ozet", label: "Özet", short: "Özet", title: "Özet", sub: "genel finansal durumun" },
  { key: "nakit", label: "Nakit Akışı", short: "Nakit", title: "Nakit Akışı", sub: "günlük nakit projeksiyonu" },
  { key: "plan", label: "Plan", short: "Plan", title: "Plan", sub: "düzenli & tek seferlik kalemler" },
  { key: "kart", label: "Kartlar", short: "Kart", title: "Kartlar", sub: "kredi kartı borç takibi" },
  { key: "portfoy", label: "Portföy", short: "Portföy", title: "Portföy", sub: "çok varlıklı yatırım pozisyonların" },
  /* Faz 26: "Rapor" kaldırıldı. Dört jenerik grafik parçasıydı ve kullanıcı hiç kullanmıyordu;
     yerine tek bir soruya cevap veren arama ekranı geldi ("şu kaydı ne zaman girmiştim?"). */
  { key: "kayitlar", label: "Kayıtlar", short: "Kayıt", title: "Kayıtlar", sub: "tüm hareketlerde ara" },
  { key: "hesaplar", label: "Hesaplar", short: "Hesap", title: "Hesaplar", sub: "banka hesapları & vadeli mevduat" },
  { key: "asistan", label: "Asistan", short: "Asistan", title: "Asistan", sub: "işlemlerini anlat, kayda o çevirsin" },
];

export const TANIMLAR_META = { key: "tanimlar" as TabKey, label: "Tanımlar", short: "Tanımlar", title: "Tanımlar", sub: "kategoriler ve diğer tanımlar" };
export const PROFIL_META = { key: "profil" as TabKey, label: "Hesabım", short: "Hesabım", title: "Hesabım", sub: "kullanıcı hesabın & verilerin" };

const PATHS: Record<TabKey, React.ReactNode> = {
  ozet: <><rect x="1.5" y="1.5" width="6" height="6" rx="1.5" /><rect x="9.5" y="1.5" width="6" height="6" rx="1.5" /><rect x="1.5" y="9.5" width="6" height="6" rx="1.5" /><rect x="9.5" y="9.5" width="6" height="6" rx="1.5" /></>,
  nakit: <><rect x="1.5" y="3" width="14" height="12" rx="2" /><path d="M1.5 6.5h14M4.5 10.5h3" /></>,
  plan: <path d="M2.5 4.5h12M2.5 8.5h12M2.5 12.5h7" />,
  kart: <><rect x="1.5" y="3.5" width="14" height="10" rx="2" /><path d="M1.5 7h14" /></>,
  portfoy: <><path d="M2 11.5l3.5-4 3 2.5L14 4" /><path d="M10.5 4H14v3.5" /></>,
  kayitlar: <><circle cx="7.5" cy="7.5" r="4.5" /><path d="M11 11l3.5 3.5" /></>,
  hesaplar: <><path d="M2 6l6.5-3.5L15 6" /><path d="M3.5 6.5v6M13.5 6.5v6M6.8 6.5v6M10.2 6.5v6M2 14.5h13" /></>,
  tanimlar: <><path d="M3 4.5h11M3 8.5h11M3 12.5h7" /><circle cx="12.5" cy="12.5" r="2" /></>,
  profil: <><circle cx="8.5" cy="6" r="3" /><path d="M2.5 15c0-3.3 2.7-5 6-5s6 1.7 6 5" /></>,
  asistan: <><path d="M2.5 3.5h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3.5 3v-3H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" /><path d="M5.5 7.5h6" /></>,
};

export const NavIcon = ({ tab, size = 17 }: { tab: TabKey; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {PATHS[tab]}
  </svg>
);
