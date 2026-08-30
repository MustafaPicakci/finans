import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  fmtD, parseD, convert, portfolioValueDecomposition, coveredOnly, sliceValueHistory, bucketValueHistory,
  twrSeries, rebasePct, heldSymbols, symbolPriceSeries, symbolValueHistory,
  BENCHMARKS, benchmarkSeries, benchmarkLabel,
  type BenchmarkPoint, type Currency, type HistoryRange, type PriceHistoryEntry, type Rates, type Trade,
} from "@finans/engine";
import { T, css, fmtMoney, CATEGORY_PALETTE } from "../../theme";
import { Empty, FiltreSeridi, Aciklama } from "../../ui";

/* ————— PORTFÖY DEĞER GRAFİĞİ (Faz 13 → Faz 27) —————
   İKİ MOD, çünkü tek eksene ₺ değeri ile yüzde getiri sığmaz:

   ₺ DEĞER — değer alanı + kesikli "yatırdığın para" çizgisi. Tek başına değer eğrisi
   "portföyüm arttı" der ama artışın ne kadarının KÂR, ne kadarının yeni para olduğunu
   söylemez; ikisinin arası kârdır ve dönem özeti bunu ayırır (Δdeğer = Δkatkı + Δkâr).

   % GETİRİ — her seri pencerenin ilk gününde 0'dan başlar, böylece varlıklar birbiriyle
   (ve sonraki adımda referans endekslerle) kıyaslanabilir. Portföy serisi TWR'dir: para
   ekleme/çekme arındırılır, yoksa "ayın 15'inde 50 bin ekledim" performans gibi görünürdü.

   Dürüst kısıtlar: çözünürlük GÜNDÜR (`price_history` günde bir anlık görüntü); fiyat
   çekmeye başlanmadan önceki günler yoktur; fiyatı bilinmeyen AÇIK pozisyonu olan günler
   çizilmez (`coveredOnly`) — eksik değerlenmiş bir toplam sonraki günde sahte sıçrama olurdu. */

const RANGES: { v: HistoryRange; label: string }[] = [
  { v: "1H", label: "1H" }, { v: "1A", label: "1A" }, { v: "3A", label: "3A" },
  { v: "6A", label: "6A" }, { v: "1Y", label: "1Y" }, { v: "TÜM", label: "Tümü" },
];
/** Ekranda okunabilir kalması için pencere başına en fazla nokta */
const MAX_POINTS = 90;
type Mode = "TRY" | "PCT";

export function DegerGrafigi({ trades, priceHistory, benchmarks = [], rates, ccy, title = "Portföy Değeri", scopeLabel, height = 220 }: {
  trades: Trade[]; priceHistory: PriceHistoryEntry[]; benchmarks?: BenchmarkPoint[]; rates: Rates; ccy: Currency;
  title?: string; scopeLabel?: string | null; height?: number;
}) {
  const [range, setRange] = useState<HistoryRange>("1A");
  const [mode, setMode] = useState<Mode>("TRY");
  const [on, setOn] = useState<string[]>([]); // grafikte açık olan varlık serileri
  const [ref, setRef] = useState<string[]>([]); // açık referans endeksler (yalnız % modunda)

  const all = useMemo(() => portfolioValueDecomposition(trades, priceHistory, rates), [trades, priceHistory, rates]);
  const cov = useMemo(() => coveredOnly(all), [all]);

  /* Kapsam kararı PENCERE BAŞINA verilir, seri geneline değil. Sebebi somut: fiyat geçmişi
     henüz oluşmamış bir sembol alırsan (yeni sembol, elle fiyatlanan fon…) o günden sonraki
     TÜM günler kapsam dışı olur ve katı kural son 1 ayı tamamen boşaltır — grafik bozuk
     görünür, oysa elde çizilebilir veri vardır. Pencerede yeterli kapsanmış gün varsa katı
     davran (doğru rakam), yoksa ham seriye düş ve eksikliği dipnotta SÖYLE. */
  const allWin = useMemo(() => sliceValueHistory(all, range), [all, range]);
  const covWin = useMemo(() => sliceValueHistory(cov, range), [cov, range]);
  const strict = covWin.length >= 2;
  const win = strict ? covWin : allWin;
  const dropped = allWin.length - covWin.length;

  const points = useMemo(() => bucketValueHistory(win, MAX_POINTS), [win]);
  const twr = useMemo(() => twrSeries(win), [win]);

  const held = useMemo(() => heldSymbols(trades), [trades]);
  const colorOf = (k: string) => CATEGORY_PALETTE[Math.max(0, held.findIndex((h) => h.key === k)) % CATEGORY_PALETTE.length];
  /* Referans renkleri paletin SONUNDAN seçilir: varlık renkleriyle çakışmasın. Kesiklilik
     tek başına yetmiyordu — iki referans açıkken ikisi de aynı renkteydi (ekran denetimi). */
  const refColorOf = (k: string) =>
    CATEGORY_PALETTE[(CATEGORY_PALETTE.length - 1 - Math.max(0, BENCHMARKS.findIndex((b) => b.key === k))) % CATEGORY_PALETTE.length];
  const toggle = (k: string) => setOn((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleRef = (k: string) => setRef((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  /* Hangi referansların gerçekten verisi var? Backfill çalışmadıysa çip gösterip boş çizgi
     vermek yerine hiç göstermemek doğru — "tıkladım bir şey olmadı" en kötü geri bildirimdir. */
  const refKeys = useMemo(() => {
    const has = new Set(benchmarks.map((b) => b.key));
    return BENCHMARKS.filter((b) => has.has(b.key)).map((b) => b.key);
  }, [benchmarks]);
  const activeRefs = mode === "PCT" ? ref.filter((k) => refKeys.includes(k)) : [];

  /* Etiket biçimi seçili DÜĞMEYE değil verinin gerçek açıklığına bakar: "Tümü" seçiliyken
     eldeki geçmiş 38 günse ay-yıl biçimi "May 26"yı arka arkaya sekiz kez yazıyordu. */
  const spanDays = points.length >= 2
    ? Math.round((parseD(points.at(-1)!.date).getTime() - parseD(points[0].date).getTime()) / 86_400_000)
    : 0;
  const dateFmt: Intl.DateTimeFormatOptions = spanDays <= 75 ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" };

  const toCcy = (v: number) => Math.round(convert(v, "TRY", ccy, rates));
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /* Tüm seriler TEK veri dizisine tarih anahtarıyla birleştirilir (recharts satır bekler).
     Varlık serileri yalnız grafikte görünen günlere yazılır; eksik gün = kopuk çizgi. */
  const rows = useMemo(() => {
    const idx = new Map(points.map((p, i) => [p.date, i]));
    const twrAt = new Map(twr.map((p) => [p.date, p.value]));
    const out: Record<string, number | string>[] = points.map((p) => ({
      x: fmtD(parseD(p.date), dateFmt),
      date: p.date,
      ...(mode === "TRY"
        ? { value: toCcy(p.value), contributed: toCcy(p.contributed) }
        : { total: r2(twrAt.get(p.date) ?? 0) }),
    }));
    for (const k of on) {
      const series = mode === "TRY"
        ? symbolValueHistory(trades, priceHistory, rates, k)
        /* % modunda sembol serisi SAF FİYAT getirisidir: pozisyon değerini yüzdeye çevirmek
           üstüne alım yapmayı "kazanç" gibi gösterirdi. */
        : rebasePct(sliceValueHistory(symbolPriceSeries(priceHistory, k), range));
      for (const pt of series) {
        const i = idx.get(pt.date);
        if (i != null) out[i][k] = mode === "TRY" ? toCcy(pt.value) : r2(pt.value);
      }
    }
    /* Referanslar yalnız % modunda: TL cinsinden endeks SEVİYESİ (14.641 puan) ile portföy
       değeri aynı eksende okunmaz — kıyaslama zaten yüzdede anlamlı. */
    for (const k of activeRefs) {
      const series = rebasePct(sliceValueHistory(benchmarkSeries(benchmarks, k), range));
      for (const pt of series) {
        const i = idx.get(pt.date);
        if (i != null) out[i][`b:${k}`] = r2(pt.value);
      }
    }
    return out;
  }, [points, twr, on, activeRefs, benchmarks, mode, range, dateFmt, trades, priceHistory, rates, ccy]);

  /* Dönem ayrışması: değerdeki değişim = bu dönemde konan para + bu dönemde kazanılan. */
  const first = points[0], last = points.at(-1);
  /* Rakamlar TRY hesaplanıp GÖRÜNTÜ para birimine çevrilir. Çevirmeyi atlamak, $ seçiliyken
     TL büyüklüğünü dolar işaretiyle yazmak demekti. */
  const d = first && last
    ? {
        value: toCcy(last.value - first.value),
        contributed: toCcy(last.contributed - first.contributed),
        gain: toCcy(last.gain - first.gain),
      }
    : null;
  /* Dönem farkının yanına ÖMÜR BOYU rakam: "bu ay hareket yok" ile "hiç para koymadım"
     karışmasın (dönem özeti tek başına 0 gösterip ikincisi gibi okunuyordu). Son fiyat
     gününe kadarki tüm işlemleri kapsar — grafiğin başlangıcından öncekiler dahil. */
  const lastAll = all.at(-1) ?? null, lastCov = cov.at(-1) ?? null;
  /* Katkı fiyattan BAĞIMSIZDIR (saf işlem matematiği) → her zaman gösterilebilir. Kâr ise
     değerlemeye dayanır: son gün kapsam dışıysa (fiyatı bilinmeyen açık pozisyon) `value`
     eksik çıkar ve kâr uçuk bir eksi olur — ilk denemede stub'da "−₺254.368" böyle çıktı.
     Bu yüzden kâr YALNIZ son gün tam kapsanmışsa yazılır; ikisi de aynı güne aittir. */
  const life = lastAll
    ? {
        contributed: toCcy(lastAll.contributed),
        gain: lastCov && lastCov.date === lastAll.date ? toCcy(lastCov.gain) : null,
      }
    : null;
  const up = (d?.value ?? 0) >= 0;
  const gainUp = (d?.gain ?? 0) >= 0;
  const twrPct = twr.at(-1)?.value ?? null;
  /* Kuruş altı hareketi "para yatırdın" diye göstermemek için eşik: rakam zaten tam sayı yazılıyor.
     Sıfır olması bir kusur DEĞİL — dönemde alım-satım yapmadıysan değişimin tamamı kârdır. */
  const noFlow = Math.abs(d?.contributed ?? 0) < 0.5;

  const emptyHint = all.length === 0
    ? "Fiyat geçmişi birikince burada bir grafik görünecek — fiyatları birkaç gün yeniledikçe dolar."
    : `Bu aralıkta kayıt yok (toplam ${all.length} günlük geçmiş var). Daha geniş bir aralık seç.`;

  const money = (v: number) => `${v >= 0 ? "+" : "−"}${fmtMoney(Math.abs(v), ccy)}`;
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}%${Math.abs(v).toFixed(1).replace(".", ",")}`;
  const labelOf = (n: string) =>
    n === "value" ? "Değer" : n === "contributed" ? "Yatırdığın para" : n === "total" ? "Portföy (TWR)"
    : n.startsWith("b:") ? benchmarkLabel(n.slice(2)) : n.split(":")[1];

  return (
    <div style={{ ...css.card, paddingBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          {scopeLabel && <span style={{ fontSize: 12, color: T.mut }}>— {scopeLabel}</span>}
          {d && <span style={{ ...css.mono, fontSize: 12.5, color: up ? T.pos : T.neg }}>{up ? "▲" : "▼"} {money(d.value)}</span>}
        </div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {RANGES.map((r) => (
            <button key={r.v} type="button" onClick={() => setRange(r.v)} style={{
              padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
              fontWeight: range === r.v ? 700 : 500,
              background: range === r.v ? T.panel : T.panel2, color: range === r.v ? T.acc : T.mut,
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Görünümü değiştiren kontroller süzgeç şeridinde (Faz 24 kuralı: filtre ≠ eylem) */}
      <FiltreSeridi sag={
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {/* Etiketlerde ₺ YOK: display fontu bu glifi taşımıyor, £ olarak çiziliyor (ekran
              denetiminde görüldü). Para birimi zaten eksende ve tutarlarda yazıyor. */}
          {([["TRY", "Değer"], ["PCT", "Getiri %"]] as [Mode, string][]).map(([m, lbl]) => (
            <button key={m} type="button" onClick={() => setMode(m)} style={{
              padding: "4px 9px", border: "none", cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
              fontWeight: mode === m ? 700 : 500,
              background: mode === m ? T.panel : "transparent", color: mode === m ? T.acc : T.mut,
            }}>{lbl}</button>
          ))}
        </div>
      }>
        <span style={{ fontSize: 11.5, color: T.mut3 }}>varlıklar:</span>
        {held.length === 0 && <span style={{ fontSize: 11.5, color: T.mut3 }}>elde varlık yok</span>}
        {held.map((h) => {
          const active = on.includes(h.key);
          return (
            <button key={h.key} type="button" onClick={() => toggle(h.key)} title={h.asset_type} style={{
              padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontFamily: T.mono,
              border: `1px solid ${active ? colorOf(h.key) : T.line}`,
              background: active ? T.panel : "transparent",
              color: active ? colorOf(h.key) : T.mut,
              fontWeight: active ? 700 : 500,
              textDecoration: active ? "none" : "line-through",
              opacity: active ? 1 : .75,
            }}>{h.symbol}</button>
          );
        })}
        {mode === "PCT" && refKeys.length > 0 && <>
          <span style={{ fontSize: 11.5, color: T.mut3, marginLeft: 6 }}>referans:</span>
          {refKeys.map((k) => {
            const active = ref.includes(k);
            return (
              <button key={k} type="button" onClick={() => toggleRef(k)} style={{
                padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
                border: `1px dashed ${active ? refColorOf(k) : T.line}`,
                background: active ? T.panel : "transparent",
                color: active ? refColorOf(k) : T.mut,
                fontWeight: active ? 700 : 500,
                textDecoration: active ? "none" : "line-through",
                opacity: active ? 1 : .75,
              }}>{benchmarkLabel(k)}</button>
            );
          })}
        </>}
      </FiltreSeridi>

      {points.length < 2 || !d ? (
        <Empty>{emptyHint}</Empty>
      ) : (<>
        {/* Bu iki rakam SEÇİLİ DÖNEMİN farkıdır, ömür boyu toplam değil. Bunu yazmak şart:
            dönem içinde hiç alım-satım yoksa para hareketi sıfırdır ve etiketsiz bir
            "YATIRDIĞIN PARA ₺0", "hiç yatırım yapmamışım" diye okunuyordu. */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline", margin: "0 2px 10px" }}>
          <span style={{ fontSize: 10.5, color: T.mut3, letterSpacing: .3 }}>SEÇİLİ DÖNEMDE</span>
          <div>
            <div style={{ fontSize: 10.5, color: T.mut3, letterSpacing: .3 }}>KÂR / ZARAR</div>
            <div style={{ ...css.mono, fontSize: 14, fontWeight: 700, color: gainUp ? T.pos : T.neg }}>
              {money(d.gain)}
              {twrPct != null && <span style={{ color: T.mut, fontWeight: 500, fontSize: 11.5, marginLeft: 6 }}>({pct(twrPct)})</span>}
            </div>
          </div>
          <div>
            {/* Etiket işarete göre değişir: negatif bir "eklenen para" okunmuyordu */}
            <div style={{ fontSize: 10.5, color: T.mut3, letterSpacing: .3 }}>
              {noFlow ? "PARA GİRİŞ-ÇIKIŞI" : d.contributed > 0 ? "YATIRDIĞIN PARA" : "ÇEKTİĞİN PARA"}
            </div>
            <div style={{ ...css.mono, fontSize: 14, fontWeight: 700, color: T.mut }}>
              {noFlow ? "yok" : fmtMoney(Math.abs(d.contributed), ccy)}
            </div>
          </div>
        </div>

        {life && (
          <div style={{ fontSize: 11, color: T.mut3, margin: "-6px 2px 10px" }}>
            {/* Tutarlar MONO fontta: display fontu ₺ glifini taşımıyor, £ çiziyor (ikinci kez
                aynı tuzağa düşüldü — para yazan her yer mono olmalı). */}
            başından beri:{" "}
            <b style={{ ...css.mono, color: T.mut }}>
              {Math.abs(life.contributed) < 0.5 ? "para girişi yok"
                : `${fmtMoney(Math.abs(life.contributed), ccy)} ${life.contributed > 0 ? "yatırdın" : "net çektin"}`}
            </b>
            {life.gain != null && <>
              {" · "}kâr/zarar{" "}
              <b style={{ ...css.mono, color: life.gain >= 0 ? T.pos : T.neg }}>{money(life.gain)}</b>
            </>}
          </div>
        )}

        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="dgv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={gainUp ? T.pos : T.neg} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={gainUp ? T.pos : T.neg} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
              <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => (mode === "PCT" ? `%${Math.round(v)}` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
                labelStyle={{ color: T.mut }}
                labelFormatter={(_l, p) => (p?.[0]?.payload ? fmtD(parseD(p[0].payload.date), { day: "numeric", month: "long", year: "numeric" }) : "")}
                formatter={(v: number, n: string) => [mode === "PCT" ? pct(v) : fmtMoney(v, ccy), labelOf(n)]} />

              {mode === "TRY" ? <>
                <Area type="monotone" dataKey="value" stroke={gainUp ? T.pos : T.neg} strokeWidth={2} fill="url(#dgv)" />
                {/* Yatırdığın para: bir EŞİK çizgisidir, ayrı bir varlık değil — üstündeysen kârdasın */}
                <Line type="monotone" dataKey="contributed" stroke={T.mut} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </> : <>
                <ReferenceLine y={0} stroke={T.line2 ?? T.line} />
                <Line type="monotone" dataKey="total" stroke={T.acc} strokeWidth={2.4} dot={false} />
              </>}

              {on.map((k) => (
                <Line key={k} type="monotone" dataKey={k} stroke={colorOf(k)} strokeWidth={1.6} dot={false} connectNulls />
              ))}
              {/* Referanslar KESİKLİ: senin varlığın değil, ölçüt oldukları bakışta belli olsun */}
              {activeRefs.map((k) => (
                <Line key={k} type="monotone" dataKey={`b:${k}`} stroke={refColorOf(k)} strokeWidth={1.5}
                  strokeDasharray="5 4" dot={false} connectNulls />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div style={{ fontSize: 11, color: T.mut3, padding: "6px 2px 4px" }}>
          {mode === "TRY"
            ? <><span style={{ color: T.mut }}>▬</span> değer · <span style={{ color: T.mut }}>┄</span> yatırdığın para — aradaki fark kârdır</>
            : <><span style={{ color: T.acc }}>▬</span> portföy (para giriş-çıkışı arındırılmış) · varlıklar saf fiyat getirisi · referanslar kesikli, TL cinsinden</>}
          {" · "}{points.length} gün{ccy !== "TRY" && mode === "TRY" ? ` · ${ccy} karşılığı güncel kurla` : ""}
          {strict && dropped > 0 && <> · fiyatı eksik {dropped} gün çizilmedi</>}
          {!strict && dropped > 0 && <span style={{ color: T.neg }}> · dikkat: bu aralıkta tuttuğun bazı varlıkların fiyat geçmişi yok — seri eksik değerlenmiş olabilir</span>}
        </div>

        <Aciklama k="deger-grafigi" label="bu grafik ne söylüyor?">
          <b>Değer</b> modunda kesikli çizgi, o güne kadar portföye <b>net koyduğun paradır</b>
          (alışlar ekler; satış ve temettü çıkarır). Değer eğrisi bunun üstündeyse kârdasın, altındaysa zararda —
          yani grafiğin yükselmesi tek başına kazandığın anlamına gelmez, para da eklemiş olabilirsin.
          Dönem özetindeki <b>kâr/zarar</b> ile <b>yatırdığın/çektiğin para</b> tam olarak bu ikisini ayırır.
          Bu iki rakam <b>seçili dönemin farkıdır</b>, ömür boyu toplam değil: o aralıkta hiç alım-satım
          yapmadıysan para hareketi <b>yok</b> yazar ve değişimin tamamı kârdır — daha eski alımların
          grafiğin başladığı noktaya zaten dahildir.
          <br /><br />
          <b>Getiri %</b> modunda portföy çizgisi <b>TWR</b>'dir: para ekleyip çekmenin etkisi arındırılır,
          geriye yalnız yatırım kararlarının getirisi kalır. Varlık çizgileri ise <b>saf fiyat getirisidir</b>
          (üstüne alım yapman o çizgiyi yükseltmez). Yukarıdaki çiplerden istediğin varlığı açıp kapatabilirsin.
          <br /><br />
          <b>Referanslar</b> (BIST 100, S&amp;P 500, NASDAQ, gram altın, dolar) kesikli çizilir ve
          hepsi <b>TL cinsindendir</b> — dolar bazlı endeksler o günün kuruyla çevrilmiştir, yani
          "S&amp;P 500 yerine TL'mi orada tutsaydım" sorusunun cevabıdır. Portföyün TL tabanlı olduğu
          için karşılaştırma ancak böyle dürüst olur.
        </Aciklama>
      </>)}
    </div>
  );
}
