import React, { useState } from "react";
import { todayStr, parseD, fmtD, num, ymOf, normYm, type AllData, type Recurring } from "@finans/engine";
import { api } from "../../api";
import { T, css } from "../../theme";
import { Field, Money, Empty, Row } from "../../ui";

/* ————— BÜTÇE (hesaplar + gelir/gider + tek seferlik) ————— */
export function Butce({ data, reload }: { data: AllData; reload: () => void }) {
  const [acc, setAcc] = useState({ name: "", balance: "" });
  const [rec, setRec] = useState({ kind: "income" as Recurring["kind"], name: "", amount: "", day: "", from_month: "", to_month: "" });
  const [changing, setChanging] = useState<Recurring | null>(null);
  const [chVal, setChVal] = useState({ amount: "", from_month: "" });
  const [one, setOne] = useState({ name: "", amount: "", date: todayStr(), type: "gider" });
  const recOk = rec.name && num(rec.amount) > 0 && +rec.day >= 1 && +rec.day <= 31;
  const oneOk = one.name && num(one.amount) > 0 && one.date;
  const curYm = ymOf(new Date());
  const prevYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return ymOf(d);
  };
  const fmtYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
  };
  const chYm = normYm(chVal.from_month || curYm);
  /* "Değiştir": eski kaydı yeni tutarın geçerli olacağı aydan bir önceki ayda bitir, yeni değerle yeni kayıt aç */
  const applyChange = async (r: Recurring) => {
    if (!chYm) return; // geçersiz ay: buton zaten kapalı
    await api.put(`recurring/${r.id}`, { to_month: prevYm(chYm) });
    await api.post("recurring", {
      kind: r.kind, name: r.name, amount: num(chVal.amount), day: r.day,
      from_month: chYm, to_month: null,
    });
    setChanging(null); setChVal({ amount: "", from_month: "" }); reload();
  };

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesaplar (Nakit)</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Banka, cüzdan… Bakiyeye tıklayıp güncelleyebilirsin; toplamı projeksiyonun başlangıcıdır.</div>
      {data.accounts.length === 0 && <Empty>Henüz hesap yok.</Empty>}
      {data.accounts.map((a, i) => (
        <Row key={a.id} last={i === data.accounts.length - 1}>
          <div style={{ flex: 1, fontSize: 14 }}>{a.name}</div>
          <input style={{ ...css.input, width: 130, textAlign: "right" }} inputMode="decimal" defaultValue={a.balance}
            onBlur={async (e) => { const v = num(e.target.value); if (v !== a.balance) { await api.put(`accounts/${a.id}`, { balance: v }); reload(); } }} />
          <button style={css.del} onClick={async () => { await api.del("accounts", a.id); reload(); }}>✕</button>
        </Row>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Hesap adı" flex={2}><input style={css.input} value={acc.name} placeholder="örn. Vakıfbank" onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
        <Field label="Bakiye (₺)"><input style={css.input} inputMode="decimal" value={acc.balance} onChange={(e) => setAcc({ ...acc, balance: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: acc.name ? 1 : 0.4 }} disabled={!acc.name}
        onClick={async () => { await api.post("accounts", { name: acc.name, balance: num(acc.balance) }); setAcc({ name: "", balance: "" }); reload(); }}>
        Hesap Ekle
      </button>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Düzenli Gelir & Giderler</div>
      {data.recurring.length === 0 && <Empty>Maaş, kira, faturalar… her ay tekrarlayan kalemler.</Empty>}
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
              <div style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  Yeni tutar girilen aydan itibaren geçerli olur; eski tutar bir önceki aya kadar geçmiş projeksiyonda korunur.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field label="Yeni tutar (₺)"><input style={css.input} inputMode="decimal" value={chVal.amount} onChange={(e) => setChVal({ ...chVal, amount: e.target.value })} /></Field>
                  <Field label="Geçerli ay (YYYY-AA)"><input style={css.input} placeholder={curYm} value={chVal.from_month} onChange={(e) => setChVal({ ...chVal, from_month: e.target.value })} /></Field>
                  <button style={{ ...css.btn, opacity: num(chVal.amount) > 0 && chYm ? 1 : 0.4 }} disabled={!(num(chVal.amount) > 0 && chYm)} onClick={() => applyChange(r)}>Uygula</button>
                </div>
                {chVal.from_month && !chYm && <div style={{ fontSize: 11, color: T.neg, marginTop: 6 }}>Ay biçimi YYYY-AA olmalı, örn. {curYm}</div>}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Tür">
          <select style={css.input} value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as Recurring["kind"] })}>
            <option value="income">Gelir</option><option value="expense">Gider</option>
          </select>
        </Field>
        <Field label="Ad" flex={2}><input style={css.input} value={rec.name} placeholder="örn. Maaş" onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
        <Field label="Tutar (₺)"><input style={css.input} inputMode="decimal" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></Field>
        <Field label="Gün (1-31)"><input style={css.input} inputMode="numeric" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="Başlangıç ayı (ops.)"><input style={css.input} placeholder="YYYY-AA, boş=baştan" value={rec.from_month} onChange={(e) => setRec({ ...rec, from_month: e.target.value })} /></Field>
        <Field label="Bitiş ayı (ops.)"><input style={css.input} placeholder="YYYY-AA, boş=süresiz" value={rec.to_month} onChange={(e) => setRec({ ...rec, to_month: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: recOk ? 1 : 0.4 }} disabled={!recOk}
        onClick={async () => {
          await api.post("recurring", {
            kind: rec.kind, name: rec.name, amount: num(rec.amount), day: +rec.day,
            from_month: rec.from_month.trim() || null, to_month: rec.to_month.trim() || null,
          });
          setRec({ kind: rec.kind, name: "", amount: "", day: "", from_month: "", to_month: "" }); reload();
        }}>Ekle</button>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Tek Seferlik Kalemler</div>
      {data.oneoffs.length === 0 && <Empty>Tatil, prim, vergi iadesi gibi tek seferlik gelir/giderler.</Empty>}
      {data.oneoffs.map((o, i) => (
        <Row key={o.id} last={i === data.oneoffs.length - 1}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14 }}>{o.name}</div>
            <div style={{ fontSize: 11, color: T.mut, ...css.mono }}>{fmtD(parseD(o.date), { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
          <Money v={o.amount} sign />
          <button style={css.del} onClick={async () => { await api.del("oneoffs", o.id); reload(); }}>✕</button>
        </Row>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={one.name} placeholder="örn. Tatil" onChange={(e) => setOne({ ...one, name: e.target.value })} /></Field>
        <Field label="Tutar (₺)"><input style={css.input} inputMode="decimal" value={one.amount} onChange={(e) => setOne({ ...one, amount: e.target.value })} /></Field>
        <Field label="Tarih"><input type="date" style={css.input} value={one.date} onChange={(e) => setOne({ ...one, date: e.target.value })} /></Field>
        <Field label="Tür">
          <select style={css.input} value={one.type} onChange={(e) => setOne({ ...one, type: e.target.value })}>
            <option value="gider">Gider (−)</option><option value="gelir">Gelir (+)</option>
          </select>
        </Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: oneOk ? 1 : 0.4 }} disabled={!oneOk}
        onClick={async () => {
          await api.post("oneoffs", { name: one.name, date: one.date, amount: (one.type === "gider" ? -1 : 1) * num(one.amount) });
          setOne({ name: "", amount: "", date: todayStr(), type: "gider" }); reload();
        }}>Ekle</button>
    </div>
  </>);
}
