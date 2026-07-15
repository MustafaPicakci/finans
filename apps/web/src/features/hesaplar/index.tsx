import React, { useRef, useState } from "react";
import {
  fmtD, num, todayStr,
  depositMaturity, depositValueOn, depositMaturityValue, depositNetInterest, depositAccruedInterest, depositDaysRemaining, depositMatured,
  type AllData,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Empty, Row } from "../../ui";

/* ————— HESAPLAR EKRANI —————
   Banka varlıklarının tek yönetim yeri: vadesiz (nakit) hesaplar + vadeli mevduat.
   Kavramsal olarak ikisi de "hesap"tır; ayrı bölümlerde durur çünkü vadeli mevduatın
   vade/faiz/stopaj mekaniği farklıdır. En altta hesap & veri (KVKK) ayarları. */
export function Hesaplar({ data, reload, user, onAccountDeleted }: {
  data: AllData; reload: () => void; user: { email: string }; onAccountDeleted: () => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cash = data.accounts.reduce((s, a) => s + a.balance, 0);
  const depositsValue = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  const total = cash + depositsValue;

  return (<>
    <div style={css.card}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.mut }}>Toplam Banka Varlığı</div>
      <div style={{ ...css.mono, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{tl.format(Math.round(total))}</div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.mut }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: "var(--type-nakit)", display: "inline-block", marginRight: 6 }} />
          nakit <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(cash))}</span>
        </span>
        {depositsValue > 0 && (
          <span style={{ fontSize: 13, color: T.mut }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: "var(--cat-5)", display: "inline-block", marginRight: 6 }} />
            vadeli <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(depositsValue))}</span>
          </span>
        )}
      </div>
    </div>

    <VadesizHesaplar data={data} reload={reload} />
    <VadeliMevduat data={data} reload={reload} />
    <HesapKvkk user={user} onDeleted={onAccountDeleted} />
  </>);
}

/* ————— VADESİZ (nakit) hesaplar — tanım + bakiye güncelleme ————— */
/* Bakiyeler elle güncellenir; toplamı projeksiyonun başlangıç noktasıdır. */
function VadesizHesaplar({ data, reload }: { data: AllData; reload: () => void }) {
  const [acc, setAcc] = useState({ name: "", balance: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Vadesiz Hesaplar (Nakit)</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Banka, cüzdan… Bakiyeye tıklayıp güncelleyebilirsin; toplamı nakit projeksiyonunun başlangıcıdır.</div>
      {data.accounts.length === 0 && <Empty>Henüz hesap yok.</Empty>}
      {data.accounts.map((a, i) => (
        <Row key={a.id} last={i === data.accounts.length - 1}>
          <div style={{ flex: 1, fontSize: 14 }}>{a.name}</div>
          <input style={{ ...css.input, width: 130, textAlign: "right" }} inputMode="decimal" defaultValue={a.balance}
            onBlur={async (e) => { const v = num(e.target.value); if (v !== a.balance) { await api.put(`accounts/${a.id}`, { balance: v }); reload(); } }} />
          <button style={css.del} onClick={async () => { await api.del("accounts", a.id); reload(); }}>✕</button>
        </Row>
      ))}
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!acc.name) return;
        await api.post("accounts", { name: acc.name, balance: num(acc.balance) });
        setAcc({ name: "", balance: "" }); nameRef.current?.focus(); reload();
      }}>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Hesap adı" flex={2}><input ref={nameRef} style={css.input} value={acc.name} placeholder="örn. Vakıfbank" onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
          <AmountField label="Bakiye (₺)" value={acc.balance} onChange={(v) => setAcc({ ...acc, balance: v })} />
          <button type="submit" style={{ ...css.btn, opacity: acc.name ? 1 : 0.4 }} disabled={!acc.name}>Hesap Ekle</button>
        </div>
      </form>
    </div>
  );
}

/* ————— VADELİ MEVDUAT — liste + vade kapatma ————— */
/* Ekleme global "+ Ekle"den; burada listeleme/silme + vade dolunca "Hesaba geçir".
   Değer net varlığa engine'de accrue eder (kilitli varlık); silme bağlı hesaba anaparayı iade eder. */
function VadeliMevduat({ data, reload }: { data: AllData; reload: () => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* vade kapatma: bağlı hesaba net faizi gelir olarak işle, sonra mevduatı sil (anapara iadesi) → hesap += vade değeri, Rapor'a faiz girer */
  const close = async (d: AllData["deposits"][number]) => {
    if (d.account_id) {
      const net = depositNetInterest(d);
      if (net !== 0) await api.post("transactions", { name: `${d.name} — vade faizi`, date: todayStr(), amount: net, account_id: d.account_id, category_id: null });
    }
    await api.del("deposits", d.id);
    reload();
  };
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Vadeli Mevduat</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Anapara + faiz vade sonuna kadar net varlığa işleyerek girer; para vade sonuna dek kilitli sayılır (harcanabilir nakde girmez). "+ Ekle" → Vadeli mevduat ile açabilirsin.</div>
      {data.deposits.length === 0 && <Empty>Vadeli mevduatın yok.</Empty>}
      {data.deposits.map((d, i) => {
        const mat = depositMaturity(d);
        const matured = depositMatured(d, today);
        const daysLeft = depositDaysRemaining(d, today);
        const nowVal = depositValueOn(d, today);
        const accInt = depositAccruedInterest(d, today);
        const acc = d.account_id ? data.accounts.find((a) => a.id === d.account_id) : null;
        return (
          <Row key={d.id} last={i === data.deposits.length - 1}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>
                {d.name}{" "}
                {matured
                  ? <span style={{ fontSize: 11, color: T.pos }}>· vadesi doldu</span>
                  : <span style={{ fontSize: 11, color: T.mut }}>· {daysLeft} gün kaldı</span>}
              </div>
              <div style={{ fontSize: 11, color: T.mut }}>
                <span style={css.mono}>{tl.format(Math.round(d.principal))}</span> anapara · %{d.rate}/yıl · {d.term_days} gün · vade{" "}
                <span style={css.mono}>{fmtD(mat, { day: "2-digit", month: "short", year: "numeric" })}</span>
                {acc && <> · <span style={{ color: T.mut3 }}>{acc.name}</span></>}
              </div>
              <div style={{ fontSize: 11, color: T.mut }}>
                birikmiş faiz <span style={{ ...css.mono, color: T.pos }}>{tl.format(Math.round(accInt))}</span> · vade değeri{" "}
                <span style={css.mono}>{tl.format(Math.round(depositMaturityValue(d)))}</span>
              </div>
            </div>
            <span style={{ ...css.mono, color: T.acc, fontSize: 14 }}>{tl.format(Math.round(nowVal))}</span>
            {matured && d.account_id != null && (
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, color: T.pos, borderColor: T.pos }}
                title="Net faizi hesaba gelir olarak işle, anaparayı iade et ve mevduatı kapat"
                onClick={() => close(d)}>Hesaba geçir</button>
            )}
            <button style={css.del} title={d.account_id != null ? "Sil (anapara bağlı hesaba iade edilir)" : "Sil"}
              onClick={async () => { await api.del("deposits", d.id); reload(); }}>✕</button>
          </Row>
        );
      })}
    </div>
  );
}

/* ————— HESAP & VERİ (KVKK: dışa aktarım + hesap silme) ————— */
function HesapKvkk({ user, onDeleted }: { user: { email: string }; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const download = async () => {
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { setErr("Dışa aktarılamadı"); }
  };
  const remove = async () => {
    setErr(""); setBusy(true);
    try { await api.deleteAccount(pw); onDeleted(); }
    catch { setErr("Parola hatalı"); setBusy(false); }
  };

  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesap & Veri</div>
      <div style={{ fontSize: 13, color: T.mut, marginBottom: 12 }}>{user.email}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={css.ghost} onClick={download}>Verilerini indir (JSON)</button>
        {!confirm && <button style={{ ...css.ghost, color: T.neg, borderColor: T.neg }} onClick={() => setConfirm(true)}>Hesabı sil</button>}
      </div>
      {confirm && (
        <div style={{ marginTop: 12, padding: 12, border: `1px solid ${T.neg}`, borderRadius: 12, background: T.negSoft }}>
          <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
            <b>Hesabın ve tüm verilerin kalıcı olarak silinir.</b> Onaylamak için parolanı gir.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...css.input, width: 200 }} type="password" placeholder="parola" value={pw}
              onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            <button style={{ ...css.btn, background: T.neg }} disabled={busy || !pw} onClick={remove}>{busy ? "…" : "Kalıcı olarak sil"}</button>
            <button style={css.ghost} onClick={() => { setConfirm(false); setPw(""); setErr(""); }}>Vazgeç</button>
          </div>
          {err && <div style={{ fontSize: 13, color: T.neg, marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
