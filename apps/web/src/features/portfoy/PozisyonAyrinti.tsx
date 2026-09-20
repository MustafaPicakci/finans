import React from "react";
import { num, type Position } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";

/* ————— POZİSYON SATIRININ AÇILAN AYRINTISI —————
   Faz 31'de fiyat giriş kutusu + "oto" rozeti + "sıfırla" varlık listesinin GÖRÜNEN
   satırından çıkarıldı (liste bir ayar ekranına benziyordu) ve satıra dokununca açılan bu
   alana taşındı. Faz 32'de detay ekranı tabloya dönünce aynı alan İKİ yerde gerekti —
   liste kartında ve tabloda. Tek bileşen: iki kopya olsaydı biri (ör. "nakit say") yalnız
   bir ekranda güncellenir, diğeri sessizce eskirdi. */

export function PozisyonAyrinti({ p, reload, nakitSayilir, onNakitSay, onSymbol, solBosluk = 0 }: {
  p: Position;
  reload: () => void;
  nakitSayilir: boolean;
  onNakitSay: () => void;
  /** verilirse "hareketlerini gör" düğmesi çıkar (detay ekranında listeyi süzer) */
  onSymbol?: (s: string) => void;
  solBosluk?: number;
}) {
  return (
    <div style={{ padding: `2px 2px 14px ${solBosluk}px`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: T.mut3 }}>
        <span>ort. maliyet <span style={{ ...css.mono, color: T.mut }}>{fmtMoney(p.avg, p.currency, true)}</span></span>
        {p.cur != null && <span>güncel <span style={{ ...css.mono, color: T.mut }}>{fmtMoney(p.cur, p.currency, true)}</span></span>}
        {p.realized !== 0 && (
          <span>gerçekleşen{" "}
            <span style={{ ...css.mono, color: p.realized > 0 ? T.pos : p.realized < 0 ? T.neg : T.mut }}>
              {p.realized > 0 ? "+" : ""}{fmtMoney(Math.round(p.realized), p.currency)}
            </span>
          </span>
        )}
        {p.updated && <span style={{ opacity: 0.8 }}>{p.updated.slice(0, 16).replace("T", " ")}</span>}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input key={`${p.sym}-${p.cur}`} style={{ ...css.input, width: 130, padding: "6px 8px", fontSize: 13 }} inputMode="decimal"
          placeholder={`fiyat ${p.currency === "USD" ? "$" : "TL"}`} defaultValue={p.cur ?? ""}
          onClick={(e) => e.stopPropagation()}
          onBlur={async (e) => {
            const v = num(e.target.value);
            if (v > 0 && v !== p.cur) { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: v, currency: p.currency }); reload(); }
          }} />
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: T.panel2,
          color: p.source === "manual" ? T.acc : T.mut,
        }}>{p.source === "manual" ? "elle" : "oto"}</span>
        {p.cur != null && p.source === "manual" && (
          <button style={{ ...css.ghost, fontSize: 11.5, padding: "5px 10px" }} title="Elle girdiğin fiyatı sil, otomatiğe dön"
            onClick={async () => { await api.delPrice(p.type, p.sym); reload(); }}>otomatiğe dön</button>
        )}
        {p.cur == null && <span style={{ fontSize: 11.5, color: T.neg }}>fiyat çekilemedi — elle gir</span>}
        {p.type === "FON" && (
          <button
            title={nakitSayilir ? "Nakit sayımından çıkar" : "Para piyasası fonu — nakit gibi say (takvimde etkin nakite eklenir)"}
            onClick={onNakitSay}
            style={{
              fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${nakitSayilir ? T.pos : T.line}`,
              background: nakitSayilir ? T.posSoft : "transparent",
              color: nakitSayilir ? T.pos : T.mut,
            }}>{nakitSayilir ? "✓ nakit sayılır" : "nakit say"}</button>
        )}
        {onSymbol && (
          <button style={{ ...css.ghost, fontSize: 11.5, padding: "5px 10px" }}
            onClick={() => onSymbol(p.sym)}>hareketlerini gör</button>
        )}
      </div>
    </div>
  );
}
