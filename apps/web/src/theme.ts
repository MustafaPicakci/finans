import type { CSSProperties } from "react";
import type { AssetType } from "@finans/engine";

/**
 * Token sistemi: renkler CSS custom property olarak `themeCSS` içinde tanımlanır
 * (varsayılan = açık tema), `T`/`TYPE_COLORS`/`CATEGORY_PALETTE` bunlara `var(--x)`
 * referanslarıyla işaret eder — tema değişince (data-theme attribute) tüm bileşenler
 * otomatik güncellenir, hiçbir bileşen kodu tema bilmek zorunda kalmaz.
 */
export const themeCSS = `
  :root {
    --ground: #F5F5FA; --surface: #FFFFFF; --surface-2: #F7F7FC;
    --ink: #15131F; --ink-2: #57536A; --ink-3: #8B87A0;
    --line: #E6E4F0; --line-2: #EFEEF7;
    --brand: #5B5BD6; --brand-ink: #FFFFFF; --brand-soft: #ECECFB;
    --pos: #12A150; --pos-soft: #E8F6ED;
    --neg: #E5484D; --neg-soft: #FCECEC;
    --warn: #B7791F; --warn-soft: #FBF0DC;
    --type-nakit: #2a78d6; --type-fon: #008300; --type-bist: #eb6834; --type-altin: #eda100;
    --type-doviz: #4a3aa7; --type-kripto: #e87ba4; --type-etf: #1baf7a;
    --cat-1: #2a78d6; --cat-2: #1baf7a; --cat-3: #eda100; --cat-4: #008300;
    --cat-5: #4a3aa7; --cat-6: #e34948; --cat-7: #e87ba4; --cat-8: #eb6834;
    --shadow: 0 1px 2px rgba(21,19,31,.04), 0 8px 24px -12px rgba(21,19,31,.14);
    --shadow-sm: 0 1px 2px rgba(21,19,31,.05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #100E17; --surface: #18161F; --surface-2: #1D1B26;
      --ink: #EDEBF7; --ink-2: #A7A2BE; --ink-3: #726D8C;
      --line: #2A2735; --line-2: #211F2A;
      --brand: #8F8CF2; --brand-ink: #14132A; --brand-soft: #211F3C;
      --pos: #34D07E; --pos-soft: #12321F;
      --neg: #FF6B70; --neg-soft: #3A1B1C;
      --warn: #E6B450; --warn-soft: #34290F;
      --type-nakit: #3987e5; --type-fon: #008300; --type-bist: #d95926; --type-altin: #c98500;
      --type-doviz: #9085e9; --type-kripto: #d55181; --type-etf: #199e70;
      --cat-1: #3987e5; --cat-2: #199e70; --cat-3: #c98500; --cat-4: #008300;
      --cat-5: #9085e9; --cat-6: #e66767; --cat-7: #d55181; --cat-8: #d95926;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -14px rgba(0,0,0,.5);
      --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="light"] {
    --ground: #F5F5FA; --surface: #FFFFFF; --surface-2: #F7F7FC;
    --ink: #15131F; --ink-2: #57536A; --ink-3: #8B87A0;
    --line: #E6E4F0; --line-2: #EFEEF7;
    --brand: #5B5BD6; --brand-ink: #FFFFFF; --brand-soft: #ECECFB;
    --pos: #12A150; --pos-soft: #E8F6ED;
    --neg: #E5484D; --neg-soft: #FCECEC;
    --warn: #B7791F; --warn-soft: #FBF0DC;
    --type-nakit: #2a78d6; --type-fon: #008300; --type-bist: #eb6834; --type-altin: #eda100;
    --type-doviz: #4a3aa7; --type-kripto: #e87ba4; --type-etf: #1baf7a;
    --cat-1: #2a78d6; --cat-2: #1baf7a; --cat-3: #eda100; --cat-4: #008300;
    --cat-5: #4a3aa7; --cat-6: #e34948; --cat-7: #e87ba4; --cat-8: #eb6834;
    --shadow: 0 1px 2px rgba(21,19,31,.04), 0 8px 24px -12px rgba(21,19,31,.14);
    --shadow-sm: 0 1px 2px rgba(21,19,31,.05);
  }
  :root[data-theme="dark"] {
    --ground: #100E17; --surface: #18161F; --surface-2: #1D1B26;
    --ink: #EDEBF7; --ink-2: #A7A2BE; --ink-3: #726D8C;
    --line: #2A2735; --line-2: #211F2A;
    --brand: #8F8CF2; --brand-ink: #14132A; --brand-soft: #211F3C;
    --pos: #34D07E; --pos-soft: #12321F;
    --neg: #FF6B70; --neg-soft: #3A1B1C;
    --warn: #E6B450; --warn-soft: #34290F;
    --type-nakit: #3987e5; --type-fon: #008300; --type-bist: #d95926; --type-altin: #c98500;
    --type-doviz: #9085e9; --type-kripto: #d55181; --type-etf: #199e70;
    --cat-1: #3987e5; --cat-2: #199e70; --cat-3: #c98500; --cat-4: #008300;
    --cat-5: #9085e9; --cat-6: #e66767; --cat-7: #d55181; --cat-8: #d95926;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -14px rgba(0,0,0,.5);
    --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  }
`;

export type ThemeMode = "light" | "dark";
export const THEME_KEY = "finans-theme";

/* ————— tasarım jetonları ————— */
export const T = {
  bg: "var(--ground)", panel: "var(--surface)", panel2: "var(--surface-2)", line: "var(--line)", line2: "var(--line-2)",
  text: "var(--ink)", mut: "var(--ink-2)", mut3: "var(--ink-3)",
  pos: "var(--pos)", posSoft: "var(--pos-soft)", neg: "var(--neg)", negSoft: "var(--neg-soft)",
  warn: "var(--warn)", warnSoft: "var(--warn-soft)",
  acc: "var(--brand)", accInk: "var(--brand-ink)", accSoft: "var(--brand-soft)",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  disp: "'Space Grotesk', system-ui, sans-serif",
};
export const TYPE_COLORS: Record<string, string> = {
  Nakit: "var(--type-nakit)", BIST: "var(--type-bist)", FON: "var(--type-fon)", ALTIN: "var(--type-altin)",
  DOVIZ: "var(--type-doviz)", KRIPTO: "var(--type-kripto)", ETF: "var(--type-etf)",
};
export const TYPE_HINT: Record<AssetType, string> = {
  BIST: "THYAO, ASELS…", FON: "TEFAS kodu: AFT…", ALTIN: "GRAM, CEYREK, ONS, GUMUS",
  DOVIZ: "USD, EUR, GBP", KRIPTO: "BTC, ETH", ETF: "VOO, QQQ, VTI… (ABD/global borsa)",
};
/** Kategoriler için sabit sıralı kategorik palet (dataviz becerisiyle açık+koyu yüzeye karşı doğrulanmış); id sırasına göre atanır, 9. kategoriden itibaren döngüye girer */
export const CATEGORY_PALETTE = [
  "var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)",
  "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)",
];

export const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
export const tl2 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });

export const css: Record<string, CSSProperties> = {
  card: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 20, padding: 20, boxShadow: "var(--shadow-sm)" },
  label: { fontSize: 11.5, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, fontWeight: 600 },
  input: {
    width: "100%", boxSizing: "border-box", background: T.panel2, border: `1px solid ${T.line}`,
    borderRadius: 10, color: T.text, padding: "10px 12px", fontSize: 14, fontFamily: T.mono, outline: "none",
    transition: "border-color .15s, box-shadow .15s",
  },
  btn: {
    background: T.acc, color: T.accInk, border: "none", borderRadius: 10, padding: "11px 18px",
    fontWeight: 640, fontSize: 13, cursor: "pointer", fontFamily: T.disp, transition: "filter .15s, transform .05s",
  },
  ghost: {
    background: T.panel2, color: T.mut, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 14px",
    fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  del: { background: "none", border: "none", color: T.mut3, cursor: "pointer", fontSize: 16, padding: 4, borderRadius: 8 },
  mono: { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" },
};
