import React, { useRef, useState } from "react";
import { parseD, fmtD, keyOf, num, cardInfos, stmtKey, txShares, type AllData, type Card } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Hint, Empty, Row } from "../../ui";
import type { AddKind } from "../forms";

/* ————— KARTLAR ————— */
/* Kart TANIMI burada yapılır; kart HARCAMASI girişi global "+" akışındadır.
   Ekstre ödeme (Faz 8.2): "Ödedim" ekstreyi gerçek gider kaydına çevirir (hesap seçilirse bakiye düşer,
   Rapor'a girer) ve borç/projeksiyondan düşer; "Geri al" kaydı ve işareti siler. */

/** Son ~40 gün içinde vadesi GEÇMİŞ en yakın ekstre (kayıt altına almak için) — cardInfos yalnız
    bugünden sonrakileri döndürdüğünden geçmişteki son ekstre burada ayrıca hesaplanır. */
function lastPastStatement(card: Card, txs: AllData["card_txs"], today: Date): { due: Date; amount: number } | null {
  const byDue = new Map<string, { due: Date; amount: number }>();
  txs.filter((t) => t.card_id === card.id).forEach((t) => {
    txShares(t, card).forEach((s) => {
      if (s.due < today && today.getTime() - s.due.getTime() <= 40 * 86_400_000) {
        const k = keyOf(s.due);
        if (!byDue.has(k)) byDue.set(k, { due: s.due, amount: 0 });
        byDue.get(k)!.amount += s.amount;
      }
    });
  });
  const list = [...byDue.values()].sort((a, b) => +b.due - +a.due);
  return list[0] ?? null;
}

export function Kartlar({ data, reload, onAdd }: { data: AllData; reload: () => void; onAdd: (k: AddKind) => void }) {
  const [cf, setCf] = useState({ name: "", limit_amount: "", statement_day: "", due_day: "" });
  const cardNameRef = useRef<HTMLInputElement>(null);
  const cardOk = !!cf.name && +cf.statement_day >= 1 && +cf.statement_day <= 31 && +cf.due_day >= 1 && +cf.due_day <= 31;
  const cardReason = !cf.name ? "Kart adı gerekli" : !(+cf.statement_day >= 1 && +cf.statement_day <= 31) ? "Kesim günü 1-31 arası olmalı" : !(+cf.due_day >= 1 && +cf.due_day <= 31) ? "Son ödeme günü 1-31 arası olmalı" : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const paidSet = new Set(data.statement_payments.map((p) => stmtKey(p.card_id, p.due)));
  const infos = cardInfos(data.cards, data.card_txs, today, paidSet);
  const totalDebt = infos.reduce((s, c) => s + c.debt, 0);
  /* ödeme mini-formu: hangi (kart, vade) için açık + hesap/kategori seçimi */
  const [paying, setPaying] = useState<{ cardId: number; dueK: string; amount: number } | null>(null);
  const [pp, setPp] = useState({ account_id: "", category_id: "" });
  const expCats = data.categories.filter((c) => c.kind === "expense");
  const doPay = async () => {
    if (!paying) return;
    await api.payStatement(paying.cardId, paying.dueK, {
      account_id: pp.account_id ? +pp.account_id : null,
      category_id: pp.category_id ? +pp.category_id : null,
    });
    setPaying(null); setPp({ account_id: "", category_id: "" }); reload();
  };
  const unpay = async (cardId: number, dueK: string) => { await api.unpayStatement(cardId, dueK); reload(); };
  /* tek satırlık ekstre görünümü: durum + Ödedim/Geri al */
  const StmtRow = ({ cardId, label, due, amount, paid, first }: { cardId: number; label: string; due: Date; amount: number; paid: boolean; first: boolean }) => {
    const dueK = keyOf(due);
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, marginTop: first ? 8 : 4 }}>
        <span style={{ color: T.mut }}>
          {label} · <span style={css.mono}>{fmtD(due, { day: "2-digit", month: "short" })}</span>
          {paid && <span style={{ color: T.pos }}> · ödendi ✓</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...css.mono, color: paid ? T.mut3 : T.text, textDecoration: paid ? "line-through" : "none" }}>{tl.format(Math.round(amount))}</span>
          {paid
            ? <button style={{ ...css.ghost, padding: "3px 8px", fontSize: 11 }} title="Ödemeyi geri al (gider kaydı silinir, bakiye iade edilir)"
                onClick={() => unpay(cardId, dueK)}>Geri al</button>
            : <button style={{ ...css.ghost, padding: "3px 8px", fontSize: 11, color: T.acc, borderColor: T.acc }}
                onClick={() => { setPaying(paying?.cardId === cardId && paying.dueK === dueK ? null : { cardId, dueK, amount }); setPp({ account_id: "", category_id: "" }); }}>Ödedim</button>}
        </span>
      </div>
    );
  };

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
            {/* otomatik ödeme talimatı: hesap seçiliyse vadesi gelen ekstre cron ile o hesaptan ödenir */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: T.mut }}>
              <span title="Vade günü geldiğinde ekstre seçili hesaptan kendiliğinden ödenir (bakiye düşer, Rapor'a girer)">
                {ci.card.pay_account_id ? <span style={{ color: T.acc }}>⚡</span> : null} otomatik ödeme:
              </span>
              <select style={{ ...css.input, width: "auto", padding: "4px 8px", fontSize: 12 }} value={ci.card.pay_account_id ?? ""}
                onChange={async (e) => { await api.put(`cards/${ci.card.id}`, { pay_account_id: e.target.value ? +e.target.value : null }); reload(); }}>
                <option value="">talimat yok (elle)</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {(() => {
              const past = lastPastStatement(ci.card, data.card_txs, today);
              const pastPaid = past ? paidSet.has(stmtKey(ci.card.id, keyOf(past.due))) : false;
              return (<>
                {past && (
                  <StmtRow cardId={ci.card.id} label="geçen ekstre" due={past.due} amount={past.amount} paid={pastPaid} first />
                )}
                {ci.statements.slice(0, 3).map((s, j) => (
                  <StmtRow key={j} cardId={ci.card.id} label={j === 0 ? "sıradaki ekstre" : "sonraki"}
                    due={s.due} amount={s.amount} paid={s.paid} first={j === 0 && !past} />
                ))}
              </>);
            })()}
            {paying?.cardId === ci.card.id && (
              <form style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}
                onSubmit={(e) => { e.preventDefault(); doPay(); }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  <span style={css.mono}>{fmtD(parseD(paying.dueK), { day: "2-digit", month: "short" })}</span> ekstresi
                  (<span style={css.mono}>{tl.format(Math.round(paying.amount))}</span>) gider olarak deftere geçirilir.
                  Hesap seçersen bakiyeden düşer; boş bırakırsan yalnız Rapor'a girer.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field label="Hesap (ops.)">
                    <select style={css.input} value={pp.account_id} onChange={(e) => setPp({ ...pp, account_id: e.target.value })}>
                      <option value="">— (bakiyeye işleme)</option>
                      {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  {expCats.length > 0 && (
                    <Field label="Kategori (ops.)">
                      <select style={css.input} value={pp.category_id} onChange={(e) => setPp({ ...pp, category_id: e.target.value })}>
                        <option value="">Kategorisiz</option>
                        {expCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  )}
                  <button type="submit" style={css.btn}>Ödendi olarak kaydet</button>
                  <button type="button" style={css.ghost} onClick={() => setPaying(null)}>Vazgeç</button>
                </div>
              </form>
            )}
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
