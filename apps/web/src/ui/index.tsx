import React from "react";
import { num, type Currency } from "@finans/engine";
import { T, css, tl, fmtMoney } from "../theme";

export const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) => (
  <div style={{ flex: flex || 1, minWidth: 120 }}><div style={css.label}>{label}</div>{children}</div>
);

/** Tutar girişi + canlı "₺1.234,56" (veya seçili para birimi) önizlemesi — sessiz yanlış-ayrıştırmayı önler */
export const AmountField = ({ label, value, onChange, placeholder, flex, inputRef, ccy = "TRY" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; flex?: number;
  inputRef?: React.Ref<HTMLInputElement>; ccy?: Currency;
}) => {
  const parsed = num(value);
  return (
    <Field label={label} flex={flex}>
      <input ref={inputRef} style={css.input} inputMode="decimal" placeholder={placeholder ?? "0"} value={value}
        onChange={(e) => onChange(e.target.value)} />
      {value.trim() !== "" && (
        <div style={{ fontSize: 11, color: parsed > 0 ? T.mut3 : T.neg, marginTop: 4 }}>
          {/* raw: girdi alanı zaten rakamları gösterdiğinden önizleme gizlilik modunda maskelenmez */}
          {parsed > 0 ? fmtMoney(parsed, ccy, true, true) : "geçersiz tutar"}
        </div>
      )}
    </Field>
  );
};

/** Devre dışı bir "Ekle" butonunun yanında, formu neden gönderemediğini açıklayan küçük ipucu */
export const Hint = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12, color: T.mut3, marginTop: 8 }}>{children}</div>
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

/** Basit modal: overlay tıklaması ve Escape kapatır */
export const Modal = ({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) => {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50, background: "rgba(10,8,18,.45)", backdropFilter: "blur(2px)",
      display: "grid", placeItems: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...css.card, width: "100%", maxWidth: 600, maxHeight: "88vh", overflowY: "auto", boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button style={css.del} aria-label="Kapat" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};
