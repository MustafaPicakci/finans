import React, { useMemo, useState } from "react";
import { islemKarsilastir, ozetKarsilastir, type AllData, type AssetType, type AyrisanIslem, type IslemSonucu } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Field, Hint } from "../../ui";

/* ————— ARACI KURUM EKSTRESİ → PORTFÖY İŞLEMLERİ (Faz 45.9) —————
   `parseIslemler` (engine) ekstrenin işlem tablosunu okur; burada her satır uygulamadaki işlemlerle
   karşılaştırılır (aynı sembol + yön + adet, ±1 gün → "zaten kayıtlı", seçili gelmez), varlık türü
   tahmin edilir (uygulamada bu sembol varsa onun türü, yoksa satırdaki "fon" ipucu, yoksa BIST —
   kullanıcı değiştirebilir) ve belgenin PORTFÖY ÖZETİ varsa dönem sonu adetleri uygulamayla
   karşılaştırılır. Yazım tek atomik istek (`POST /trades/bulk`); hesaba bağlı TRY işlem hesabın
   bakiyesini tekli işlemdeki kuralla oynatır (tutar.ts `cashDelta`). */

const TURLER: AssetType[] = ["BIST", "FON", "ETF", "KRIPTO", "ALTIN", "DOVIZ"];
type Satir = AyrisanIslem & { asset_type: AssetType; include: boolean; kayitli: boolean };
const kisaTarih = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

export function IslemOnizleme({ data, sonuc, accountId, reload, onClose, onGeri }: {
  data: AllData; sonuc: IslemSonucu; accountId: number | null; reload: () => void; onClose: () => void; onGeri: () => void;
}) {
  const [satirlar, setSatirlar] = useState<Satir[]>(() => {
    const durum = islemKarsilastir(sonuc.islemler, data.trades);
    return sonuc.islemler.map((r, i) => {
      const bilinen = (data.trades.find((t) => t.symbol === r.symbol)?.asset_type ?? data.prices.find((p) => p.symbol === r.symbol)?.asset_type) as AssetType | undefined;
      return { ...r, asset_type: bilinen ?? (r.fonIpucu ? "FON" : "BIST"), kayitli: durum[i] === "eslesti", include: durum[i] === "eksik" };
    });
  });
  const [portfoy, setPortfoy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, p: Partial<Satir>) => setSatirlar((s) => s.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const secili = satirlar.filter((r) => r.include);
  const hesap = accountId != null ? data.accounts.find((a) => a.id === accountId) : undefined;

  /* Portföy özeti: belgenin dönem sonu adedi ↔ uygulama (bu hesabın işlemleri + eklenecekler). */
  const ozetFark = useMemo(() => {
    if (!sonuc.ozet.length) return null;
    const mevcut = data.trades.filter((t) => accountId == null || t.account_id === accountId);
    return ozetKarsilastir(sonuc.ozet, [...mevcut, ...secili]);
  }, [sonuc.ozet, data.trades, accountId, secili]);

  const kaydet = async () => {
    setBusy(true); setErr(null);
    try {
      await api.bulkTrades(secili.map((r) => ({
        date: r.date, asset_type: r.asset_type, symbol: r.symbol, side: r.side, qty: r.qty, price: r.price, fee: r.fee,
        currency: r.currency, account_id: accountId, portfolio_id: portfoy ? +portfoy : null,
      })));
      reload(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally { setBusy(false); }
  };

  const kutu = (renk: string, icerik: React.ReactNode) => (
    <div style={{ fontSize: 12.5, color: renk, background: T.panel2, borderRadius: 8, padding: "7px 12px", marginBottom: 8 }}>{icerik}</div>
  );
  return (
    <div>
      <div style={{ fontSize: 13, color: T.mut, marginBottom: 8 }}>
        <b style={{ color: T.text }}>{satirlar.length}</b> işlem · <b style={{ color: T.text }}>{satirlar.filter((r) => r.kayitli).length}</b> zaten kayıtlı · <b style={{ color: T.text }}>{secili.length}</b> seçili
      </div>
      {ozetFark == null
        ? kutu(T.mut, "Belgede portföy özeti bulunamadı — adetler belgeyle karşılaştırılamadı, satırları gözden geçir.")
        : ozetFark.length === 0
          ? kutu(T.pos, `✓ Belgenin portföy özetiyle tutuyor: ${sonuc.ozet.length} sembolün dönem sonu adedi uygulamadakiyle aynı.`)
          : kutu(T.neg, <>
            ⚠ Portföy özetinde {ozetFark.length} sembolün adedi tutmuyor{hesap ? <> ({hesap.name} hesabının işlemlerine göre)</> : null}:
            {ozetFark.slice(0, 5).map((f) => <div key={f.symbol} style={css.mono}>{f.symbol}: belge {f.belge}, uygulama {f.uygulama}</div>)}
            {ozetFark.length > 5 && <div>… ve {ozetFark.length - 5} sembol daha</div>}
            <div style={{ color: T.mut, marginTop: 4 }}>Ekstre yalnız bu dönemi kapsar: daha önceki işlemler uygulamada yoksa ya da başka hesaba bağlıysa fark buradan gelir.</div>
          </>)}
      {sonuc.islemler.length === 0 && <Hint>Belgede işlem tablosu bulunamadı (sembol, adet ve fiyat sütunları olan bir tablo aranır).</Hint>}

      <div style={{ maxHeight: "42vh", overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: 10 }}>
        {satirlar.map((r, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", flexWrap: "wrap",
            borderTop: i === 0 ? "none" : `1px solid ${T.line}`, opacity: r.include ? 1 : 0.55,
          }}>
            <input type="checkbox" checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} />
            <span style={{ ...css.mono, fontSize: 11.5, color: T.mut3 }}>{kisaTarih(r.date)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: r.side === "ALIŞ" ? T.pos : T.neg }}>{r.side}</span>
            <b style={{ fontSize: 13 }}>{r.symbol}</b>
            <span style={{ ...css.mono, fontSize: 12, color: T.mut, flex: "1 1 120px" }}>
              {r.qty} × {fmtMoney(r.price, r.currency, true)}{r.fee ? ` + ${fmtMoney(r.fee, r.currency, true)} ücret` : ""}
            </span>
            <select className="inline-select" style={{ ...css.input, padding: "4px 6px", fontSize: 12, width: "auto" }} aria-label="Varlık türü"
              value={r.asset_type} onChange={(e) => upd(i, { asset_type: e.target.value as AssetType })}>
              {TURLER.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {r.kayitli && <div style={{ flexBasis: "100%", fontSize: 11.5, color: T.mut3, paddingLeft: 24 }}>uygulamada zaten kayıtlı</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Field label="Portföy grubu" flex={1}>
          <select style={css.input} value={portfoy} onChange={(e) => setPortfoy(e.target.value)}>
            <option value="">Gruplanmamış</option>
            {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
        {hesap
          ? <>Seçili işlemler <b>{hesap.name}</b> hesabına bağlanır: TL işlemler bakiyeyi oynatır (alış −, satış +). Hesaba para yatırma/çekme bu ekrana gelmez — onu banka dökümünden <b>virman</b> olarak aktar.</>
          : "Hesap seçilmedi — işlemler portföye girer, hiçbir hesabın bakiyesine dokunmaz."}
        {" "}Temettü ve bedelsiz buradan aktarılmaz: Özet'teki "defterinde eksik kayıt" kartı onları önerir.
      </div>
      {err && <div style={{ color: T.neg, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={{ ...css.btn, opacity: secili.length && !busy ? 1 : 0.4 }} disabled={!secili.length || busy} onClick={kaydet}>
          {busy ? "Kaydediliyor…" : `${secili.length} işlemi içe aktar`}
        </button>
        <button type="button" style={css.ghost} onClick={onGeri}>Geri</button>
      </div>
    </div>
  );
}
