import React, { useMemo, useState } from "react";
import { islemKarsilastir, ozetKarsilastir, qtyDelta, type AllData, type AssetType, type AyrisanIslem, type IslemSonucu } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Hint } from "../../ui";
import { bellek, useKalici } from "./iceAktarBellek";

/* ————— ARACI KURUM EKSTRESİ → PORTFÖY İŞLEMLERİ (Faz 45.9) —————
   `parseIslemler` (engine) ekstrenin işlem tablosunu okur; burada her satır uygulamadaki işlemlerle
   karşılaştırılır (aynı sembol + yön + adet, ±1 gün → "zaten kayıtlı", seçili gelmez), varlık türü
   tahmin edilir (uygulamada bu sembol varsa onun türü, yoksa satırdaki "fon" ipucu, yoksa BIST —
   kullanıcı değiştirebilir) ve belgenin PORTFÖY ÖZETİ varsa dönem sonu adetleri uygulamayla
   karşılaştırılır. Yazım tek atomik istek (`POST /trades/bulk`); hesaba bağlı TRY işlem hesabın
   bakiyesini tekli işlemdeki kuralla oynatır (tutar.ts `cashDelta`). */

const TURLER: AssetType[] = ["BIST", "FON", "ETF", "KRIPTO", "ALTIN", "DOVIZ"];
/** `portfoy`: satırın portföy grubu ("" = gruplanmamış). Satır başınadır — tek ekstrede iki ayrı
    portföy + portföysüz varlık olabilir (kullanıcı geri bildirimi); öntanım, o sembolün uygulamadaki
    son işleminin grubu (aynı varlık çoğu zaman aynı portföyde kalır). */
type Satir = AyrisanIslem & { asset_type: AssetType; include: boolean; kayitli: boolean; portfoy: string };
const kisaTarih = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

export function IslemOnizleme({ data, sonuc, accountId, reload, onClose, onGeri }: {
  data: AllData; sonuc: IslemSonucu; accountId: number | null; reload: () => void; onClose: () => void; onGeri: () => void;
}) {
  /* Satırlar yarım iş belleğinde (iceAktarBellek): sekme değiştirip dönünce seçimler korunur. Bellekteki
     satırlar YALNIZ aynı ayrıştırma sonucuna aittir — yeni belge okunduysa baştan kurulur. */
  const ilkSatirlar = (): Satir[] => {
    const durum = islemKarsilastir(sonuc.islemler, data.trades);
    return sonuc.islemler.map((r, i) => {
      const bilinen = (data.trades.find((t) => t.symbol === r.symbol)?.asset_type ?? data.prices.find((p) => p.symbol === r.symbol)?.asset_type) as AssetType | undefined;
      const sonGrup = data.trades.filter((t) => t.symbol === r.symbol).sort((a, b) => b.date.localeCompare(a.date))[0]?.portfolio_id;
      return { ...r, asset_type: bilinen ?? (r.fonIpucu ? "FON" : "BIST"), kayitli: durum[i] === "eslesti", include: durum[i] === "eksik", portfoy: sonGrup != null ? String(sonGrup) : "" };
    });
  };
  if (bellek.islemKaynak !== sonuc) { delete bellek.islemSatirlar; bellek.islemKaynak = sonuc; }
  const [satirlar, setSatirlar] = useKalici<Satir[]>("islemSatirlar", useMemo(ilkSatirlar, []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, p: Partial<Satir>) => setSatirlar((s) => s.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const secili = satirlar.filter((r) => r.include);
  const hesap = accountId != null ? data.accounts.find((a) => a.id === accountId) : undefined;

  /* Portföy özeti: belgenin özet tarihindeki adedi ↔ uygulama (TÜM işlemler + eklenecekler, o tarih
     itibarıyla). Hesapla süzülmez — bkz. engine `ozetKarsilastir`. Tutmayan sembolde adedin hangi
     hesaplara bağlı işlemlerden geldiği yazılır: fark çoğu zaman oradan anlaşılır (aynı varlık başka
     bir aracı kurumda da tutuluyor ya da bir satış kaydedilmemiş). */
  const ozetFark = useMemo(() => {
    if (!sonuc.ozet.length) return null;
    return ozetKarsilastir(sonuc.ozet, [...data.trades, ...secili], sonuc.ozetTarih);
  }, [sonuc.ozet, sonuc.ozetTarih, data.trades, secili]);
  const kirilim = (sembol: string) => {
    const m = new Map<string, number>();
    for (const t of [...data.trades, ...secili.map((r) => ({ ...r, account_id: accountId }))]) {
      if (t.symbol !== sembol || (sonuc.ozetTarih && t.date > sonuc.ozetTarih)) continue;
      const ad = t.account_id == null ? "hesapsız" : data.accounts.find((a) => a.id === t.account_id)?.name ?? "?";
      m.set(ad, (m.get(ad) ?? 0) + qtyDelta(t));
    }
    return [...m].filter(([, q]) => Math.abs(q) > 1e-9).map(([ad, q]) => `${ad} ${Math.round(q * 1e6) / 1e6}`).join(" · ");
  };
  const tumune = (p: string) => setSatirlar((s) => s.map((r) => (r.include ? { ...r, portfoy: p } : r)));

  const kaydet = async () => {
    setBusy(true); setErr(null);
    try {
      await api.bulkTrades(secili.map((r) => ({
        date: r.date, asset_type: r.asset_type, symbol: r.symbol, side: r.side, qty: r.qty, price: r.price, fee: r.fee,
        currency: r.currency, account_id: accountId, portfolio_id: r.portfoy ? +r.portfoy : null,
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
            ⚠ Portföy özetinde {ozetFark.length} sembolün adedi tutmuyor{sonuc.ozetTarih ? <> ({kisaTarih(sonuc.ozetTarih)} itibarıyla)</> : null}:
            {ozetFark.map((f) => (
              <div key={f.symbol} style={{ marginTop: 2 }}>
                <span style={css.mono}>{f.symbol}: belge {f.belge}, uygulama {f.uygulama}</span>
                {kirilim(f.symbol) && <span style={{ color: T.mut }}> — {kirilim(f.symbol)}</span>}
              </div>
            ))}
            <div style={{ color: T.mut, marginTop: 4 }}>Uygulamadaki adet bütün işlemlerinden sayılır (hangi hesaptan ödendiğine bakılmaz). Aynı varlığı başka bir aracı kurumda da tutuyorsan ya da bir alış/satışı girmediysen fark buradan gelir.</div>
          </>)}
      {sonuc.islemler.length === 0 && <Hint>Belgede işlem tablosu bulunamadı (sembol, adet ve fiyat sütunları olan bir tablo aranır).</Hint>}

      {data.portfolios.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: T.mut, marginBottom: 8 }}>
          <span>Portföy grubu satır başına seçilir. Seçili satırların hepsine:</span>
          <select className="inline-select" style={{ ...css.input, padding: "4px 8px", fontSize: 12.5, width: "auto" }} aria-label="Seçili satırların portföyü"
            value="" onChange={(e) => { if (e.target.value !== "") tumune(e.target.value === "-" ? "" : e.target.value); }}>
            <option value="">uygula…</option>
            <option value="-">Gruplanmamış</option>
            {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ border: `1px solid ${T.line}`, borderRadius: 10 }}>
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
            {data.portfolios.length > 0 && (
              <select className="inline-select" style={{ ...css.input, padding: "4px 6px", fontSize: 12, width: "auto", maxWidth: 140 }} aria-label="Portföy grubu"
                value={r.portfoy} onChange={(e) => upd(i, { portfoy: e.target.value })}>
                <option value="">Gruplanmamış</option>
                {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {r.kayitli && <div style={{ flexBasis: "100%", fontSize: 11.5, color: T.mut3, paddingLeft: 24 }}>uygulamada zaten kayıtlı</div>}
          </div>
        ))}
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
