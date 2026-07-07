import React from "react";
import { T, css, tl } from "../theme";

export const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) => (
  <div style={{ flex: flex || 1, minWidth: 120 }}><div style={css.label}>{label}</div>{children}</div>
);

export const Money = ({ v, size = 14, sign, mut }: { v: number; size?: number; sign?: boolean; mut?: boolean }) => (
  <span style={{ ...css.mono, fontSize: size, color: mut ? T.mut : v > 0 ? (sign ? T.pos : T.text) : v < 0 ? T.neg : T.mut }}>
    {v > 0 && sign ? "+" : ""}{tl.format(v)}
  </span>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: T.mut, fontSize: 13, padding: "18px 0", textAlign: "center" }}>{children}</div>
);

export const Row = ({ children, last }: { children: React.ReactNode; last?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: last ? "none" : `1px solid ${T.line}` }}>
    {children}
  </div>
);

export const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: T.bg, minHeight: "100vh", color: T.mut, display: "grid", placeItems: "center", fontFamily: T.disp, padding: 24, textAlign: "center" }}>
    {children}
  </div>
);
