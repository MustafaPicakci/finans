import type { AssetType, Currency, Trade, PriceHistoryEntry } from "./types.js";
import { qtyDelta } from "./portfolio.js";

/* ————— FAZ 35: KURUMSAL OLAYLAR (bedelsiz + temettü) —————

   Sorun, bir özellik eksikliği değil SESSİZ BİR HATAYDI: `BEDELSİZ` ve `TEMETTÜ` Faz 21'den beri
   birer pozisyon olayı olarak DURUYOR, ama ikisini de kullanıcının fark edip elle girmesi
   gerekiyordu. Tuttuğun hisse bedelsiz verir de girmezsen adedin eksik kalır ve portföy kendini
   kalıcı olarak düşük gösterir — üstelik fiyat yarıya indiği için düşüş ZARAR gibi okunur.
   Ölçüldü: 30 likit BIST sembolünün 11'inde son 5 yılda bedelsiz var, yani nadir bir kenar
   durum değil.

   Bu dosya YENİ MATEMATİK İÇERMEZ ve bu bilinçlidir (holdings.ts'in aynı gerekçesi): adet
   yürüyüşü `qtyDelta`'dan gelir, ortalama maliyet/gerçekleşen K/Z'ye hiç dokunulmaz. Burada
   yapılan tek iş, piyasanın söylediği olayı (`CorporateAction`) kullanıcının defteriyle
   KARŞILAŞTIRIP eksik kaydı bulmaktır. Öneri üretir, kayıt yazmaz — adet kullanıcının
   defteridir, onay onun.

   BEDELLİ burada YOK ve bu da bilinçli: rüçhan hakkını kullanıp hisse başına bedel ödemek
   matematiksel olarak normal bir ALIŞ'tır (Faz 21 kararı) ve zaten hiçbir veri kaynağı bedelli
   duyurusunu makine okunur vermiyor — arayüzdeki rehberli form onu ALIŞ olarak yazar. */

/** `bolunme`: adet çarpanı (2 = 1:1 bedelsiz) · `temettu`: HİSSE BAŞINA tutar */
export type CorporateActionKind = "bolunme" | "temettu";

/** Piyasadan gelen ham olay (global, kullanıcıdan bağımsız) */
export type CorporateAction = {
  symbol: string;
  asset_type: AssetType;
  /** olayın etkin olduğu gün (ex-date) */
  date: string;
  kind: CorporateActionKind;
  /** bolunme → oran (2.0) · temettu → hisse başına BRÜT tutar */
  value: number;
  currency?: Currency;
};

type OneriBase = { symbol: string; asset_type: AssetType; date: string; currency: Currency };

export type BedelsizOneri = OneriBase & {
  kind: "bedelsiz";
  /** adet çarpanı (2 = adet ikiye katlanır) */
  ratio: number;
  /** olaydan ÖNCE elde olan adet */
  qtyBefore: number;
  /** eklenmesi gereken adet = qtyBefore × (ratio − 1) */
  qty: number;
};

export type TemettuOneri = OneriBase & {
  kind: "temettu";
  /** hisse başına BRÜT tutar (stopaj düşülmemiş — bkz. `brut` notu) */
  perShare: number;
  /** o tarihte elde olan adet */
  qty: number;
  /** qty × perShare (brüt) */
  amount: number;
  /** DRIP açıksa geri yatırım önerisi; fiyat bilinmiyorsa (ya da DRIP kapalıysa) null */
  reinvest: { price: number; qty: number } | null;
};

export type KurumsalOneri = BedelsizOneri | TemettuOneri;

/** Adet karşılaştırmalarında float artığı toleransı (holdings.ts ile aynı) */
const EPS = 1e-9;

const keyOf = (t: { asset_type: string; symbol: string }) => `${t.asset_type}:${t.symbol}`;

/**
 * Kullanıcının defterinde EKSİK olan kurumsal olaylar.
 *
 * Her olay için üç soru sorulur ve üçü de veriye bakar (uydurma yok):
 * 1. Olaydan ÖNCE o sembolde adedin var mıydı? Yoksa olay seni ilgilendirmiyor.
 * 2. Olayı zaten kaydetmiş misin? Kaydettiysen sus.
 * 3. Ne kadar eksik? (bedelsizde adet, temettüde tutar)
 *
 * @param trades   kullanıcının tüm portföy olayları
 * @param actions  piyasadan gelen olaylar (sunucu `corporate_actions`'tan gönderir)
 * @param opts.dripSymbols  temettüsü geri yatırılacak semboller (`TYPE:SYM` ya da düz `SYM`)
 * @param opts.priceHistory geri yatırım fiyatı için; yoksa `reinvest` null kalır
 * @param opts.today        bu günden SONRAKİ olaylar elenir (ileri tarihli duyuru önerilmez)
 */
export function kurumsalOneriler(
  trades: Trade[],
  actions: CorporateAction[],
  opts: { dripSymbols?: Iterable<string>; priceHistory?: PriceHistoryEntry[]; today?: string } = {},
): KurumsalOneri[] {
  if (!actions.length) return [];

  const drip = new Set<string>();
  for (const s of opts.dripSymbols ?? []) drip.add(s.toUpperCase());
  const dripAcik = (a: CorporateAction) => drip.has(keyOf(a).toUpperCase()) || drip.has(a.symbol.toUpperCase());

  /* Sembol başına işlemler, tarihe göre. `positions()` ile AYNI sıralama kuralı
     (tarih, sonra id) — aynı gün iki işlem varsa yürüyüş ikisinde de aynı sırayı görsün. */
  const bySym = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    (bySym.get(k) ?? bySym.set(k, []).get(k)!).push(t);
  }
  for (const list of bySym.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const priceAt = new Map<string, number>();
  for (const p of opts.priceHistory ?? []) priceAt.set(`${p.asset_type}:${p.symbol}:${p.date}`, p.price);

  /* Olaylar sembol başına tarih sırasına dizilir: "bu olayı kaydettin mi?" sorusunun penceresi
     [bu olay, BİR SONRAKİ olay) aralığıdır. Düz "olay tarihinden sonra bir BEDELSİZ var mı"
     ölçütü, iki kez bedelsiz veren bir hissede İKİNCİSİNİ kaydetmiş kullanıcıya birincisini de
     kaydetmiş gibi davranır ve eksik kayıt sessizce gizlenirdi. */
  const byActionSym = new Map<string, CorporateAction[]>();
  for (const a of actions) {
    if (opts.today && a.date > opts.today) continue; // ileri tarihli duyuru: henüz olmadı
    const k = keyOf(a);
    (byActionSym.get(k) ?? byActionSym.set(k, []).get(k)!).push(a);
  }

  const out: KurumsalOneri[] = [];
  for (const [k, list] of byActionSym) {
    const tl = bySym.get(k) ?? [];
    if (!tl.length) continue; // bu sembolde hiç işlem yok
    list.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      /* Pencerenin sonu = AYNI TÜRDEKİ bir sonraki olay. Tür ayrımı şart: bir hisse aynı yıl
         hem bedelsiz hem temettü verir, ikisini tek pencereye koymak birbirini kırpardı. */
      const sonraki = list.find((x, j) => j > i && x.kind === a.kind)?.date ?? null;

      /* 1. Olaydan ÖNCEKİ adet. `t.date < a.date` bilerek KATI: ex-date'te alan kişi o olaya
         hak kazanmaz, hakkı doğuran önceki günün kapanışında elde tutmaktır. */
      let qtyBefore = 0;
      for (const t of tl) { if (t.date >= a.date) break; qtyBefore += qtyDelta(t); }
      if (qtyBefore <= EPS) continue;

      /* 2. Bu olay zaten kaydedilmiş mi? Pencere içinde aynı türden bir kayıt yeter. */
      const beklenenSide = a.kind === "bolunme" ? "BEDELSİZ" : "TEMETTÜ";
      const kayitli = tl.some((t) =>
        t.side === beklenenSide && t.date >= a.date && (sonraki === null || t.date < sonraki));
      if (kayitli) continue;

      const currency = tl[tl.length - 1].currency ?? "TRY";
      if (a.kind === "bolunme") {
        const qty = qtyBefore * (a.value - 1);
        if (qty <= EPS) continue; // oran 1 (ya da altı) — eklenecek adet yok
        out.push({ kind: "bedelsiz", symbol: a.symbol, asset_type: a.asset_type, date: a.date, currency, ratio: a.value, qtyBefore, qty });
      } else {
        const amount = qtyBefore * a.value;
        if (amount <= EPS) continue;
        /* Geri yatırım fiyatı ÖDEME GÜNÜNÜN fiyatıdır, bugünkü değil — parayı o gün almışsın,
           bugünkü fiyatla adet türetmek geçmişi bugüne göre yeniden yazardı (benchmarks.ts'in
           "o günün kuru" kuralının aynısı). Fiyat yoksa öneri tutarı verir, adedi vermez. */
        const px = dripAcik(a) ? priceAt.get(`${a.asset_type}:${a.symbol}:${a.date}`) : undefined;
        out.push({
          kind: "temettu", symbol: a.symbol, asset_type: a.asset_type, date: a.date, currency,
          perShare: a.value, qty: qtyBefore, amount,
          reinvest: px != null && px > 0 ? { price: px, qty: amount / px } : null,
        });
      }
    }
  }
  /* Yeniden eskiye: en taze olay en üstte (kullanıcı en son ne kaçırdığını önce görsün). */
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol));
}

/* ————— BEDELLİ SERMAYE ARTIŞI —————
   Kayıt olarak normal bir ALIŞ'tır (Faz 21) — bu fonksiyon yalnız rehberli formun aritmetiği:
   "%X bedelli" duyurusundan kaç lot alabileceğini ve ne ödeyeceğini çıkarır. Kullanıcı bu iki
   sayıyı elle hesaplayıp forma yazıyordu; hata yapılan yer tam da burasıydı, çünkü oran
   ELDEKİ ADEDE uygulanır (sermayeye değil) ve bedel çoğu zaman nominal ₺1'dir, piyasa fiyatı
   değil — piyasa fiyatını yazmak ortalama maliyeti şişirirdi. */
export type BedelliPlan = {
  /** alınabilecek yeni adet (rüçhan hakkı) */
  qty: number;
  /** ödenecek toplam tutar */
  cost: number;
  /** işlem sonrası toplam adet */
  qtyAfter: number;
};

/**
 * @param qtyBefore elde tutulan adet
 * @param oran      bedelli oranı — %50 için `0.5` (yani her 100 lota 50 yeni lot)
 * @param birimBedel hisse başına ödenecek bedel (genelde nominal 1 ₺)
 */
export function bedelliPlan(qtyBefore: number, oran: number, birimBedel: number): BedelliPlan | null {
  if (!(qtyBefore > 0) || !(oran > 0) || !(birimBedel > 0)) return null;
  /* Küsurat BİLEREK kırpılır: rüçhan hakkı lot bazında kullanılır, 0,4 lot alınamaz. Kalan
     kesir hakkı borsada satılır — bu panelin konusu değil, ama uydurma bir 0,4 lot yazmak
     adedi gerçek hesaptan ayırırdı. */
  const qty = Math.floor(qtyBefore * oran);
  if (qty <= 0) return null;
  return { qty, cost: qty * birimBedel, qtyAfter: qtyBefore + qty };
}

/* ————— DRIP (temettü geri yatırımı) AYARI —————
   `user_settings.drip_symbols` içinde virgülle ayrık `TYPE:SYM` listesi — `cash_funds`
   deseninin aynısı (ayrı tablo açmaya değmeyecek kadar küçük, opt-in bir işaret).
   `cash_funds` düz sembol tutar; burada TÜR de var çünkü aynı sembol iki varlık türünde
   olabilir ve temettü yalnız hisse/ETF'ye özgüdür. Ayrıştırma/yazma burada, çünkü çağrı yeri
   ÜÇ tane (satış formu, pozisyon ayrıntısı, Özet kartı) — üç kopya olsaydı biri büyük/küçük
   harfi ya da boşluğu farklı ele alır ve işaret sessizce "kayıp" görünürdü. */
export const DRIP_KEY = "drip_symbols";

const dripKey = (assetType: string, symbol: string) => `${assetType}:${symbol}`.toUpperCase();

/** Ayar metninden küme (büyük harfe normalize) */
export function dripSet(settings: Record<string, string> | undefined): Set<string> {
  return new Set((settings?.[DRIP_KEY] || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
}

/** Bu sembol için geri yatırım açık mı? */
export function dripAcikMi(settings: Record<string, string> | undefined, assetType: string, symbol: string): boolean {
  return dripSet(settings).has(dripKey(assetType, symbol));
}

/** İşareti ters çevirir ve YENİ ayar metnini döner (çağıran `PUT /api/settings` ile yazar) */
export function dripToggle(settings: Record<string, string> | undefined, assetType: string, symbol: string): string {
  const set = dripSet(settings);
  const k = dripKey(assetType, symbol);
  set.has(k) ? set.delete(k) : set.add(k);
  return [...set].join(",");
}
