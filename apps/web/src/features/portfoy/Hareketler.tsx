import React, { useEffect, useMemo, useState } from "react";
import {
  parseD, fmtD, ymOf, tradeLedger, summarizeTrades,
  type AllData, type Currency, type Trade, type TradeEntry,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_COLORS } from "../../theme";
import { Empty, FiltreSeridi, SilDugmesi, useSayfalama, DahaFazla } from "../../ui";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— HAREKETLER (İŞLEM GEÇMİŞİ) —————
   "Hangi varlık ne zaman girdi/çıktı, ortalama maliyetim nasıl değişti, ne kazandım."
   Satır modeli engine'den gelir (`tradeLedger`): her işlemin öncesi/sonrası adet + ortalama maliyet,
   satışta gerçekleşen K/Z. Defter **seçili portföyün** işlemleriyle hesaplanır — grup başına ayrı
   ortalama maliyet (bkz. groupTradesByPortfolio). Filtreler defterden SONRA uygulanır: sembolü
   süzmek geçmişin matematiğini değiştirmez, sadece görünen satırları kısar. */

type Side = "hepsi" | Trade["side"];
/** Pozisyon olaylarının rozet renkleri (Faz 21) — temettü/bedelsiz alış-satıştan görsel olarak ayrılır */
const SIDE_SOFT: Record<Trade["side"], string> = {
  "ALIŞ": T.posSoft, "SATIŞ": T.negSoft, "TEMETTÜ": "var(--cat-5-soft, " + T.panel2 + ")", "BEDELSİZ": T.panel2,
};
const SIDE_INK: Record<Trade["side"], string> = {
  "ALIŞ": T.pos, "SATIŞ": T.neg, "TEMETTÜ": "var(--cat-5)", "BEDELSİZ": "var(--cat-3)",
};
type Range = 3 | 6 | 12 | 0; // 0 = tümü

const RANGES: { v: Range; label: string }[] = [
  { v: 3, label: "3 ay" }, { v: 6, label: "6 ay" }, { v: 12, label: "1 yıl" }, { v: 0, label: "Tümü" },
];

/** N ay öncesinin ISO tarihi (0 → sınır yok) */
const sinceOf = (months: Range): string => {
  if (!months) return "";
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };

/** Bir seferde gösterilen/eklenen satır sayısı. Satır üç katmanlı ve yüksek — 10'u bile
    mobilde bir ekranı aşıyor; daha büyük bir dilim "sayfalama" hissini tamamen siliyordu. */
const SAYFA = 10;

export function Hareketler({ data, trades, scopeLabel, reload, symbol, onSymbol, govdesiz = false }: {
  data: AllData;
  /** defterin kapsamı — seçili portföyün işlemleri (veya tümü) */
  trades: Trade[];
  scopeLabel: string | null;
  reload: () => void;
  /** dışarıdan (pozisyon satırına tıklayarak) seçilen sembol filtresi */
  symbol: string | null;
  onSymbol: (s: string | null) => void;
  /** Faz 32: sekme kartının İÇİNDE render edilirken kendi kartını çizmez */
  govdesiz?: boolean;
}) {
  const [side, setSide] = useState<Side>("hepsi");
  const [range, setRange] = useState<Range>(0);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const ledger = useMemo(() => tradeLedger(trades), [trades]);
  const since = sinceOf(range);
  const shown = useMemo(() => ledger.filter((e) => (
    (symbol == null || e.trade.symbol.toUpperCase() === symbol.toUpperCase()) &&
    (side === "hepsi" || e.trade.side === side) &&
    (!since || e.trade.date >= since)
  )).reverse(), [ledger, symbol, side, since]); // en yeni üstte

  /* ————— SAYFALAMA (Faz 32) —————
     SUNUCU TARAFI SAYFALAMA BURADA YAPILAMAZ ve bu bir kısıt değil, matematiğin gereği:
     `tradeLedger` her satırın "adet 70 → 120 · ort. 245,10 → 246,30" değerlerini TÜM geçmişi
     kronolojik yürüyerek üretir. Sunucu yalnız ikinci sayfayı gönderseydi yürüyüşün başlangıç
     durumu (o ana kadarki adet ve ortalama maliyet) kaybolur, ekrandaki her sayı yanlış
     çıkardı. Veri zaten `/api/all` ile tek seferde geliyor; sayfalanan şey yalnız RENDER —
     asıl maliyet de orada (her satır düğmeli/seçicili karmaşık bir DOM ağacı).

     "Daha fazla" biçimi bilinçli: liste kronolojik ve ay başlıklarıyla gruplu; numaralı
     sayfalar bu sürekli zaman çizgisini bölerdi ve mobilde denetimlere ulaşmak için zaten
     listenin sonuna inmek gerekirdi. Eskiye gitmenin asıl aracı üstteki dönem/sembol
     süzgeçleri. */
  const s2 = useSayfalama(shown, SAYFA, `${symbol}|${side}|${range}`);
  const gorunen = s2.gorunen;

  /* Özet para birimi başına ayrı — TRY ile USD'yi tek rakamda toplamak yanıltıcı olurdu
     (FX kuru işlem anındaki değil bugünkü olurdu).
     ÖZET `shown` ÜZERİNDEN, `gorunen` üzerinden DEĞİL: dönem özeti süzgecin tamamını
     anlatır. Görünen sayfaya bağlasaydık "daha fazla göster"e her basışta alış/satış
     toplamları büyür, kullanıcı hangi rakamın doğru olduğunu bilemezdi. */
  const summaries = useMemo(() => {
    const ccys = [...new Set(shown.map((e) => e.trade.currency ?? "TRY"))] as Currency[];
    return ccys.map((c) => ({ ccy: c, s: summarizeTrades(shown.filter((e) => (e.trade.currency ?? "TRY") === c)) }));
  }, [shown]);

  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol.toUpperCase()))].sort(),
    [trades],
  );
  const filtered = symbol != null || side !== "hepsi" || range !== 0;
  const clear = () => { onSymbol(null); setSide("hepsi"); setRange(0); };

  const Kap = govdesiz
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : ({ children }: { children: React.ReactNode }) => <div style={css.card}>{children}</div>;

  return (
    <Kap>
      {/* Kart başlığı YALNIZ tek başına kullanıldığında. Sekme kartının içindeyken sekme
          zaten "İşlem Geçmişi" diyordu; "Hareketler" başlığı aynı şeyi ikinci kez söyleyip
          ekranın üstünden bir satır götürüyordu. */}
      {!govdesiz && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Hareketler
            {scopeLabel && <span style={{ fontSize: 12, fontWeight: 400, color: T.mut, marginLeft: 8 }}>— {scopeLabel}</span>}
          </div>
          <div style={{ fontSize: 12, color: T.mut }}>{shown.length} işlem</div>
        </div>
      )}

      {/* Filtreler TEK SATIR. Eskiden dört kontrol üç satıra yayılıyordu (390px'te) ve
          ilk işlem satırı ekranın yarısından sonra başlıyordu. İki değişiklik:
          • TÜR filtresi kaldırıldı — sembol seçilince tür zaten belli, ikisi büyük ölçüde
            aynı işi yapıyordu; tür bazlı bakmak isteyen Kayıtlar sekmesini kullanır.
          • Yön ve dönem düğme şeritleri açılır menüye indi: beş yön düğmesi tek başına
            390px'i dolduruyordu, oysa TEMETTÜ/BEDELSİZ nadiren süzülür.
          Sayaç şeridin sağına taşındı — böylece kendi satırını harcamıyor. */}
      <FiltreSeridi sag={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: T.mut3, whiteSpace: "nowrap" }}>{shown.length} işlem</span>
          {filtered && (
            <button type="button" style={{ ...css.ghost, padding: "5px 10px", fontSize: 11.5 }} onClick={clear}>temizle</button>
          )}
        </span>}>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }} value={symbol ?? ""} onChange={(e) => onSymbol(e.target.value || null)}>
          <option value="">Sembol: tümü</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }} value={side} onChange={(e) => setSide(e.target.value as Side)}>
          <option value="hepsi">İşlem: tümü</option>
          {(["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"] as Trade["side"][]).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }} value={range} onChange={(e) => setRange(Number(e.target.value) as Range)}>
          {RANGES.map((r) => <option key={r.v} value={r.v}>{r.v === 0 ? "Dönem: tümü" : r.label}</option>)}
        </select>
      </FiltreSeridi>

      {/* dönem özeti — para birimi başına */}
      {summaries.map(({ ccy, s }) => (
        <div key={ccy} style={{
          display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline",
          background: T.panel2, borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: 11.5, color: T.mut,
        }}>
          {summaries.length > 1 && <b style={{ color: T.text }}>{ccy}</b>}
          <span>alış <span style={{ ...css.mono, color: T.text }}>{fmtMoney(Math.round(s.buy), ccy)}</span></span>
          <span>satış <span style={{ ...css.mono, color: T.text }}>{fmtMoney(Math.round(s.sell), ccy)}</span></span>
          {s.fee > 0 && <span>kom. <span style={{ ...css.mono, color: T.text }}>{fmtMoney(s.fee, ccy, true)}</span></span>}
          {/* Temettü gerçekleşen K/Z'nin İÇİNDE sayılır; ayrıca gösterilir çünkü satış kârından
              farklı bir getiri kalitesidir (pozisyonu küçültmeden gelen nakit). */}
          {s.dividend > 0 && <span>temettü <span style={{ ...css.mono, color: "var(--cat-5)" }}>{fmtMoney(Math.round(s.dividend), ccy)}</span></span>}
          <span>K/Z <span style={{ ...css.mono, color: s.realized > 0 ? T.pos : s.realized < 0 ? T.neg : T.text }}>
            {s.realized > 0 ? "+" : ""}{fmtMoney(Math.round(s.realized), ccy)}
          </span></span>
        </div>
      ))}

      {shown.length === 0 && <Empty>{filtered ? "Bu filtreye uyan işlem yok." : "Kayıtlı işlem yok."}</Empty>}

      {/* aya göre gruplanmış hareket listesi (yalnız görünen dilim) */}
      {gorunen.map((e, i) => {
        const ym = ymOf(parseD(e.trade.date));
        const prevYm = i > 0 ? ymOf(parseD(gorunen[i - 1].trade.date)) : null;
        return (
          <React.Fragment key={e.trade.id}>
            {ym !== prevYm && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em",
                padding: "10px 0 6px", borderBottom: `1px solid ${T.line}`, marginBottom: 2,
              }}>{fmtD(parseD(e.trade.date), MONTH_FMT)}</div>
            )}
            <HareketRow e={e} data={data} reload={reload} onSymbol={onSymbol} onEdit={setEditing} />
          </React.Fragment>
        );
      })}

      <DahaFazla s={s2} ad="hareket" />

      {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
    </Kap>
  );
}

/** Tek hareket: üst satır ne olduğu, alt satır pozisyona etkisi (adet ve ortalama maliyet değişimi) */
function HareketRow({ e, data, reload, onSymbol, onEdit }: {
  e: TradeEntry; data: AllData; reload: () => void; onSymbol: (s: string | null) => void;
  onEdit: (t: EditTarget) => void;
}) {
  const t = e.trade;
  const ccy = (t.currency ?? "TRY") as Currency;
  const buy = t.side === "ALIŞ";
  const bonus = t.side === "BEDELSİZ", div = t.side === "TEMETTÜ";
  const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
  const [acik, setAcik] = useState(false);
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
      {/* Satır TEK SOL KENARA hizalı üç katmandır — kimlik, ayrıntı, etki. Eskiden ayrıntı
          satırı `marginLeft:60` ile içerliydi (artık var olmayan bir tarih sütununun kalıntısı)
          ve grup seçici satırın ortasında kocaman bir kutu olarak duruyordu; bilgi yarı solda
          yarı ortada kalıyordu. Kutu gitti (bkz. inline-select), girintiler tek hizaya geldi. */}
      <div className="ui-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="row-lead" style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, flexShrink: 0,
          background: SIDE_SOFT[t.side], color: SIDE_INK[t.side],
        }}>{t.side}</span>
        {/* Satırın kimliği semboldür. Tarih 2. satıra indi: ay başlıkları (AĞUSTOS 2026) zaten
            bağlamı veriyor, gün tek başına 1. satırda yer kaplamayı hak etmiyor. */}
        {/* flex:1 + tutarda marginLeft:auto → tutarlar MASAÜSTÜNDE de sağ kolonda hizalanır
            (row-amount kuralı yalnız mobil medya sorgusunda; geniş ekranda hepsi sola yığılıyordu) */}
        <span className="row-title" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flex: 1 }}>
          <button type="button" onClick={() => onSymbol(t.symbol.toUpperCase())} title="Bu sembolün hareketlerini süz"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...css.mono, fontWeight: 600, fontSize: 14, color: T.acc, minHeight: 0 }}>
            {t.symbol}
          </button>
          <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[t.asset_type] || T.mut, flexShrink: 0 }}>{t.asset_type}</span>
        </span>
        {/* İşlem büyüklüğü — nötr ve işaretsiz. Yönü ALIŞ/SATIŞ rozeti söyler; kırmızı/yeşil bu
            ekranda yalnız gerçekleşen K/Z'ye ayrılmıştır (işaretli tutar "zarar" gibi okunuyordu).
            Ayrıca portföy işlemi hesaba bağlı değilse hiçbir bakiyeyi oynatmaz — eksi işareti bunu da
            yanlış ima ediyordu. */}
        <span className="row-amount" style={{ ...css.mono, fontSize: 13.5, marginLeft: "auto", color: bonus ? T.mut3 : T.text }}
          title={bonus ? "bedelsizde para hareketi yoktur" : buy ? "ödenen (komisyon dahil)" : div ? "hesaba giren temettü" : "ele geçen (komisyon düşülmüş)"}>
          {bonus ? "—" : fmtMoney(Math.round(Math.abs(e.cash)), ccy)}
        </span>
        <button className="row-end" style={css.edit} title="İşlemi düzenle" onClick={() => onEdit({ kind: "trade", row: t })}>✎</button>
        <SilDugmesi ad={<>{t.side} · {t.symbol} · {num(t.qty)} adet</>} title="İşlemi sil"
          onSil={async () => { await api.del("trades", t.id); reload(); }}
          sonuc={<>Pozisyon ve ortalama maliyet yeniden hesaplanır.{t.account_id != null && " Tutar bağlı hesaba geri işlenir."}</>} />
      </div>

      {/* 2. KATMAN — her zaman görünür: ne zaman, ne kadar, (satışta) ne kazandırdı.
          Gerçekleşen K/Z buraya ÇIKARILDI: eskiden 3. katmandaydı ve listeyi tararken
          "bu satıştan ne kazandım" sorusu ancak satır satır okununca cevaplanıyordu. */}
      <div onClick={() => setAcik((v) => !v)} title={acik ? "Ayrıntıyı kapat" : "Pozisyon etkisini gör"}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 3, fontSize: 12, color: T.mut, cursor: "pointer", userSelect: "none" }}>
        <span style={{ ...css.mono, color: T.mut3 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short" })}</span>
        <span>
          {bonus
            ? <>{num(t.qty)} adet bedelsiz</>
            : <>{num(t.qty)} × <span style={css.mono}>{fmtMoney(t.price, ccy, true)}</span></>}
        </span>
        {!buy && !bonus && e.realized !== 0 && (
          <span style={{ ...css.mono, fontSize: 11.5, color: e.realized > 0 ? T.pos : T.neg }}>
            {e.realized > 0 ? "+" : ""}{fmtMoney(Math.round(e.realized), ccy)}
          </span>
        )}
        {e.closed && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: T.panel2, color: T.mut }}>
            kapandı
          </span>
        )}
        <span style={{ marginLeft: "auto", color: T.mut3, fontSize: 10 }}>{acik ? "▾" : "▸"}</span>
      </div>

      {/* 3. KATMAN — tıklayınca. Pozisyon etkisi, komisyon ve portföy seçici burada:
          üçü de satır satır taranan bilgiler değil, "şu işleme bakayım" denince açılanlar.
          Portföy seçici özellikle buraya indi — veri DEĞİŞTİREN bir kontroldü ve salt okunur
          bir listenin ortasında her satırda duruyordu (fiyat kutusunun portföy listesinden
          çıkarılmasıyla aynı gerekçe). */}
      {acik && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingLeft: 2, fontSize: 11.5, color: T.mut3 }}>
          <span>
            adet <span style={css.mono}>{num(e.qtyBefore)}</span> → <span style={{ ...css.mono, color: T.mut }}>{num(e.qtyAfter)}</span>
          </span>
          <span>
            ort. maliyet <span style={css.mono}>{e.qtyBefore > 0 ? fmtMoney(e.avgBefore, ccy, true) : "—"}</span>
            {" → "}<span style={{ ...css.mono, color: T.mut }}>{fmtMoney(e.avgAfter, ccy, true)}</span>
          </span>
          {t.fee > 0 && (
            <span>{div ? "stopaj" : "komisyon"} <span style={{ ...css.mono, color: T.mut }}>{fmtMoney(t.fee, ccy, true)}</span></span>
          )}
          {data.portfolios.length > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              portföy:
              <select className="inline-select" title="Portföy grubu"
                style={{ ...css.input, width: "auto", maxWidth: 150, padding: "1px 4px", fontSize: 11.5, color: T.mut }}
                value={t.portfolio_id ?? ""}
                onChange={async (ev) => { await api.setTradePortfolio(t.id, ev.target.value ? +ev.target.value : null); reload(); }}>
                <option value="">Gruplanmamış</option>
                {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
