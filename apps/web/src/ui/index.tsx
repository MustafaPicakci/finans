import React from "react";
import { num, type Currency } from "@finans/engine";
import { T, css, tl, fmtMoney } from "../theme";

export const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) => (
  <div style={{ flex: flex || 1, minWidth: 120 }}><div style={css.label}>{label}</div>{children}</div>
);

/** Tutar girişi + canlı "₺1.234,56" (veya seçili para birimi) önizlemesi — sessiz yanlış-ayrıştırmayı önler */
/** `sign`: alanın kabul ettiği değer aralığı. Varsayılan "pozitif" — bir gelir/gider/işlem
    tutarı sıfır ya da eksi olamaz. Ama her tutar alanı böyle DEĞİL: mutabakatta girilen
    "gerçek bakiye" 0 olabilir (boşalmış nakit cüzdanı) ve eksi olabilir (KMH'li hesap).
    Bu ayrım prop'a bağlı, yoksa alan geçerli girdiyi "geçersiz tutar" diye reddeder gibi
    görünür ve kullanıcı denemekten vazgeçer. */
export const AmountField = ({ label, value, onChange, placeholder, flex, inputRef, ccy = "TRY", sign = "pozitif" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; flex?: number;
  inputRef?: React.Ref<HTMLInputElement>; ccy?: Currency; sign?: "pozitif" | "serbest";
}) => {
  const parsed = num(value);
  /* `num` çözemediğinde 0 döner → "abc" ile "0"ı ayırt edemez; serbest modda 0 geçerli
     olduğundan girdinin biçimine de bakılır. */
  const sayisal = /^-?\s*[\d.,]+$/.test(value.trim());
  const ok = sign === "serbest" ? sayisal : parsed > 0;
  return (
    <Field label={label} flex={flex}>
      <input ref={inputRef} style={css.input} inputMode="decimal" placeholder={placeholder ?? "0"} value={value}
        onChange={(e) => onChange(e.target.value)} />
      {value.trim() !== "" && (
        <div style={{ fontSize: 11, color: ok ? T.mut3 : T.neg, marginTop: 4 }}>
          {/* raw: girdi alanı zaten rakamları gösterdiğinden önizleme gizlilik modunda maskelenmez */}
          {ok ? fmtMoney(parsed, ccy, true, true) : "geçersiz tutar"}
        </div>
      )}
    </Field>
  );
};

/** Geçmişten öğrenen metin girişi: yazarken eşleşen kayıtlar listelenir, seçilince `onPick`
    formun geri kalanını (tutar/kategori/hesap…) doldurur. Klavye: ↑/↓ gezinme, Enter seç, Esc kapat.
    Liste açıkken Enter formu göndermez (öneri seçer) — art arda giriş akışı bozulmasın. */
export function SuggestInput<S>({ value, onChange, onPick, options, labelOf, subOf, inputRef, placeholder, style, max = 6, autoFocus }: {
  value: string; onChange: (v: string) => void; onPick: (s: S) => void;
  options: S[]; labelOf: (s: S) => string; subOf?: (s: S) => string;
  inputRef?: React.RefObject<HTMLInputElement>; placeholder?: string; style?: React.CSSProperties;
  max?: number; autoFocus?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [i, setI] = React.useState(0);
  const q = value.trim().toLocaleLowerCase("tr");
  // boşken en sık kullanılanlar, yazarken içinde geçenler (baştan eşleşenler önce)
  const hits = React.useMemo(() => {
    const list = q === "" ? options : options.filter((o) => labelOf(o).toLocaleLowerCase("tr").includes(q));
    if (q !== "") {
      list.sort((a, b) => Number(labelOf(b).toLocaleLowerCase("tr").startsWith(q)) - Number(labelOf(a).toLocaleLowerCase("tr").startsWith(q)));
    }
    // birebir aynı tek eşleşme varsa liste anlamsız
    return list.length === 1 && labelOf(list[0]).toLocaleLowerCase("tr") === q ? [] : list.slice(0, max);
  }, [options, q, max]);
  const show = open && hits.length > 0;
  const pick = (s: S) => { onPick(s); setOpen(false); };
  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef} style={{ ...css.input, ...style }} value={value} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setI(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // tıklama blur'dan sonra gelir
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => (x + 1) % hits.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => (x - 1 + hits.length) % hits.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hits[i]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      />
      {show && (
        <div style={{
          position: "absolute", zIndex: 5, left: 0, right: 0, top: "calc(100% + 4px)", background: T.panel,
          border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: "var(--shadow)", overflow: "hidden",
        }}>
          {hits.map((o, k) => (
            <div key={k} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setI(k)}
              style={{
                display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", cursor: "pointer",
                padding: "8px 11px", fontSize: 13, background: k === i ? T.panel2 : "transparent",
                borderTop: k === 0 ? "none" : `1px solid ${T.line}`,
              }}>
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(o)}</span>
              {subOf && <span style={{ color: T.mut3, fontSize: 11, flexShrink: 0 }}>{subOf(o)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
