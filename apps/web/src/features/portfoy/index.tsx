import React, { useState } from "react";
import { todayStr, parseD, fmtD, num, type AllData, type AssetType, type Trade, type Position } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, tl2, TYPE_COLORS, TYPE_HINT } from "../../theme";
import { Field, Money, Empty, Row } from "../../ui";

/* ————— PORTFÖY ————— */
export function Portfoy({ data, pos, reload }: { data: AllData; pos: Position[]; reload: () => void }) {
  const [f, setF] = useState({
    date: todayStr(), asset_type: "BIST" as AssetType, symbol: "", side: "ALIŞ" as Trade["side"],
    qty: "", price: "", fee: "",
  });
  const [busy, setBusy] = useState(false);
  const ok = f.symbol && num(f.qty) > 0 && num(f.price) > 0 && f.date;
  const totUnreal = pos.reduce((s, p) => s + (p.unreal ?? 0), 0);
  const totReal = pos.reduce((s, p) => s + p.realized, 0);
  const lastUpdate = data.prices.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "");

  const refresh = async () => {
    setBusy(true);
    try { await api.refreshPrices(); await reload(); } finally { setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Yeni İşlem</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tarih"><input type="date" style={css.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Varlık türü">
          <select style={css.input} value={f.asset_type} onChange={(e) => setF({ ...f, asset_type: e.target.value as AssetType, symbol: "" })}>
            {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO"] as AssetType[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Sembol">
          <input style={{ ...css.input, textTransform: "uppercase" }} placeholder={TYPE_HINT[f.asset_type]}
            value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="İşlem">
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
            {(["ALIŞ", "SATIŞ"] as const).map((s) => (
              <button key={s} onClick={() => setF({ ...f, side: s })} style={{
                flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: T.disp,
                background: f.side === s ? (s === "ALIŞ" ? T.pos : T.neg) : T.panel2,
                color: f.side === s ? "#0D1322" : T.mut,
              }}>{s}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="Adet / Miktar"><input style={css.input} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Birim fiyat (₺)"><input style={css.input} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Komisyon (₺)"><input style={css.input} inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
      </div>
      {ok && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          İşlem tutarı: <span style={{ ...css.mono, color: T.text }}>{tl2.format(num(f.qty) * num(f.price))}</span>
        </div>
      )}
      <button style={{ ...css.btn, marginTop: 10, opacity: ok ? 1 : 0.4 }} disabled={!ok}
        onClick={async () => {
          await api.post("trades", { ...f, symbol: f.symbol.trim(), qty: num(f.qty), price: num(f.price), fee: num(f.fee) });
          setF({ ...f, qty: "", price: "", fee: "" }); reload();
        }}>İşlemi Kaydet</button>
    </div>

    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Pozisyonlar</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.mut }}>
          <span>gerç. K/Z <Money v={Math.round(totReal)} sign size={12} /></span>
          <span>açık K/Z <Money v={Math.round(totUnreal)} sign size={12} /></span>
          <button style={css.ghost} onClick={refresh} disabled={busy}>{busy ? "Yenileniyor…" : "Fiyatları Yenile"}</button>
        </div>
      </div>
      {lastUpdate && <div style={{ fontSize: 11, color: T.mut, marginBottom: 6 }}>son güncelleme: {lastUpdate}</div>}
      <div style={{ fontSize: 11, color: T.mut, marginBottom: 8, lineHeight: 1.5 }}>
        Her satırdaki kutu o varlığın <b>güncel birim fiyatıdır</b> — pozisyon değeri, açık K/Z ve net varlık bununla hesaplanır.
        Fonlar (TEFAS) otomatik çekilemiyor; onları elle yaz. Elle girdiğin fiyat <b>oto</b> tazelemede değişmez;
        otomatik fiyata dönmek için <b>sıfırla</b>’ya bas.
      </div>
      {pos.length === 0 && <Empty>Henüz işlem yok. İlk alışınızı yukarıdan kaydedin.</Empty>}
      {pos.map((p) => (
        <div key={`${p.type}:${p.sym}`} style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, marginRight: 8, background: T.panel2, color: TYPE_COLORS[p.type] || T.mut }}>{p.type}</span>
              <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, color: T.acc }}>{p.sym}</span>
              <span style={{ fontSize: 12, color: T.mut, marginLeft: 8 }}>{p.qty} adet · ort. <span style={css.mono}>{tl2.format(p.avg)}</span></span>
            </div>
            {p.value != null && <span style={{ ...css.mono, fontSize: 14 }}>{tl.format(Math.round(p.value))}</span>}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input key={`${p.sym}-${p.cur}`} style={{ ...css.input, width: 120, padding: "6px 8px", fontSize: 13 }} inputMode="decimal"
              placeholder="güncel fiyat ₺" defaultValue={p.cur ?? ""}
              onBlur={async (e) => {
                const v = num(e.target.value);
                if (v > 0 && v !== p.cur) { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: v }); reload(); }
              }} />
            {p.source === "manual" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: T.panel2, color: T.acc }}>elle</span>
            )}
            {p.source === "auto" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: T.panel2, color: T.mut }}>oto</span>
            )}
            {p.cur == null && (
              <span style={{ fontSize: 11, color: T.neg }}>fiyat yok — elle gir</span>
            )}
            {p.cur != null && (
              <button style={{ ...css.del, fontSize: 12 }} title="fiyatı sil, otomatiğe dön"
                onClick={async () => { await api.delPrice(p.type, p.sym); reload(); }}>sıfırla</button>
            )}
            {p.unreal != null && <span style={{ fontSize: 12, color: T.mut }}>açık K/Z: <Money v={Math.round(p.unreal)} sign size={12} /></span>}
            {p.realized !== 0 && <span style={{ fontSize: 12, color: T.mut }}>gerçekleşen: <Money v={Math.round(p.realized)} sign size={12} /></span>}
          </div>
        </div>
      ))}
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>İşlem Geçmişi</div>
      {data.trades.length === 0 && <Empty>Kayıtlı işlem yok.</Empty>}
      {[...data.trades].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((t, i, arr) => (
        <Row key={t.id} last={i === arr.length - 1}>
          <span style={{ ...css.mono, fontSize: 12, color: T.mut, width: 74 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short", year: "2-digit" })}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
            background: t.side === "ALIŞ" ? "#12312A" : "#3A1712", color: t.side === "ALIŞ" ? T.pos : T.neg,
          }}>{t.side}</span>
          <span style={{ flex: 1, fontSize: 13 }}>
            <b style={css.mono}>{t.symbol}</b> <span style={{ color: T.mut, fontSize: 11 }}>{t.asset_type}</span>{" "}
            <span style={{ color: T.mut }}>{t.qty} × {tl2.format(t.price)}</span>
          </span>
          <span style={{ ...css.mono, fontSize: 13 }}>{tl.format(Math.round(t.qty * t.price))}</span>
          <button style={css.del} onClick={async () => { await api.del("trades", t.id); reload(); }}>✕</button>
        </Row>
      ))}
    </div>
  </>);
}
