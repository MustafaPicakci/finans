import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  fmtD, parseD, convert, portfolioValueDecomposition, coveredOnly, sliceValueHistory, bucketValueHistory,
  twrSeries, twrByRange, rebasePct, heldSymbols, symbolPriceSeries, symbolValueHistory,
  BENCHMARKS, benchmarkSeries, benchmarkLabel,
  type BenchmarkPoint, type Currency, type HistoryRange, type PriceHistoryEntry, type Rates, type Trade,
} from "@finans/engine";
import { T, css, fmtMoney, fmtPct, CATEGORY_PALETTE } from "../../theme";
import { Empty, Aciklama, Modal } from "../../ui";
import { Segment, Anahtar } from "../forms/parcalar";

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

export function DegerGrafigi({ trades, priceHistory, benchmarks = [], rates, ccy, title = "Portföy Değeri", scopeLabel, height = 220, defaultMode = "TRY", altBaslik }: {
  trades: Trade[]; priceHistory: PriceHistoryEntry[]; benchmarks?: BenchmarkPoint[]; rates: Rates; ccy: Currency;
  title?: string; scopeLabel?: string | null; height?: number;
  /** Detay ekranı yüzde modunda açılır: oradaki soru "ne kadar param var" değil
      "nasıl performans gösterdim" — ₺ modu düğmeyle erişilebilir kalır. */
  defaultMode?: Mode;
  altBaslik?: string;
}) {
  const [range, setRange] = useState<HistoryRange>("1A");
  const [mode, setMode] = useState<Mode>(defaultMode);
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

  /* Çiplerin üstündeki rakamlar. Kapsanan seri varsa o kullanılır (fiyatı bilinmeyen açık
     pozisyonlu günler portföyü küçük gösterip getiriyi çarpıtırdı — bkz. coveredOnly);
     yoksa ham seriye düşülür, tıpkı pencere seçiminde olduğu gibi. */
  const rangeTwr = useMemo(
    () => twrByRange(cov.length >= 2 ? cov : all, RANGES.map((r) => r.v)),
    [cov, all],
  );

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
  const gainUp = (d?.gain ?? 0) >= 0;
  const twrPct = twr.at(-1)?.value ?? null;
  /* Kuruş altı hareketi "para yatırdın" diye göstermemek için eşik: rakam zaten tam sayı yazılıyor.
     Sıfır olması bir kusur DEĞİL — dönemde alım-satım yapmadıysan değişimin tamamı kârdır. */
  const noFlow = Math.abs(d?.contributed ?? 0) < 0.5;

  const emptyHint = all.length === 0
    ? "Fiyat geçmişi birikince burada bir grafik görünecek — fiyatları birkaç gün yeniledikçe dolar."
    : `Bu aralıkta kayıt yok (toplam ${all.length} günlük geçmiş var). Daha geniş bir aralık seç.`;

  const money = (v: number) => `${v >= 0 ? "+" : "−"}${fmtMoney(Math.abs(v), ccy)}`;
  const pct = (v: number) => fmtPct(v, 1, true); // tek biçimleyici (theme.ts) — işaret %'in önünde
  const labelOf = (n: string) =>
    n === "value" ? "Değer" : n === "contributed" ? "Yatırdığın para" : n === "total" ? "Portföy (TWR)"
    : n.startsWith("b:") ? benchmarkLabel(n.slice(2)) : n.split(":")[1];

  const [karsilastir, setKarsilastir] = useState(false);
  const secimler = [
    ...on.map((k) => ({ k, ad: k.split(":")[1], renk: colorOf(k), kesik: false, kaldir: () => toggle(k) })),
    ...activeRefs.map((k) => ({ k: `b:${k}`, ad: benchmarkLabel(k), renk: refColorOf(k), kesik: true, kaldir: () => toggleRef(k) })),
  ];

  return (
    <div style={{ ...css.card, paddingBottom: 10 }}>
      {/* Yeniden tasarım (grup 4): başlık | mod; altında dönem kutuları; tek satırlık dönem özeti;
          grafik; karşılaştırılanlar GRAFİĞİN ALTINDA çip olarak. Eskiden her varlık ve referans
          grafiğin üstünde üstü çizili çip olarak duruyordu (20 sembolde 4 satır) — kapalı olan
          seçenekler artık "+ Karşılaştır" sayfasında. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
            {scopeLabel && <span style={{ fontSize: 13, color: T.mut }}> — {scopeLabel}</span>}
          </div>
          {altBaslik && <div style={{ fontSize: 12.5, color: T.mut, marginTop: 2 }}>{altBaslik}</div>}
        </div>
        {/* Etiketlerde ₺ YOK: display fontu bu glifi taşımıyor, £ olarak çiziliyor. */}
        <Segment kucuk ad="Grafik modu" deger={mode} sec={setMode}
          secenek={[{ v: "PCT", l: "Getiri %" }, { v: "TRY", l: "Değer" }]} />
      </div>

      {/* Her kutu KENDİ dönem getirisini de yazar: çıplak "1H / 1A / 3A" etiketleri kullanıcıyı
          tek tek tıklayıp karşılaştırmaya zorluyordu. Rakam TWR'dır — % moduyla aynı hesap.
          Görünümü değiştiren kontrol → çukur şerit, seçili beyaz yüzey (Faz 24 kural 2). */}
      <div role="radiogroup" aria-label="Dönem" style={{
        display: "grid", gridTemplateColumns: `repeat(${RANGES.length}, minmax(0, 1fr))`, gap: 2,
        padding: 3, background: T.panel2, borderRadius: 12, marginBottom: 12,
      }}>
        {RANGES.map((r) => {
          const v = rangeTwr[r.v];
          const secili = range === r.v;
          return (
            <button key={r.v} type="button" role="radio" aria-checked={secili} onClick={() => setRange(r.v)} style={{
              padding: "6px 2px", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: T.disp, minHeight: 0,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1, lineHeight: 1.2, minWidth: 0,
              background: secili ? T.panel : "transparent", boxShadow: secili ? "var(--shadow-sm)" : "none",
              color: secili ? T.acc : T.mut,
            }}>
              <span style={{ fontSize: 13, fontWeight: secili ? 650 : 500 }}>{r.label}</span>
              <span style={{
                ...css.mono, fontSize: 11, whiteSpace: "nowrap",
                color: v == null ? T.mut3 : v > 0 ? T.pos : v < 0 ? T.neg : T.mut3,
              }}>{v == null ? "—" : pct(v)}</span>
            </button>
          );
        })}
      </div>

      {points.length < 2 || !d ? (
        <Empty>{emptyHint}</Empty>
      ) : (<>
        {/* SEÇİLİ DÖNEMİN farkı, ömür boyu toplam değil — "bu dönemde" yazmak şart: dönemde hiç
            alım-satım yoksa para hareketi sıfırdır ve etiketsiz "yatırdığın ₺0" "hiç yatırım
            yapmamışım" diye okunuyordu. Etiket işarete göre değişir (negatif "eklenen para" okunmaz). */}
        <div style={{ fontSize: 13.5, color: T.mut, lineHeight: 1.5 }}>
          Bu dönemde kâr/zarar{" "}
          <b style={{ ...css.mono, fontWeight: 600, whiteSpace: "nowrap", color: gainUp ? T.pos : T.neg }}>{money(d.gain)}</b>
          {twrPct != null && <span style={{ ...css.mono, whiteSpace: "nowrap" }}> ({pct(twrPct)})</span>}
          {" · "}
          {noFlow ? "para giriş-çıkışı yok"
            : <>{d.contributed > 0 ? "yatırdığın" : "çektiğin"} <b style={{ ...css.mono, fontWeight: 600, color: T.text }}>{fmtMoney(Math.abs(d.contributed), ccy)}</b></>}
        </div>
        {life && (
          /* Tutarlar MONO fontta: display fontu ₺ glifini taşımıyor, £ çiziyor */
          <div style={{ fontSize: 12.5, color: T.mut3, marginTop: 2, marginBottom: 8 }}>
            başından beri{" "}
            {Math.abs(life.contributed) < 0.5 ? "para girişi yok"
              : <><span style={{ ...css.mono, whiteSpace: "nowrap" }}>{fmtMoney(Math.abs(life.contributed), ccy)}</span> {life.contributed > 0 ? "yatırdın" : "net çektin"}</>}
            {life.gain != null && <>
              {" · "}kâr/zarar{" "}
              <span style={{ ...css.mono, whiteSpace: "nowrap", color: life.gain >= 0 ? T.pos : T.neg }}>{money(life.gain)}</span>
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

        {/* Karşılaştırılanlar: grafikte AÇIK olanlar çip (renk = çizgi rengi, referans kesikli
            kenarlı), ✕ ile kaldırılır; ekleme "+ Karşılaştır" sayfasından. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
          {secimler.map((x) => (
            <button key={x.k} type="button" onClick={x.kaldir} title={`${x.ad} — grafikten kaldır`} style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 30, minHeight: 0, padding: "0 10px",
              borderRadius: 15, border: `1px ${x.kesik ? "dashed" : "solid"} ${x.renk}`, background: T.panel,
              color: T.text, fontSize: 13, fontFamily: x.kesik ? T.disp : T.mono, cursor: "pointer",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: x.renk }} />
              {x.ad}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.mut} strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          ))}
          {(held.length > 0 || refKeys.length > 0) && (
            <button type="button" onClick={() => setKarsilastir(true)} style={{
              height: 30, minHeight: 0, padding: "0 12px", borderRadius: 15, border: `1px solid ${T.line}`,
              background: T.panel2, color: T.acc, fontSize: 13, fontWeight: 600, fontFamily: T.disp, cursor: "pointer",
            }}>+ Karşılaştır</button>
          )}
        </div>

        <div style={{ fontSize: 12, color: T.mut3, padding: "8px 2px 4px", lineHeight: 1.45 }}>
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
          (üstüne alım yapman o çizgiyi yükseltmez). Grafiğin altındaki <b>+ Karşılaştır</b> ile istediğin varlığı ve referansı ekleyip çıkarabilirsin.
          <br /><br />
          <b>Referanslar</b> (BIST 100, S&amp;P 500, NASDAQ, gram altın, dolar) kesikli çizilir ve
          hepsi <b>TL cinsindendir</b> — dolar bazlı endeksler o günün kuruyla çevrilmiştir, yani
          "S&amp;P 500 yerine TL'mi orada tutsaydım" sorusunun cevabıdır. Portföyün TL tabanlı olduğu
          için karşılaştırma ancak böyle dürüst olur.
        </Aciklama>
      </>)}

      {karsilastir && (
        <Modal title="Karşılaştır" onClose={() => setKarsilastir(false)}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={altBaslikStil}>Varlıklar</div>
              <div style={{ fontSize: 13, color: T.mut, marginBottom: 8 }}>
                {mode === "PCT" ? "saf fiyat getirisi — üstüne alım yapman çizgiyi yükseltmez" : "o varlıktaki pozisyonunun değeri"}
              </div>
              {held.length === 0
                ? <div style={{ fontSize: 13.5, color: T.mut }}>Elde varlık yok.</div>
                : <div style={{ display: "grid", gap: 8 }}>
                  {held.map((h) => (
                    <Anahtar key={h.key} etiket={h.symbol} alt={h.asset_type} acik={on.includes(h.key)} onChange={() => toggle(h.key)} />
                  ))}
                </div>}
            </div>
            {refKeys.length > 0 && (
              <div>
                <div style={altBaslikStil}>Referanslar</div>
                <div style={{ fontSize: 13, color: T.mut, marginBottom: 8 }}>
                  {mode === "PCT" ? "TL cinsinden, o günün kuruyla çevrilmiş — kesikli çizilir" : "yalnız Getiri % modunda çizilir (endeks seviyesi ile portföy değeri aynı eksende okunmaz)"}
                </div>
                <div style={{ display: "grid", gap: 8, opacity: mode === "PCT" ? 1 : 0.5 }}>
                  {refKeys.map((k) => (
                    <Anahtar key={k} etiket={benchmarkLabel(k)} acik={ref.includes(k)} onChange={() => toggleRef(k)} />
                  ))}
                </div>
              </div>
            )}
            <button type="button" onClick={() => setKarsilastir(false)} style={{
              height: 48, border: "none", borderRadius: 13, background: T.acc, color: T.accInk,
              fontFamily: T.disp, fontSize: 15.5, fontWeight: 650, cursor: "pointer",
            }}>Tamam</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const altBaslikStil: React.CSSProperties = { fontWeight: 650, fontSize: 15 };
