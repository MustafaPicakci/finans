import React, { useRef, useState } from "react";
import { parseD, fmtD, num, cardInfos, txShares, type AllData } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Hint, Empty, Row } from "../../ui";
import type { AddKind } from "../forms";

/* ————— KARTLAR ————— */
/* Kart TANIMI burada yapılır; kart HARCAMASI girişi global "+" akışındadır. */
export function Kartlar({ data, reload, onAdd }: { data: AllData; reload: () => void; onAdd: (k: AddKind) => void }) {
  const [cf, setCf] = useState({ name: "", limit_amount: "", statement_day: "", due_day: "" });
  const cardNameRef = useRef<HTMLInputElement>(null);
  const cardOk = !!cf.name && +cf.statement_day >= 1 && +cf.statement_day <= 31 && +cf.due_day >= 1 && +cf.due_day <= 31;
  const cardReason = !cf.name ? "Kart adı gerekli" : !(+cf.statement_day >= 1 && +cf.statement_day <= 31) ? "Kesim günü 1-31 arası olmalı" : !(+cf.due_day >= 1 && +cf.due_day <= 31) ? "Son ödeme günü 1-31 arası olmalı" : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const infos = cardInfos(data.cards, data.card_txs, today);
  const totalDebt = infos.reduce((s, c) => s + c.debt, 0);

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Kredi Kartları</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {totalDebt > 0 && (
            <div style={{ fontSize: 12, color: T.mut }}>toplam kart borcu <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></div>
          )}
          {data.cards.length > 0 && (
            <button style={{ ...css.ghost, padding: "6px 12px", fontSize: 12.5, color: T.acc, borderColor: T.acc }} onClick={() => onAdd("cardtx")}>+ Harcama</button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.mut, margin: "4px 0 8px" }}>
        Harcamalar kesim gününe göre ekstreye dağılır; her ekstre son ödeme tarihinde nakit akışına gider olarak düşer. Geçmiş vadeli ekstreler ödendi varsayılır.
      </div>
      {infos.length === 0 && <Empty>Henüz kart yok. Aşağıdan ekleyin.</Empty>}
      {infos.map((ci, i) => {
        const usage = ci.card.limit_amount > 0 ? Math.min(1, ci.debt / ci.card.limit_amount) : 0;
        return (
          <div key={ci.card.id} style={{ padding: "12px 0", borderBottom: i < infos.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{ci.card.name}</span>
                <span style={{ fontSize: 11, color: T.mut, marginLeft: 8 }}>kesim {ci.card.statement_day} · son ödeme {ci.card.due_day}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ ...css.mono, fontSize: 14, color: ci.debt > 0 ? T.neg : T.mut }}>{tl.format(Math.round(ci.debt))}</span>
                <button style={css.del} onClick={async () => { await api.del("cards", ci.card.id); reload(); }}>✕</button>
              </div>
            </div>
            {ci.card.limit_amount > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 6, background: T.panel2, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${usage * 100}%`, height: "100%", background: usage > 0.8 ? T.neg : usage > 0.5 ? T.acc : T.pos }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.mut, marginTop: 4 }}>
                  <span>kullanılabilir <span style={css.mono}>{tl.format(Math.round(ci.card.limit_amount - ci.debt))}</span></span>
                  <span>limit <span style={css.mono}>{tl.format(ci.card.limit_amount)}</span></span>
                </div>
              </div>
            )}
            {ci.statements.slice(0, 3).map((s, j) => (
              <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: j === 0 ? 8 : 4 }}>
                <span style={{ color: T.mut }}>
                  {j === 0 ? "sıradaki ekstre" : "sonraki"} · <span style={css.mono}>{fmtD(s.due, { day: "2-digit", month: "short" })}</span>
                </span>
                <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(s.amount))}</span>
              </div>
            ))}
          </div>
        );
      })}
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!cardOk) return;
        await api.post("cards", { name: cf.name, limit_amount: num(cf.limit_amount), statement_day: +cf.statement_day, due_day: +cf.due_day });
        setCf({ name: "", limit_amount: "", statement_day: "", due_day: "" }); cardNameRef.current?.focus(); reload();
      }}>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Field label="Kart adı" flex={2}><input ref={cardNameRef} style={css.input} value={cf.name} placeholder="örn. Yapı Kredi" onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
          <AmountField label="Limit (₺)" value={cf.limit_amount} onChange={(v) => setCf({ ...cf, limit_amount: v })} />
          <Field label="Kesim günü"><input style={css.input} inputMode="numeric" placeholder="1-31" value={cf.statement_day} onChange={(e) => setCf({ ...cf, statement_day: e.target.value })} /></Field>
          <Field label="Son ödeme günü"><input style={css.input} inputMode="numeric" placeholder="1-31" value={cf.due_day} onChange={(e) => setCf({ ...cf, due_day: e.target.value })} /></Field>
        </div>
        <button type="submit" style={{ ...css.btn, marginTop: 10, opacity: cardOk ? 1 : 0.4 }} disabled={!cardOk}>Kart Ekle</button>
        {cardReason && <Hint>{cardReason}</Hint>}
      </form>
    </div>

    {data.card_txs.length > 0 && (
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Kart Harcamaları</div>
        {[...data.card_txs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((t, i, arr) => {
          const card = data.cards.find((c) => c.id === t.card_id);
          const shares = card ? txShares(t, card) : [];
          const remaining = shares.filter((s) => s.due >= today);
          return (
            <Row key={t.id} last={i === arr.length - 1}>
              <span style={{ ...css.mono, fontSize: 12, color: T.mut, width: 74 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short", year: "2-digit" })}</span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {t.name} <span style={{ color: T.mut, fontSize: 11 }}>{card?.name}</span>
                {t.installments > 1 && (
                  <span style={{ fontSize: 11, color: T.acc, marginLeft: 6 }}>
                    {t.installments - remaining.length}/{t.installments} ödendi
                  </span>
                )}
              </span>
              <span style={{ ...css.mono, fontSize: 13 }}>{tl.format(Math.round(t.amount))}</span>
              <button style={css.del} onClick={async () => { await api.del("cardtxs", t.id); reload(); }}>✕</button>
            </Row>
          );
        })}
      </div>
    )}
  </>);
}
