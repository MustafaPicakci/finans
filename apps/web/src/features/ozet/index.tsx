import React, { useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { fmtD, parseD, num, convert, portfolioValueHistory, type AllData, type Day, type Position, type Rates } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, TYPE_COLORS } from "../../theme";
import { Field, AmountField, Money, Empty, Row } from "../../ui";

/* Özet grafikleri TRY canonical'dır (nakit projeksiyonu + portföy değeri geçmişi hep TRY).
   Görüntü para birimi çevrimi üstteki hero/KPI'da (App.tsx); pozisyon değerleri burada TRY'ye çevrilir. */
export function Ozet({ data, days, pos, cash, rates, reload, user, onAccountDeleted }: {
  data: AllData; days: Day[]; pos: Position[]; cash: number; rates: Rates; reload: () => void;
  user: { email: string }; onAccountDeleted: () => void;
}) {
  const minDay = days.reduce((m, d) => (d.bal < m.bal ? d : m), days[0] ?? { bal: 0, date: new Date() } as Day);
  const negDays = days.filter((d) => d.bal < 0).length;
  const chart = days
    .filter((_, i) => i % Math.max(1, Math.floor(days.length / 240)) === 0)
    .map((d) => ({ x: fmtD(d.date, { day: "numeric", month: "short" }), bal: Math.round(d.bal) }));
  const upcoming = days.filter((d) => d.ev.length).slice(0, 20)
    .flatMap((d) => d.ev.map((e) => ({ ...e, date: d.date }))).slice(0, 6);
  const alloc = [
    { name: "Nakit", value: Math.max(0, cash) },
    ...Object.entries(pos.reduce((m, p) => {
      if (p.value) m[p.type] = (m[p.type] || 0) + convert(p.value, p.currency, "TRY", rates); return m;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
  ].filter((a) => a.value > 0);
  const valueHistory = portfolioValueHistory(data.trades, data.price_history, rates)
    .map((v) => ({ x: fmtD(parseD(v.date), { day: "numeric", month: "short" }), value: Math.round(v.value) }));

  return (<>
    <div style={{ ...css.card, paddingBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Nakit Haritası</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {days.length > 0 && (
            <div style={{
              background: minDay.bal < 0 ? T.negSoft : T.panel2, border: `1px solid ${minDay.bal < 0 ? T.neg : T.line}`,
              borderRadius: 20, padding: "4px 12px", fontSize: 12, ...css.mono,
            }}>
              en düşük: {fmtD(minDay.date, { day: "numeric", month: "short" })} ·{" "}
              <span style={{ color: minDay.bal < 0 ? T.neg : T.pos }}>{tl.format(Math.round(minDay.bal))}</span>
            </div>
          )}
          <select style={{ ...css.input, width: 90, padding: "5px 8px", fontSize: 12 }} value={data.settings.horizon || "6"}
            onChange={async (e) => { await api.put("settings", { horizon: e.target.value }); reload(); }}>
            {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} ay</option>)}
          </select>
        </div>
      </div>
      {negDays > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.warn, background: T.warnSoft, borderRadius: 10, padding: "8px 12px", fontSize: 13, marginTop: 10, fontWeight: 500 }}>
          ⚠ {negDays} gün eksi bakiyede görünüyorsunuz.
        </div>
      )}
      <div style={{ height: 220, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.acc} stopOpacity={0.45} />
                <stop offset="100%" stopColor={T.acc} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
            <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
              labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Bakiye"]} />
            <ReferenceLine y={0} stroke={T.neg} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="bal" stroke={T.acc} strokeWidth={2} fill="url(#g)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Varlık Dağılımı</div>
        {alloc.length === 0 ? <Empty>Hesap bakiyesi veya işlem ekleyin.</Empty> : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 130, height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={alloc} dataKey="value" innerRadius={38} outerRadius={60} strokeWidth={0}>
                    {alloc.map((a) => <Cell key={a.name} fill={TYPE_COLORS[a.name] || T.mut} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: "grid", gap: 4 }}>
              {alloc.map((a) => (
                <div key={a.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span><span style={{ color: TYPE_COLORS[a.name] || T.mut }}>●</span> {a.name}</span>
                  <span style={css.mono}>{tl.format(Math.round(a.value))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Yaklaşan Hareketler</div>
        {upcoming.length === 0 ? <Empty>Plan sekmesinden gelir/gider ekleyin.</Empty> : upcoming.map((e, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < upcoming.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ ...css.mono, color: T.mut, marginRight: 8 }}>{fmtD(e.date, { day: "2-digit", month: "short" })}</span>{e.n}
            </div>
            <Money v={e.a} sign />
          </div>
        ))}
      </div>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Portföy Değeri Geçmişi</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        Fiyat yenilendikçe (otomatik veya elle) o günün kaydı tutulur. Nakit geçmişi tutulmadığından bu net varlık değil, yalnızca portföy değeridir.
      </div>
      {valueHistory.length < 2 ? (
        <Empty>Yeterli fiyat geçmişi birikince burada bir grafik görünecek — fiyatları birkaç gün yeniledikçe dolar.</Empty>
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={valueHistory} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.pos} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={T.pos} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
              <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
                labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Portföy Değeri"]} />
              <Area type="monotone" dataKey="value" stroke={T.pos} strokeWidth={2} fill="url(#gv)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>

    <Hesaplar data={data} reload={reload} />
    <HesapKvkk user={user} onDeleted={onAccountDeleted} />
  </>);
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

/* ————— HESAPLAR (nakit) — tanım + bakiye güncelleme ————— */
/* Bakiyeler elle güncellenir; toplamı projeksiyonun başlangıç noktasıdır. */
function Hesaplar({ data, reload }: { data: AllData; reload: () => void }) {
  const [acc, setAcc] = useState({ name: "", balance: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesaplar (Nakit)</div>
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
