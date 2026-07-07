import type { CSSProperties } from "react";
import type { AssetType } from "@finans/engine";

/* ————— tasarım jetonları ————— */
export const T = {
  bg: "#0D1322", panel: "#151C2E", panel2: "#1B2438", line: "#263149",
  text: "#E9EEF8", mut: "#8B96AC", pos: "#3FD68F", neg: "#FF6B5E", acc: "#F0B23F",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  disp: "'Space Grotesk', system-ui, sans-serif",
};
export const TYPE_COLORS: Record<string, string> = {
  Nakit: "#5B8DEF", BIST: "#F0B23F", FON: "#3FD68F", ALTIN: "#E8C468", DOVIZ: "#9B7BF3", KRIPTO: "#FF8A5E",
};
export const TYPE_HINT: Record<AssetType, string> = {
  BIST: "THYAO, ASELS…", FON: "TEFAS kodu: AFT…", ALTIN: "GRAM, CEYREK, ONS, GUMUS",
  DOVIZ: "USD, EUR, GBP", KRIPTO: "BTC, ETH",
};

export const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
export const tl2 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });

export const css: Record<string, CSSProperties> = {
  card: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 },
  label: { fontSize: 11, color: T.mut, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 },
  input: {
    width: "100%", boxSizing: "border-box", background: T.panel2, border: `1px solid ${T.line}`,
    borderRadius: 8, color: T.text, padding: "9px 10px", fontSize: 14, fontFamily: T.mono, outline: "none",
  },
  btn: {
    background: T.acc, color: "#1A1408", border: "none", borderRadius: 8, padding: "10px 16px",
    fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  ghost: {
    background: "none", color: T.mut, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 14px",
    fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  del: { background: "none", border: "none", color: T.mut, cursor: "pointer", fontSize: 16, padding: 4 },
  mono: { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" },
};
