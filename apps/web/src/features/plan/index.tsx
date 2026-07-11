import React, { useState } from "react";
import { todayStr, parseD, fmtD, num, ymOf, loanPayDay, loanRemaining, type AllData, type Recurring, type OneOff } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Money, Empty, Row } from "../../ui";
import type { KalemPrefill } from "../forms";

/* ————— PLAN (nakit projeksiyonunu besleyen her şey tek yerde) —————
   Düzenli gelir/giderler + ileri tarihli tek seferlik kalemler + krediler.
   Buradaki kayıtlar "gelecekte ne olacak" sorusuna cevaptır; Nakit Akışı bunlardan üretilir.
   Ekleme global "+ Ekle"dendir; burada listeleme/düzenleme/silme ve kalemleri
   "Gerçekleşti" ile deftere geçirme var. */

export function Plan({ data, reload, onRealize }: { data: AllData; reload: () => void; onRealize: (p: KalemPrefill) => void }) {
  const [changing, setChanging] = useState<Recurring | null>(null);
  const [chVal, setChVal] = useState({ amount: "", from_month: "" });
  const curYm = ymOf(new Date());
  const now = new Date();
  const today = todayStr();
  const prevYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return ymOf(new Date(y, m - 2, 1));
  };
  const fmtYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
  };
  const chYm = chVal.from_month || curYm;
  const chOk = num(chVal.amount) > 0 && !!chYm;
  /* "Değiştir": eski kaydı yeni tutarın geçerli olacağı aydan bir önceki ayda bitir, yeni değerle yeni kayıt aç */
  const applyChange = async (r: Recurring) => {
    if (!chOk) return;
    await api.put(`recurring/${r.id}`, { to_month: prevYm(chYm) });
    await api.post("recurring", {
      kind: r.kind, name: r.name, amount: num(chVal.amount), day: r.day,
      from_month: chYm, to_month: null,
    });
    setChanging(null); setChVal({ amount: "", from_month: "" }); reload();
  };
  const realize = (o: OneOff) =>
    onRealize({ name: o.name, amount: Math.abs(o.amount), type: o.amount < 0 ? "gider" : "gelir", oneoffId: o.id });
  const totalDebt = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, now), 0);

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Düzenli Gelir & Giderler</div>
      {data.recurring.length === 0 && <Empty>Maaş, kira, faturalar… her ay tekrarlayan kalemler. "+ Ekle" ile ekleyebilirsin.</Empty>}
      {data.recurring.map((r, i) => {
        const period = (r.from_month || r.to_month)
          ? `${r.from_month ? fmtYm(r.from_month) : "baştan"} – ${r.to_month ? fmtYm(r.to_month) : "süresiz"}`
          : "süresiz";
        const ended = r.to_month && r.to_month < curYm;
        return (
          <div key={r.id} style={{ padding: "9px 0", borderBottom: i === data.recurring.length - 1 ? "none" : `1px solid ${T.line}`, opacity: ended ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{r.name} {ended && <span style={{ fontSize: 11, color: T.mut }}>· bitti</span>}</div>
                <div style={{ fontSize: 11, color: T.mut }}>her ayın {r.day}. günü · {period}</div>
              </div>
              <Money v={r.kind === "income" ? r.amount : -r.amount} sign />
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12 }}
                onClick={() => { setChanging(changing?.id === r.id ? null : r); setChVal({ amount: String(r.amount), from_month: curYm }); }}>
                Değiştir
              </button>
              <button style={css.del} onClick={async () => { await api.del("recurring", r.id); reload(); }}>✕</button>
            </div>
            {changing?.id === r.id && (
              <form style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}
                onSubmit={(e) => { e.preventDefault(); applyChange(r); }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  Yeni tutar girilen aydan itibaren geçerli olur; eski tutar bir önceki aya kadar geçmiş projeksiyonda korunur.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <AmountField label="Yeni tutar (₺)" value={chVal.amount} onChange={(v) => setChVal({ ...chVal, amount: v })} />
                  <Field label="Geçerli ay"><input type="month" style={css.input} placeholder={curYm} value={chVal.from_month} onChange={(e) => setChVal({ ...chVal, from_month: e.target.value })} /></Field>
                  <button type="submit" style={{ ...css.btn, opacity: chOk ? 1 : 0.4 }} disabled={!chOk}>Uygula</button>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Tek Seferlik Kalemler</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        İleri tarihli planlar; günü gelince <b>Gerçekleşti</b> ile deftere geçir — hesap bakiyesine işler, plandan düşer.
      </div>
      {data.oneoffs.length === 0 && <Empty>Tatil, prim, vergi iadesi gibi ileri tarihli tek seferlik gelir/giderler.</Empty>}
      {data.oneoffs.map((o, i) => {
        const due = o.date <= today;
        return (
          <Row key={o.id} last={i === data.oneoffs.length - 1}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>{o.name} {due && <span style={{ fontSize: 11, color: T.warn }}>· günü geldi</span>}</div>
              <div style={{ fontSize: 11, color: T.mut, ...css.mono }}>{fmtD(parseD(o.date), { day: "2-digit", month: "short", year: "numeric" })}</div>
            </div>
            <Money v={o.amount} sign />
            <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, ...(due ? { color: T.acc, borderColor: T.acc } : {}) }}
              onClick={() => realize(o)}>Gerçekleşti</button>
            <button style={css.del} onClick={async () => { await api.del("oneoffs", o.id); reload(); }}>✕</button>
          </Row>
        );
      })}
    </div>

    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Krediler & Taksitler</div>
        {totalDebt > 0 && <div style={{ fontSize: 12, color: T.mut }}>kalan borç <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></div>}
      </div>
      <div style={{ fontSize: 12, color: T.mut, margin: "0 0 8px" }}>Kalan taksit tarihten otomatik hesaplanır; biten kredi projeksiyondan kendiliğinden düşer.</div>
      {data.loans.length === 0 && <Empty>Kredi, taksitli borç veya senet yok.</Empty>}
      {data.loans.map((l, i) => {
        const rem = loanRemaining(l, now);
        return (
          <Row key={l.id} last={i === data.loans.length - 1}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>{l.name} {rem === 0 && <span style={{ fontSize: 11, color: T.pos }}>· bitti</span>}</div>
              <div style={{ fontSize: 11, color: T.mut }}>
                ayın {loanPayDay(l)}. günü · <b style={{ color: T.acc }}>{rem}</b>/{l.total} taksit kaldı · kalan{" "}
                <span style={css.mono}>{tl.format(l.amount * rem)}</span>
              </div>
            </div>
            <span style={{ ...css.mono, color: rem ? T.neg : T.mut, fontSize: 14 }}>{tl.format(l.amount)}/ay</span>
            <button style={css.del} onClick={async () => { await api.del("loans", l.id); reload(); }}>✕</button>
          </Row>
        );
      })}
    </div>
  </>);
}
