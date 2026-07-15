import React, { useState } from "react";
import { todayStr, parseD, fmtD, keyOf, num, ymOf, recActiveOn, recOccurrenceDate, recurringAmountIndex, recAmountOn, loanPayDay, loanRemaining, type AllData, type Recurring, type OneOff } from "@finans/engine";
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
  const [realizing, setRealizing] = useState<number | null>(null); // hedefsiz kalem için hesap/kategori seçimi
  const [rp, setRp] = useState({ account_id: "", category_id: "" });
  const curYm = ymOf(new Date());
  const now = new Date();
  const today = todayStr();
  /* gerçekleşmiş (kalem, bu ay) çiftleri — "Gerçekleşti"/"Geri al" durumu için */
  const realizedSet = new Set(data.recurring_realized.map((x) => `${x.recurring_id}:${x.ym}`));
  /* tutar zaman çizelgesi: satırda bu ayın tutarı gösterilir, gelecek değişiklikler ipucu olur */
  const amtIdx = recurringAmountIndex(data.recurring_amounts ?? []);
  const realizeRec = async (r: Recurring, body: { account_id?: number | null; category_id?: number | null } = {}) => {
    await api.realizeRecurring(r.id, curYm, body);
    setRealizing(null); setRp({ account_id: "", category_id: "" }); reload();
  };
  const undoRealize = async (id: number) => { await api.unrealizeRecurring(id, curYm); reload(); };
  const fmtYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
  };
  const chYm = chVal.from_month || curYm;
  const chOk = num(chVal.amount) > 0 && !!chYm;
  /* "Değiştir": kayıt bölünmez — seçilen aydan itibaren geçerli tutar satırı eklenir (atomik, tek istek);
     önceki aylar eski tutarla kalır, aynı aya ikinci yazım düzeltmedir. */
  const applyChange = async (r: Recurring) => {
    if (!chOk) return;
    await api.setRecurringAmount(r.id, { amount: num(chVal.amount), from_month: chYm });
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
        const isCard = r.card_id != null;
        const targetName = r.account_id != null ? data.accounts.find((a) => a.id === r.account_id)?.name
          : isCard ? data.cards.find((c) => c.id === r.card_id)?.name : null;
        const hasTarget = r.account_id != null || isCard;
        const active = recActiveOn(r, now) && !ended;
        const due = keyOf(recOccurrenceDate(r, curYm)) <= today; // bu ayın günü geçti mi
        const realizedNow = realizedSet.has(`${r.id}:${curYm}`);
        const cats = data.categories.filter((c) => c.kind === r.kind);
        const amtRows = amtIdx.get(r.id);
        const amountNow = recAmountOn(amtRows, curYm) ?? 0;
        const futureAmts = (amtRows ?? []).filter((a) => a.from_month > curYm); // planlı tutar değişiklikleri
        return (
          <div key={r.id} style={{ padding: "9px 0", borderBottom: i === data.recurring.length - 1 ? "none" : `1px solid ${T.line}`, opacity: ended ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 14 }}>{r.name} {ended && <span style={{ fontSize: 11, color: T.mut }}>· bitti</span>}</div>
                <div style={{ fontSize: 11, color: T.mut }}>
                  her ayın {r.day}. günü · {period}
                  {targetName && <> · <span style={{ color: T.mut3 }}>→ {targetName}{isCard ? " (kart)" : ""}</span></>}
                  {r.auto && <> · <span style={{ color: T.acc }}>⚡ oto</span></>}
                </div>
                {futureAmts.map((a) => (
                  <div key={a.from_month} style={{ fontSize: 11, color: T.acc, marginTop: 2 }}>
                    ↗ {fmtYm(a.from_month)} itibarıyla {tl.format(r.kind === "income" ? a.amount : -a.amount)}
                    <button style={{ ...css.del, fontSize: 11, marginLeft: 6 }} title="planlı tutar değişikliğini geri al"
                      onClick={async () => { await api.delRecurringAmount(r.id, a.from_month); reload(); }}>✕</button>
                  </div>
                ))}
              </div>
              <Money v={r.kind === "income" ? amountNow : -amountNow} sign />
              {realizedNow
                ? (<>
                    <span style={{ fontSize: 11, color: T.pos, ...css.mono }}>{fmtYm(curYm)} ✓</span>
                    <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12 }} title={`${fmtYm(curYm)} gerçekleşmesini geri al`}
                      onClick={() => undoRealize(r.id)}>Geri al</button>
                  </>)
                : active && due
                  ? <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, color: T.acc, borderColor: T.acc }}
                      title={`${fmtYm(curYm)} ayı için deftere geçir`}
                      onClick={() => (hasTarget ? realizeRec(r) : setRealizing(realizing === r.id ? null : r.id))}>
                      {fmtYm(curYm)} gerçekleşti</button>
                  : null}
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12 }}
                onClick={() => { setChanging(changing?.id === r.id ? null : r); setChVal({ amount: String(amountNow || ""), from_month: curYm }); }}>
                Değiştir
              </button>
              <button style={css.del} onClick={async () => { await api.del("recurring", r.id); reload(); }}>✕</button>
            </div>
            {realizing === r.id && !hasTarget && (
              <form style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}
                onSubmit={(e) => { e.preventDefault(); realizeRec(r, { account_id: rp.account_id ? +rp.account_id : null, category_id: rp.category_id ? +rp.category_id : null }); }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  Bu kalemin <b>{fmtYm(curYm)}</b> ayını deftere geçir. Hesap seçersen bakiyeye işler; boş bırakırsan yalnız Rapor'a girer.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field label="Hesap (ops.)">
                    <select style={css.input} value={rp.account_id} onChange={(e) => setRp({ ...rp, account_id: e.target.value })}>
                      <option value="">— (bakiyeye işleme)</option>
                      {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  {cats.length > 0 && (
                    <Field label="Kategori (ops.)">
                      <select style={css.input} value={rp.category_id} onChange={(e) => setRp({ ...rp, category_id: e.target.value })}>
                        <option value="">Kategorisiz</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  )}
                  <button type="submit" style={css.btn}>Gerçekleştir</button>
                </div>
              </form>
            )}
            {changing?.id === r.id && (
              <form style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}
                onSubmit={(e) => { e.preventDefault(); applyChange(r); }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  Yeni tutar seçilen aydan itibaren geçerli olur; önceki aylar eski tutarla kalır.
                  Kayıt bölünmez — planlı değişikliği üstteki ↗ satırındaki ✕ ile geri alabilirsin.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <AmountField label="Yeni tutar (TL)" value={chVal.amount} onChange={(v) => setChVal({ ...chVal, amount: v })} />
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
