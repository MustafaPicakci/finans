import React, { useState } from "react";
import { parseD, fmtD, num, type AllData, type Position } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, tl2, TYPE_COLORS } from "../../theme";
import { Money, Empty, Row } from "../../ui";
import type { AddKind } from "../forms";

/* ————— PORTFÖY ————— */
/* İşlem (alış/satış) girişi global "+" akışındadır; burada pozisyonlar, fiyatlar ve geçmiş var. */
export function Portfoy({ data, pos, reload, onAdd }: { data: AllData; pos: Position[]; reload: () => void; onAdd: (k: AddKind) => void }) {
  const [busy, setBusy] = useState(false);
  const totUnreal = pos.reduce((s, p) => s + (p.unreal ?? 0), 0);
  const totReal = pos.reduce((s, p) => s + p.realized, 0);
  const lastUpdate = data.prices.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "");

  const refresh = async () => {
    setBusy(true);
    try { await api.refreshPrices(); await reload(); } finally { setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Pozisyonlar</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.mut }}>
          <span>gerç. K/Z <Money v={Math.round(totReal)} sign size={12} /></span>
          <span>açık K/Z <Money v={Math.round(totUnreal)} sign size={12} /></span>
          <button style={css.ghost} onClick={refresh} disabled={busy}>{busy ? "Yenileniyor…" : "Fiyatları Yenile"}</button>
          <button style={{ ...css.ghost, color: T.acc, borderColor: T.acc }} onClick={() => onAdd("trade")}>+ İşlem</button>
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
            background: t.side === "ALIŞ" ? T.posSoft : T.negSoft, color: t.side === "ALIŞ" ? T.pos : T.neg,
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
