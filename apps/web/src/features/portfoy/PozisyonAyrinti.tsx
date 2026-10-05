import React, { useState } from "react";
import { num, convert, dripAcikMi, dripToggle, type AllData, type Currency, type Position, type Rates } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, fmtPct, fiyatYasi, FIYAT_YASI_IPUCU, TYPE_COLORS } from "../../theme";
import { Modal } from "../../ui";
import { Satirlar, Anahtar } from "../forms/parcalar";

/* ————— POZİSYON SAYFASI —————
   Faz 31'de fiyat giriş kutusu + "oto" rozeti + "sıfırla" varlık listesinin GÖRÜNEN satırından
   çıkarılıp satıra dokununca SATIRIN İÇİNDE açılan bir alana taşınmıştı; Faz 32'de aynı alan
   tabloda da gerekti. Yeniden tasarım (Ekim 2026, grup 4): satırın içinde açılmak listeyi uzatıp
   kaydırıyordu — artık alttan açılan SAYFA (Kartlar/Hesaplar'daki desen). Tek bileşen, iki çağıran
   (liste satırı + tablo satırı): iki kopya olsaydı "nakit say" yalnız birinde güncellenirdi. */

const adetYaz = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
const satir: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 14px", borderTop: `1px solid ${T.line2}`, fontSize: 15 };

export function PozisyonSayfasi({ p, data, ccy, rates, agirlik, reload, onClose, onSymbol }: {
  p: Position; data: AllData; ccy: Currency; rates: Rates;
  /** portföy içindeki pay (0-1), bilinmiyorsa null */
  agirlik: number | null;
  reload: () => void; onClose: () => void;
  /** verilirse "Hareketlerini gör" çıkar (detayda işlem geçmişini bu sembole süzer) */
  onSymbol?: (s: string) => void;
}) {
  /* Fiyatın yaşı sunucunun "şimdi"siyle ölçülür (`AllData.now`), tarayıcı saatiyle DEĞİL. Elle girilen
     fiyatta metin "girildi" olur — yoksa kullanıcının kendi yazdığı sayı otomatik gelmiş gibi okunur. */
  const yas = fiyatYasi(p.updated, data.now);
  const [fiyat, setFiyat] = useState(p.cur != null ? String(p.cur).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const fiyatDegisti = num(fiyat) > 0 && num(fiyat) !== p.cur;
  const fiyatKaydet = async () => {
    if (!fiyatDegisti || busy) return;
    setBusy(true);
    try { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: num(fiyat), currency: p.currency }); reload(); }
    finally { setBusy(false); }
  };
  /* Para piyasası (nakit sayılan) fonlar — Nakit Akışı takviminde nakit gibi değerlenir */
  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  const nakitSayilir = cashFunds.has(p.sym);
  const nakitSay = async () => {
    const next = new Set(cashFunds);
    next.has(p.sym) ? next.delete(p.sym) : next.add(p.sym);
    await api.put("settings", { cash_funds: [...next].join(",") });
    reload();
  };
  /* Temettü geri yatırımı (Faz 36) — işaret POZİSYONA aittir, anında kaydedilir */
  const dripAcik = dripAcikMi(data.settings, p.type, p.sym);
  const drip = async () => { await api.put("settings", { drip_symbols: dripToggle(data.settings, p.type, p.sym) }); reload(); };
  const yukari = (p.unreal ?? 0) >= 0;
  const renk = TYPE_COLORS[p.type] || T.mut;

  return (
    <Modal title={p.sym} onClose={onClose}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: T.panel2, color: renk, fontWeight: 800, fontSize: 15, display: "grid", placeItems: "center", flexShrink: 0 }}>
            {p.sym.slice(0, 2).toLocaleUpperCase("tr")}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: T.mut }}>
              <span style={{ color: renk, fontWeight: 600 }}>{p.type}</span> · {adetYaz(p.qty)} adet
              {agirlik != null && agirlik > 0 && <> · portföyün %{(agirlik * 100).toFixed(1).replace(".", ",")}'i</>}
            </div>
            <div style={{ ...css.mono, fontSize: 28, fontWeight: 600 }}>
              {p.value != null ? fmtMoney(Math.round(p.value), p.currency) : "—"}
              {p.currency === "USD" && p.value != null && ccy === "TRY" && (
                <span style={{ fontSize: 13, color: T.mut, fontWeight: 400 }}> ≈ {fmtMoney(Math.round(convert(p.value, "USD", "TRY", rates)), "TRY")}</span>
              )}
            </div>
          </div>
        </div>
        {(p.unreal != null || p.realized !== 0) && (
          /* Etiketler düz yazı, yalnız rakamlar mono: hepsi mono olunca satır 390px'te "gerçekleşen +"
             ile rakamın arasından kırılıyordu. */
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 13.5, color: T.mut, marginTop: -6 }}>
            {p.unreal != null && (
              <span style={{ whiteSpace: "nowrap" }}>açık K/Z{" "}
                <span style={{ ...css.mono, color: yukari ? T.pos : T.neg }}>
                  {yukari ? "+" : ""}{fmtMoney(Math.round(p.unreal), p.currency)}{p.unrealPct != null && <> ({fmtPct(p.unrealPct)})</>}
                </span>
              </span>
            )}
            {p.realized !== 0 && (
              <span style={{ whiteSpace: "nowrap" }}>gerçekleşen{" "}
                <span style={{ ...css.mono, color: p.realized > 0 ? T.pos : T.neg }}>{p.realized > 0 ? "+" : ""}{fmtMoney(Math.round(p.realized), p.currency)}</span>
              </span>
            )}
          </div>
        )}

        <Satirlar>
          <div style={{ ...satir, borderTop: "none" }}>
            <span style={{ color: T.mut, flex: 1 }}>Ortalama maliyet</span>
            <span style={{ ...css.mono, fontWeight: 500 }}>{fmtMoney(p.avg, p.currency, true)}</span>
          </div>
          <div style={satir}>
            <span style={{ color: T.mut, flex: 1 }}>Güncel fiyat</span>
            {p.cur != null
              ? <span style={{ textAlign: "right" }}>
                <span style={{ ...css.mono, fontWeight: 500 }}>{fmtMoney(p.cur, p.currency, true)}</span>
                {yas && (
                  /* Kesin an tooltip'te: kullanıcının sorusu "hangi saniyede" değil "ne kadar eski" */
                  <span title={`${p.updated}${p.source === "manual" ? "" : ` — ${FIYAT_YASI_IPUCU}`}`} style={{ display: "block", fontSize: 12, color: T.mut }}>
                    {yas} {p.source === "manual" ? "elle girildi" : "çekildi"}
                  </span>
                )}
              </span>
              : <span style={{ color: T.neg, fontSize: 14 }}>fiyat çekilemedi — aşağıya elle gir</span>}
          </div>
          {/* Elle fiyat: kullanıcıya özel (user_prices) — başkasının değerlemesini etkilemez */}
          <div style={{ ...satir, gap: 8 }}>
            <span style={{ color: T.mut, flex: 1 }}>Elle fiyat</span>
            <input inputMode="decimal" aria-label="Elle fiyat" value={fiyat} onChange={(e) => setFiyat(e.target.value)}
              placeholder={p.currency === "USD" ? "$" : "₺"}
              style={{ width: 110, textAlign: "right", border: `1px solid ${T.line}`, borderRadius: 9, padding: "6px 10px", fontFamily: T.mono, fontSize: 15, background: T.panel, color: T.text, minHeight: 0 }} />
            {fiyatDegisti && (
              <button onClick={fiyatKaydet} disabled={busy} style={{ height: 34, minHeight: 0, padding: "0 12px", border: "none", borderRadius: 9, background: T.acc, color: T.accInk, fontFamily: T.disp, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Kaydet</button>
            )}
          </div>
          {p.source === "manual" && p.cur != null && (
            <div style={{ ...satir, justifyContent: "flex-end" }}>
              <button title="Elle girdiğin fiyatı sil, otomatiğe dön" onClick={async () => { await api.delPrice(p.type, p.sym); reload(); }}
                style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0" }}>Otomatik fiyata dön</button>
            </div>
          )}
        </Satirlar>
        {p.type === "FON" && (
          /* Fon fiyatı NAV'dır: gün içinde değişmez — yaşı tek başına görünce "bayat" sanılır */
          <div style={{ fontSize: 12.5, color: T.mut, marginTop: -6 }}>Fon fiyatı (NAV) günde bir hesaplanır.</div>
        )}

        {p.type === "FON" && (
          <Anahtar etiket="Nakit say" acik={nakitSayilir} onChange={nakitSay}
            alt="para piyasası fonu: takvimde etkin nakde katılır, ödeme öncesi 'fon boz' önerisi devreye girer" />
        )}
        {(p.type === "BIST" || p.type === "ETF") && (
          <Anahtar etiket="Temettüyü geri yatır" acik={dripAcik} onChange={drip}
            alt={dripAcik ? `${p.sym} temettüsü gelince alım da önerilir` : "temettü geldiğinde yalnız gelir olarak yazılır"} />
        )}

        {onSymbol && (
          <button onClick={() => { onSymbol(p.sym); onClose(); }} style={{
            height: 46, borderRadius: 12, border: `1px solid ${T.line}`, background: T.panel, color: T.text,
            fontFamily: T.disp, fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>Hareketlerini gör</button>
        )}
      </div>
    </Modal>
  );
}
