import React, { useState } from "react";
import { parseD, fmtD, num, convert, type AllData, type Position, type Rates, type Currency, type AssetType } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_COLORS } from "../../theme";
import { Empty, Row } from "../../ui";
import type { AddKind } from "../forms";

/** İşaretli tutar, verilen para biriminde (Money bileşeni TRY'ye sabit olduğundan native gösterim için) */
const Signed = ({ v, ccy, size = 12 }: { v: number; ccy: Currency; size?: number }) => (
  <span style={{ ...css.mono, fontSize: size, color: v > 0 ? T.pos : v < 0 ? T.neg : T.mut }}>
    {v > 0 ? "+" : ""}{fmtMoney(v, ccy)}
  </span>
);

/* ————— PORTFÖY ————— */
/* İşlem (alış/satış) girişi global "+" akışındadır; burada pozisyonlar, fiyatlar ve geçmiş var.
   Pozisyon satırları kendi doğal (native) para biriminde; başlık toplamları görüntü birimine çevrilir. */

/* Pozisyonlar varlık sınıfına göre gruplanır; sırası burada tanımlıdır */
const POS_GROUPS: { key: string; title: string; types: AssetType[] }[] = [
  { key: "maden", title: "Kıymetli Madenler", types: ["ALTIN"] },
  { key: "bist", title: "BIST Hisse & Fonlar", types: ["BIST", "FON"] },
  { key: "abd", title: "ABD Borsası & ETF", types: ["ETF"] },
  { key: "kripto", title: "Kripto", types: ["KRIPTO"] },
  { key: "doviz", title: "Döviz", types: ["DOVIZ"] },
];
export function Portfoy({ data, pos, rates, ccy, reload, onAdd }: {
  data: AllData; pos: Position[]; rates: Rates; ccy: Currency; reload: () => void; onAdd: (k: AddKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const totUnreal = pos.reduce((s, p) => s + convert(p.unreal ?? 0, p.currency, ccy, rates), 0);
  const totReal = pos.reduce((s, p) => s + convert(p.realized, p.currency, ccy, rates), 0);
  const lastUpdate = data.prices.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "");

  /* Para piyasası (nakit sayılan) fonlar — Nakit Akışı takviminde nakit gibi değerlenir */
  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  const toggleCashFund = async (sym: string) => {
    const next = new Set(cashFunds);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    await api.put("settings", { cash_funds: [...next].join(",") });
    reload();
  };

  const refresh = async () => {
    setBusy(true);
    try { await api.refreshPrices(); await reload(); } finally { setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Pozisyonlar</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.mut }}>
          <span>gerç. K/Z <Signed v={Math.round(totReal)} ccy={ccy} /></span>
          <span>açık K/Z <Signed v={Math.round(totUnreal)} ccy={ccy} /></span>
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
      {POS_GROUPS.map((g) => {
        const items = pos
          .filter((p) => g.types.includes(p.type))
          .sort((a, b) => convert(b.value ?? 0, b.currency, ccy, rates) - convert(a.value ?? 0, a.currency, ccy, rates));
        if (items.length === 0) return null;
        const gValue = items.reduce((s, p) => s + convert(p.value ?? 0, p.currency, ccy, rates), 0);
        const gUnreal = items.reduce((s, p) => s + convert(p.unreal ?? 0, p.currency, ccy, rates), 0);
        const isCollapsed = collapsed.has(g.key);
        const toggle = () => setCollapsed((prev) => {
          const next = new Set(prev);
          next.has(g.key) ? next.delete(g.key) : next.add(g.key);
          return next;
        });
        return (
          <div key={g.key} style={{ marginBottom: isCollapsed ? 4 : 12 }}>
            <div onClick={toggle} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer",
              padding: "8px 10px", borderRadius: 8, background: T.panel2, userSelect: "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: T.mut, width: 10 }}>{isCollapsed ? "▸" : "▾"}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: TYPE_COLORS[g.types[0]] || T.text }}>{g.title}</span>
                <span style={{ fontSize: 11, color: T.mut }}>{items.length} varlık</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: T.mut }}>açık K/Z <Signed v={Math.round(gUnreal)} ccy={ccy} size={11} /></span>
                <span style={{ ...css.mono, fontSize: 13, fontWeight: 600 }}>{fmtMoney(Math.round(gValue), ccy)}</span>
              </div>
            </div>
            {!isCollapsed && items.map((p) => (
            <div key={`${p.type}:${p.sym}`} style={{ padding: "10px 0 10px 10px", borderBottom: `1px solid ${T.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, marginRight: 8, background: T.panel2, color: TYPE_COLORS[p.type] || T.mut }}>{p.type}</span>
                  <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, color: T.acc }}>{p.sym}</span>
                  {p.currency === "USD" && <span style={{ fontSize: 10, fontWeight: 700, color: T.mut3, marginLeft: 6 }}>USD</span>}
                  <span style={{ fontSize: 12, color: T.mut, marginLeft: 8 }}>{p.qty} adet · ort. <span style={css.mono}>{fmtMoney(p.avg, p.currency, true)}</span></span>
                </div>
                {p.value != null && <span style={{ ...css.mono, fontSize: 14 }}>{fmtMoney(Math.round(p.value), p.currency)}</span>}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <input key={`${p.sym}-${p.cur}`} style={{ ...css.input, width: 120, padding: "6px 8px", fontSize: 13 }} inputMode="decimal"
                  placeholder={`güncel fiyat ${p.currency === "USD" ? "$" : "₺"}`} defaultValue={p.cur ?? ""}
                  onBlur={async (e) => {
                    const v = num(e.target.value);
                    if (v > 0 && v !== p.cur) { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: v, currency: p.currency }); reload(); }
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
                {p.type === "FON" && (
                  <button
                    title={cashFunds.has(p.sym) ? "Nakit sayımından çıkar" : "Para piyasası fonu — nakit gibi say (takvimde etkin nakite eklenir)"}
                    onClick={() => toggleCashFund(p.sym)}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, cursor: "pointer",
                      border: `1px solid ${cashFunds.has(p.sym) ? T.pos : T.line}`,
                      background: cashFunds.has(p.sym) ? T.posSoft : "transparent",
                      color: cashFunds.has(p.sym) ? T.pos : T.mut,
                    }}>{cashFunds.has(p.sym) ? "✓ nakit sayılır" : "nakit say"}</button>
                )}
                {p.unreal != null && <span style={{ fontSize: 12, color: T.mut }}>açık K/Z: <Signed v={Math.round(p.unreal)} ccy={p.currency} /></span>}
                {p.realized !== 0 && <span style={{ fontSize: 12, color: T.mut }}>gerçekleşen: <Signed v={Math.round(p.realized)} ccy={p.currency} /></span>}
              </div>
            </div>
            ))}
          </div>
        );
      })}
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
            <span style={{ color: T.mut }}>{t.qty} × {fmtMoney(t.price, t.currency ?? "TRY", true)}</span>
          </span>
          <span style={{ ...css.mono, fontSize: 13 }}>{fmtMoney(Math.round(t.qty * t.price), t.currency ?? "TRY")}</span>
          <button style={css.del} onClick={async () => { await api.del("trades", t.id); reload(); }}>✕</button>
        </Row>
      ))}
    </div>
  </>);
}
