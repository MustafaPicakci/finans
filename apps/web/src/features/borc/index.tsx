import React, { useState } from "react";
import { todayStr, num, loanPayDay, loanRemaining, type AllData } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, Empty, Row } from "../../ui";

/* ————— BORÇLAR ————— */
export function Borclar({ data, reload }: { data: AllData; reload: () => void }) {
  const [f, setF] = useState({ name: "", amount: "", first_date: todayStr(), total: "" });
  const ok = f.name && num(f.amount) > 0 && f.first_date && +f.total >= 1;
  const now = new Date();
  const totalDebt = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, now), 0);
  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Kredi & Taksitler</div>
        <div style={{ fontSize: 12, color: T.mut }}>toplam kalan borç <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></div>
      </div>
      <div style={{ fontSize: 12, color: T.mut, margin: "4px 0 8px" }}>İlk taksit tarihi + toplam taksit sayısını gir; kalan taksit her ay otomatik azalır, bitince projeksiyondan düşer.</div>
      {data.loans.length === 0 && <Empty>Kredi, kredi kartı taksidi veya senet ekleyin.</Empty>}
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
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={f.name} placeholder="örn. İhtiyaç kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Aylık taksit (₺)"><input style={css.input} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="İlk taksit tarihi"><input type="date" style={css.input} value={f.first_date} onChange={(e) => setF({ ...f, first_date: e.target.value })} /></Field>
        <Field label="Toplam taksit"><input style={css.input} inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: ok ? 1 : 0.4 }} disabled={!ok}
        onClick={async () => {
          await api.post("loans", { name: f.name, amount: num(f.amount), first_date: f.first_date, total: +f.total });
          setF({ name: "", amount: "", first_date: todayStr(), total: "" }); reload();
        }}>Ekle</button>
    </div>
  );
}
