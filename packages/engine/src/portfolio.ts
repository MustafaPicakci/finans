import type { AssetType, Currency, Trade, AllData, PriceHistoryEntry } from "./types.js";

export type Position = {
  type: AssetType; sym: string; qty: number; avg: number; realized: number;
  cur: number | null; value: number | null; unreal: number | null; updated: string | null; source: string | null;
  /** Açık K/Z'nin MALİYETE oranı (0.12 = %12). Mutlak tutar tek başına yanıltıcıdır:
      ₺3.000 kâr 10 bin liralık pozisyonda başka, 300 binlik pozisyonda başka şeydir.
      Maliyet 0 ise (ör. tamamı bedelsiz gelen pozisyon) oran tanımsızdır → null. */
  unrealPct: number | null;
  /** Pozisyonun doğal (native) para birimi — avg/cur/value/unreal/realized hep bu birimdedir */
  currency: Currency;
};

/** Bir K/Z tutarının maliyete oranı. Maliyet 0/negatifse oran anlamsızdır (null döner) —
    yüzde hesabı yapan her yer bunu çağırsın, "0'a bölme" her çağrı yerinde ayrı düşünülmesin. */
export function pnlPct(pnl: number, cost: number): number | null {
  return cost > 0 ? pnl / cost : null;
}

/** FX kur seti; şimdilik yalnız USD/TRY. TRY taban birimidir (usdTry = 1 USD kaç TRY). */
export type Rates = { usdTry: number };

/** `amount`'ı `from`'dan `to`'ya çevirir (TRY taban). Kur yoksa/0 ise çeviremezse aynı değeri döner. */
export function convert(amount: number, from: Currency, to: Currency, rates: Rates): number {
  if (from === to) return amount;
  const usdTry = rates.usdTry;
  if (!usdTry || usdTry <= 0) return amount; // kur yok — dönüştürme, çağıran tarafta USD gizli/pasif
  if (from === "USD" && to === "TRY") return amount * usdTry;
  if (from === "TRY" && to === "USD") return amount / usdTry;
  return amount;
}

/* ————— TUTAR ↔ ADET (Faz 17) —————
   Fon işlemlerinde kullanıcının kafasındaki sayı adet değil TUTAR'dır ("50 bin lira fona attım",
   "12.400 lazım, o kadar boz"). Adedi elde hesaplamak (tutar / NAV, NAV ~0,043210) hem zahmetli
   hem yuvarlama hatasına açıktı. `tutar` burada **hesaba giren/çıkan para** olarak tanımlıdır —
   yani sunucudaki bakiye etkisinin (`tradeBalanceDelta`) tam tersi:
     ALIŞ  tutar = qty*price + fee  →  qty = (tutar − fee) / price
     SATIŞ tutar = qty*price − fee  →  qty = (tutar + fee) / price
   Böylece "12.400 gelsin" dendiğinde hesaba kuruşu kuruşuna 12.400 girer. */

/** Tutardan (hesaba giren/çıkan para) adet türetir. Geçersiz girdide 0 döner (form kaydetmez). */
export function qtyFromAmount(side: Trade["side"], amount: number, price: number, fee = 0): number {
  if (!(price > 0) || !Number.isFinite(amount) || !Number.isFinite(fee)) return 0;
  const gross = side === "SATIŞ" ? amount + fee : amount - fee;
  return gross > 0 ? gross / price : 0;
}

/** Adetten tutar (ters yön) — mod değiştirirken girilen değeri korumak için. */
export function amountFromQty(side: Trade["side"], qty: number, price: number, fee = 0): number {
  if (!(qty > 0) || !(price > 0)) return 0;
  return side === "SATIŞ" ? qty * price - fee : qty * price + fee;
}

/* ————— POZİSYON OLAYLARI (Faz 21) —————
   `trades` artık salt alım-satım değil; temettü ve bedelsiz de birer pozisyon olayıdır.
   Adet toplama mantığı ÖNCEDEN dört ayrı yerde tekrarlanıyordu (positions, projection, funds,
   recall) ve hepsi `side === "ALIŞ" ? +qty : -qty` diyordu — yani yeni bir tür eklendiğinde
   temettü sessizce SATIŞ sayılır, pozisyon eksilirdi. Artık tek kaynak: `qtyDelta`. */

/** Bir olayın pozisyon ADEDİNE etkisi. TEMETTÜ adedi değiştirmez; BEDELSİZ artırır. */
export function qtyDelta(t: Pick<Trade, "side" | "qty">): number {
  switch (t.side) {
    case "ALIŞ": case "BEDELSİZ": return t.qty;
    case "SATIŞ": return -t.qty;
    case "TEMETTÜ": return 0;
  }
}

/** Bir olayın NAKDE etkisi (işlemin kendi para biriminde). Sunucudaki `tradeBalanceDelta` ile
    aynı işaret düzenini izler: pozitif = hesaba girer. BEDELSİZ'de para hareketi yoktur. */
export function cashDelta(t: Pick<Trade, "side" | "qty" | "price" | "fee">): number {
  const fee = t.fee || 0;
  switch (t.side) {
    case "ALIŞ": return -(t.qty * t.price + fee);
    case "SATIŞ": case "TEMETTÜ": return t.qty * t.price - fee;
    case "BEDELSİZ": return 0;
  }
}

/** Ağırlıklı ortalama maliyetli portföy; pozisyon kapanıp yeniden açılınca maliyet sıfırlanır.
    Her pozisyon kendi doğal para biriminde (o sembolün işlemlerinin currency'si) hesaplanır. */
export function positions(trades: Trade[], prices: AllData["prices"]): Position[] {
  const pm = new Map(prices.map((p) => [`${p.asset_type}:${p.symbol}`, p]));
  const by = new Map<string, { type: AssetType; sym: string; qty: number; cost: number; realized: number; currency: Currency }>();
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).forEach((t) => {
    const k = `${t.asset_type}:${t.symbol}`;
    if (!by.has(k)) by.set(k, { type: t.asset_type, sym: t.symbol, qty: 0, cost: 0, realized: 0, currency: t.currency ?? "TRY" });
    const p = by.get(k)!;
    if (t.side === "ALIŞ") { p.qty += t.qty; p.cost += t.qty * t.price + (t.fee || 0); }
    else if (t.side === "BEDELSİZ") {
      /* Bedelsiz: adet artar, TOPLAM MALİYET aynı kalır → ortalama maliyet kendiliğinden düşer.
         Yeni hisseler için para ödenmediğinden cost'a dokunulmaz; bu, "bedelsiz sonrası zarardayım"
         yanılsamasını önleyen tek doğru davranıştır. */
      p.qty += t.qty;
    } else if (t.side === "TEMETTÜ") {
      /* Temettü: adet ve maliyet DEĞİŞMEZ; nakit gerçekleşen getiriye yazılır. Maliyetten düşmek
         (bazı takip yöntemlerinin yaptığı gibi) ortalama maliyeti çarpıtır ve satışta gerçekleşen
         K/Z'yi iki kez sayardı — burada temettü ayrı bir getiri kalemidir. */
      p.realized += t.qty * t.price - (t.fee || 0);
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      p.realized += t.qty * (t.price - avg) - (t.fee || 0);
      p.cost -= Math.min(t.qty, p.qty) * avg;
      p.qty -= t.qty;
    }
  });
  return [...by.values()].map((p) => {
    const price = pm.get(`${p.type}:${p.sym}`);
    const cur = price?.price ?? null;
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    const unreal = cur != null && p.qty > 0 ? p.qty * (cur - avg) : null;
    return {
      type: p.type, sym: p.sym, qty: p.qty, avg, realized: p.realized, cur, currency: p.currency,
      value: cur != null ? p.qty * cur : null,
      unreal,
      unrealPct: unreal != null ? pnlPct(unreal, p.qty * avg) : null,
      updated: price?.updated_at ?? null,
      source: price?.source ?? null,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Bir işlemin, gerçekleştiği andaki pozisyona etkisi — işlem geçmişi ekranının satır modeli.
    Tutarlar işlemin kendi para birimindedir (`trade.currency`). */
export type TradeEntry = {
  trade: Trade;
  /** işlemden ÖNCEKİ adet ve ağırlıklı ortalama maliyet (aynı sembol+tür, aynı portföy kapsamında) */
  qtyBefore: number; avgBefore: number;
  /** işlemden SONRAKİ adet ve ortalama maliyet — "ort. 250 → 265" gösterimi buradan gelir */
  qtyAfter: number; avgAfter: number;
  /** ALIŞ'ta ödenen toplam (adet×fiyat + komisyon), SATIŞ'ta ele geçen (adet×fiyat − komisyon) */
  cash: number;
  /** yalnız SATIŞ'ta: adet × (satış − o anki ort. maliyet) − komisyon; ALIŞ'ta 0 */
  realized: number;
  /** SATIŞ pozisyonu tamamen kapattıysa (sonrasında adet 0) — "pozisyon kapandı" rozeti için */
  closed: boolean;
};

/**
 * İşlemleri kronolojik işleyip her birinin pozisyona etkisini çıkarır (Faz 12 — hareket geçmişi).
 * `positions()` ile **aynı** maliyet matematiğini kullanır (ağırlıklı ortalama, kapanınca sıfırlanma),
 * farkı: sonucu değil ara adımları verir — "hangi hisse ne zaman eklendi/çıkarıldı, ortalama nasıl değişti".
 *
 * Kapsam çağıranındır: tüm işlemleri verirsen birleşik defter, tek portföyün işlemlerini verirsen
 * o portföyün defteri çıkar (grup başına ayrı ortalama maliyet — bkz. `groupTradesByPortfolio`).
 * Dönüş sırası **kronolojiktir** (eski → yeni); ekranda ters çevrilir.
 */
export function tradeLedger(trades: Trade[]): TradeEntry[] {
  const st = new Map<string, { qty: number; cost: number }>();
  return [...trades]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((t) => {
      const k = `${t.asset_type}:${t.symbol}`;
      if (!st.has(k)) st.set(k, { qty: 0, cost: 0 });
      const p = st.get(k)!;
      const qtyBefore = p.qty;
      const avgBefore = p.qty > 0 ? p.cost / p.qty : 0;
      const fee = t.fee || 0;
      let realized = 0;
      let cash: number;
      if (t.side === "ALIŞ") {
        cash = t.qty * t.price + fee;
        p.qty += t.qty;
        p.cost += cash;
      } else if (t.side === "BEDELSİZ") {
        cash = 0;            // para ödenmez
        p.qty += t.qty;      // maliyet sabit → ortalama düşer (avgAfter aşağıda yeniden hesaplanır)
      } else if (t.side === "TEMETTÜ") {
        cash = t.qty * t.price - fee;
        realized = cash;     // adet ve maliyet değişmez; tamamı gerçekleşen getiridir
      } else {
        cash = t.qty * t.price - fee;
        realized = t.qty * (t.price - avgBefore) - fee;
        p.cost -= Math.min(t.qty, p.qty) * avgBefore;
        p.qty -= t.qty;
      }
      return {
        trade: t, qtyBefore, avgBefore, qtyAfter: p.qty,
        avgAfter: p.qty > 0 ? p.cost / p.qty : 0,
        cash, realized, closed: t.side === "SATIŞ" && p.qty <= 0,
      };
    });
}

/** Bir işlem kümesinin dönem özeti — geçmiş ekranının başlık rakamları (tek para biriminde toplanır).
    `dividend` (Faz 21) `realized`'ın İÇİNDE de sayılır; ayrı alan "bu getirinin ne kadarı temettüden
    geldi" sorusunu cevaplar (satış kârından ayrı bir kalite göstergesidir). */
export type TradeSummary = { buy: number; sell: number; fee: number; realized: number; dividend: number; count: number };

/** `entries` tek para birimi içindir (ekran birime göre süzer); TRY/USD karışımı çağıran tarafta ayrılır. */
export function summarizeTrades(entries: TradeEntry[]): TradeSummary {
  return entries.reduce<TradeSummary>((s, e) => ({
    buy: s.buy + (e.trade.side === "ALIŞ" ? e.cash : 0),
    sell: s.sell + (e.trade.side === "SATIŞ" ? e.cash : 0),
    fee: s.fee + (e.trade.fee || 0),
    realized: s.realized + e.realized,
    dividend: s.dividend + (e.trade.side === "TEMETTÜ" ? e.cash : 0),
    count: s.count + 1,
  }), { buy: 0, sell: 0, fee: 0, realized: 0, dividend: 0, count: 0 });
}

/** Portföy grubu anahtarı: grup id'si, gruplanmamış işlemler için `null` */
export type PortfolioKey = number | null;

/**
 * İşlemleri portföy grubuna göre ayırır (Faz 11). Pozisyonlar grup başına **ayrı** hesaplanır:
 * aynı sembol iki portföyde tutuluyorsa iki bağımsız pozisyondur (ayrı ortalama maliyet, ayrı K/Z) —
 * kullanıcı onları farklı kurumda/stratejide tuttuğu için ayırmıştır, tek pozisyona katlamak yanıltır.
 * Toplam (net varlık) tarafında bir şey değişmez: tüm işlemler tek listede değerlenmeye devam eder.
 */
export function groupTradesByPortfolio(trades: Trade[]): Map<PortfolioKey, Trade[]> {
  const by = new Map<PortfolioKey, Trade[]>();
  for (const t of trades) {
    const k: PortfolioKey = t.portfolio_id ?? null;
    const list = by.get(k);
    if (list) list.push(t); else by.set(k, [t]);
  }
  return by;
}

/** Bir portföy grubunun güncel TRY değeri — grup başlıklarındaki toplam için. */
export function portfolioGroupValueTry(trades: Trade[], prices: AllData["prices"], rates: Rates): number {
  return portfolioValueTry(positions(trades, prices), rates);
}

/** Pozisyon değerlerini (her biri kendi biriminde) TRY'ye çevirip toplar — net varlık ve alokasyon için. */
export function portfolioValueTry(pos: Position[], rates: Rates): number {
  return pos.reduce((s, p) => s + (p.value != null ? convert(p.value, p.currency, "TRY", rates) : 0), 0);
}

export type ValuePoint = { date: string; value: number };

/* ————— DEĞER GRAFİĞİ ARALIKLARI (Faz 13) —————
   Fiyat geçmişi günde bir anlık görüntü tutar (`price_history`), dolayısıyla en küçük çözünürlük
   GÜNDÜR — "1H/1A/1Y" pencereyi daraltır, veriyi sıklaştırmaz. Uzun pencerelerde nokta sayısı
   `bucketValueHistory` ile seyreltilir (her kovanın SON değeri = o haftanın/ayın kapanışı). */

/** Grafik zaman aralığı; `"TÜM"` = eldeki tüm geçmiş */
export type HistoryRange = "1H" | "1A" | "3A" | "6A" | "1Y" | "TÜM";

/** Aralığın gün karşılığı (takvim ayı değil sabit gün — grafik penceresi için yeterli) */
const RANGE_DAYS: Record<Exclude<HistoryRange, "TÜM">, number> = {
  "1H": 7, "1A": 30, "3A": 90, "6A": 180, "1Y": 365,
};

/** `points`'i son N güne kısar (kronolojik sırayı korur). `today` verilmezse bugün. */
export function sliceValueHistory<P extends ValuePoint>(points: P[], range: HistoryRange, today = new Date()): P[] {
  if (range === "TÜM") return points;
  const from = new Date(today);
  from.setDate(from.getDate() - RANGE_DAYS[range]);
  const iso = from.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= iso);
}

/**
 * Nokta sayısını en çok `maxPoints`'e indirir: seri eşit kovalara bölünür, her kovadan o kovanın
 * **son** noktası alınır (kapanış mantığı). İlk ve son nokta her zaman korunur — aralık başı/sonu
 * kayarsa "dönem değişimi" yanlış çıkardı.
 */
export function bucketValueHistory<P extends ValuePoint>(points: P[], maxPoints: number): P[] {
  if (maxPoints < 2 || points.length <= maxPoints) return points;
  const size = points.length / maxPoints;
  const out: P[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const end = Math.min(points.length - 1, Math.floor((i + 1) * size) - 1);
    const p = points[Math.max(end, 0)];
    if (p && out.at(-1)?.date !== p.date) out.push(p);
  }
  if (out.at(-1)?.date !== points.at(-1)!.date) out.push(points.at(-1)!);
  if (out[0]?.date !== points[0].date) out.unshift(points[0]);
  return out;
}

/** Aralığın ilk → son değişimi (mutlak + yüzde). Nokta yoksa/başlangıç 0 ise `pct` null. */
export function historyChange(points: ValuePoint[]): { abs: number; pct: number | null } {
  if (points.length < 2) return { abs: 0, pct: null };
  const first = points[0].value, last = points.at(-1)!.value;
  return { abs: last - first, pct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null };
}

type DayWalk = { date: string; value: number; contributed: number; covered: boolean };

/**
 * Fiyat geçmişini gün gün yürür; her gün için portföy değeri (TRY), o güne dek konan net para
 * ve kapsam bayrağını üretir. Değer grafiği ve kâr/katkı ayrışması aynı yürüyüşü paylaşır —
 * iki kopya olsaydı biri TEMETTÜ gibi yeni bir olay türünde sessizce ayrışırdı.
 *
 * Her sembol için o günden önceki (dahil) en yakın bilinen fiyat kullanılır (forward-fill);
 * fiyatı hiç bilinmeyen AÇIK pozisyon o güne 0 katkı verir ve günü `covered:false` yapar.
 * USD-doğal semboller **güncel** FX ile TRY'ye çevrilir (tarihsel FX tutulmuyor — takvimdeki
 * mevcut yaklaşımla tutarlı).
 *
 * Adet, katkı ve fiyat imleçleri gün ilerledikçe ARTIMLI güncellenir: her gün için tüm
 * işlemleri ve fiyat geçmişini baştan taramak, geçmiş yıllar doldurulunca hissedilir olurdu.
 */
function walkValueHistory(trades: Trade[], priceHistory: PriceHistoryEntry[], rates: Rates): DayWalk[] {
  const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const curOf = new Map<string, Currency>(trades.map((t) => [`${t.asset_type}:${t.symbol}`, t.currency ?? "TRY"]));
  const histBySymbol = new Map<string, { date: string; price: number }[]>();
  priceHistory.forEach((h) => {
    const k = `${h.asset_type}:${h.symbol}`;
    let arr = histBySymbol.get(k);
    if (!arr) histBySymbol.set(k, (arr = []));
    arr.push({ date: h.date, price: h.price });
  });
  histBySymbol.forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));

  const dates = [...new Set(priceHistory.map((h) => h.date))].sort();
  const qty = new Map<string, number>();
  const cursor = new Map<string, number>(); // sembol → histBySymbol içindeki son geçerli indeks
  let ti = 0, contributed = 0;

  return dates.map((date) => {
    for (; ti < sortedTrades.length && sortedTrades[ti].date <= date; ti++) {
      const t = sortedTrades[ti];
      const k = `${t.asset_type}:${t.symbol}`;
      qty.set(k, (qty.get(k) || 0) + qtyDelta(t));
      contributed += convert(-cashDelta(t), t.currency ?? "TRY", "TRY", rates);
    }
    let value = 0, covered = true;
    qty.forEach((q, k) => {
      if (q <= 0) return; // kapalı pozisyon kapsamı etkilemez
      const hist = histBySymbol.get(k);
      let i = cursor.get(k) ?? -1;
      while (hist && i + 1 < hist.length && hist[i + 1].date <= date) i++;
      cursor.set(k, i);
      if (!hist || i < 0) { covered = false; return; } // fiyatı bilinmeyen AÇIK pozisyon
      value += convert(q * hist[i].price, curOf.get(k) ?? "TRY", "TRY", rates);
    });
    return { date, value, contributed, covered };
  });
}

/** Portföy değerinin gün gün seyri (TRY). Kapsamı eksik günler de döner — geriye dönük
    uyumluluk; kapsam ayrımı isteyen `portfolioValueDecomposition` + `coveredOnly` kullanır. */
export function portfolioValueHistory(trades: Trade[], priceHistory: PriceHistoryEntry[], rates: Rates): ValuePoint[] {
  return walkValueHistory(trades, priceHistory, rates).map(({ date, value }) => ({ date, value }));
}

/* ————— KÂR mı, PARA EKLEME mi? (Faz 27) —————
   Değer grafiği tek başına "portföyüm 40 bin ₺ arttı" der ama bunun ne kadarının KÂR, ne
   kadarının yeni para koymak olduğunu söylemez — grafiğe bakıp kendi performansını göremezsin.
   Çözüm ek veri gerektirmiyor: portföye konan net para zaten `cashDelta`'nın tersidir
   (ALIŞ hesaptan çıkar = portföye girer). Kümülatif katkı çizilince değerle arasındaki
   boşluk doğrudan kâr/zarardır.

   TEMETTÜ'nün katkıyı AZALTMASI kasıtlıdır: 100 ₺ koyup 5 ₺ temettü aldıysan ve pozisyon
   hâlâ 100 ₺ ise net koyduğun para 95 ₺'dir, kâr 5 ₺'dir — temettü katkı sayılsaydı
   kâr sıfır görünürdü. BEDELSİZ'de para hareketi yok, katkı değişmez. */

/** Bir günün değeri, o güne dek konan net para ve ikisinin farkı (kâr/zarar). */
export type ValueDecompPoint = ValuePoint & {
  /** o güne dek portföye konan NET para (TRY): ALIŞ +, SATIŞ −, TEMETTÜ − */
  contributed: number;
  /** `value − contributed` — değerin para koymakla açıklanmayan kısmı */
  gain: number;
  /** o gün AÇIK olan her pozisyonun fiyatı biliniyor mu (bkz. `coveredOnly`) */
  covered: boolean;
};

/** Değer + katkı + kâr ayrışması, gün gün. `portfolioValueHistory` ile aynı yürüyüş. */
export function portfolioValueDecomposition(trades: Trade[], priceHistory: PriceHistoryEntry[], rates: Rates): ValueDecompPoint[] {
  return walkValueHistory(trades, priceHistory, rates)
    .map((d) => ({ date: d.date, value: d.value, contributed: d.contributed, gain: d.value - d.contributed, covered: d.covered }));
}

/**
 * Kapsamı eksik günleri ATAR. Kural bilinçli: fiyatı bilinmeyen açık pozisyon o güne 0 katkı
 * verir, yani seri portföyü olduğundan küçük gösterir. Tek bir kaynak (TEFAS) geriye
 * doldurulamadığında bu sessiz eksiklik grafikte **sahte bir sıçramaya** dönüşür — fonların
 * fiyatı başladığı gün toplam birden yukarı zıplar ve kâr gibi okunur. Eksik günü hiç
 * çizmemek, yanlış çizmekten iyidir; kaç gün düştüğü arayüzde söylenir.
 */
export function coveredOnly(points: ValueDecompPoint[]): ValueDecompPoint[] {
  return points.filter((p) => p.covered);
}

/* ————— ÇOKLU SERİ ve GETİRİ (%) MODU (Faz 27) —————
   Tek eksene ₺ değeri ile endeks seviyesi konamaz (14.641 puanlık BIST ile 250.000 ₺'lik
   portföy aynı grafikte okunmaz), bu yüzden karşılaştırma **yüzde** modunda yaşar: her seri
   pencerenin ilk gününe göre 0'dan başlar.

   İki seri türünün matematiği bilinçli olarak FARKLIDIR:
   - Portföy → TWR (zaman ağırlıklı getiri). Basit "değer/değer" oranı, ayın ortasında para
     eklediğinde bunu getiri gibi gösterirdi — kıyaslama anlamsızlaşırdı.
   - Tek sembol / referans → saf FİYAT getirisi. Sembolün değer serisini yüzdeye çevirmek
     yanlış olurdu: üstüne alım yapmak "kazanç" gibi görünürdü. */

/** Bir sembolün pozisyon DEĞERİ (TRY) gün gün — ₺ modunda tek varlık çizgisi için. */
export function symbolValueHistory(trades: Trade[], priceHistory: PriceHistoryEntry[], rates: Rates, key: string): ValuePoint[] {
  return portfolioValueHistory(trades.filter((t) => `${t.asset_type}:${t.symbol}` === key), priceHistory, rates);
}

/** Bir sembolün ham FİYAT serisi (kendi para biriminde) — yüzde modunda rebase edilir. */
export function symbolPriceSeries(priceHistory: PriceHistoryEntry[], key: string): ValuePoint[] {
  return priceHistory
    .filter((h) => `${h.asset_type}:${h.symbol}` === key)
    .map((h) => ({ date: h.date, value: h.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Serinin ilk noktasına göre kümülatif % değişim (ilk nokta = 0). */
export function rebasePct(points: ValuePoint[]): ValuePoint[] {
  const base = points.find((p) => p.value !== 0)?.value;
  if (base == null) return points.map((p) => ({ date: p.date, value: 0 }));
  return points.map((p) => ({ date: p.date, value: (p.value / base - 1) * 100 }));
}

/**
 * Zaman ağırlıklı getiri (TWR): para giriş/çıkışının etkisi ARINDIRILMIŞ kümülatif % getiri.
 * Günlük getiri = (değer − o günkü net akış) / önceki değer; çarpımları zincirlenir. Böylece
 * "ayın 15'inde 50 bin ₺ ekledim" hareketi performans gibi görünmez ve seri S&P/BIST ile
 * gerçekten kıyaslanabilir olur. Değeri 0 olan günler zinciri kırmaz, sadece atlanır
 * (pozisyon tamamen kapanıp yeniden açıldığında bölme tanımsız olurdu).
 *
 * DÜRÜST KISIT: akış, ARALIĞIN SONUNDA olmuş sayılır. Alım-satımın yapıldığı günde bir fiyat
 * anlık görüntüsü yoksa o günün getirisi ayrı bir alt döneme bölünemez ve eklenen paranın
 * kazancı dönem başı sermayenin getirisi gibi sayılır (testte: %21 yerine %32). `price_history`
 * günlük yazıldığı için akış günü pratikte hemen her zaman değerlenmiştir; kısıt yine de burada.
 */
export function twrSeries(points: ValueDecompPoint[]): ValuePoint[] {
  let idx = 1;
  return points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1];
      const flow = p.contributed - prev.contributed; // o gün konan/çekilen net para
      if (prev.value > 0) idx *= (p.value - flow) / prev.value;
    }
    return { date: p.date, value: (idx - 1) * 100 };
  });
}

/** Adedi > 0 olan (yani hâlâ elde tutulan) semboller — grafikteki varlık çipleri bundan çıkar. */
export function heldSymbols(trades: Trade[]): { key: string; symbol: string; asset_type: AssetType }[] {
  const qty = new Map<string, number>();
  for (const t of trades) {
    const k = `${t.asset_type}:${t.symbol}`;
    qty.set(k, (qty.get(k) || 0) + qtyDelta(t));
  }
  return [...qty.entries()]
    .filter(([, q]) => q > 1e-9)
    .map(([key]) => ({ key, symbol: key.split(":")[1], asset_type: key.split(":")[0] as AssetType }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol, "tr"));
}
