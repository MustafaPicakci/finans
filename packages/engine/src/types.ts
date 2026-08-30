import type { BenchmarkPoint } from "./benchmarks.js";
/** Hesap türü (Faz 16): nakit ve aracı kurum da birer hesaptır — para hiçbir noktada sistemden
    "çıkmasın" diye. ATM'den çekilen para kaybolmaz, `nakit` hesabına virmanlanır; Midas'a atılan
    para kaybolmaz, `araci` hesabına virmanlanır. Tür yalnız gruplama/ikon içindir, matematiği
    değiştirmez — dördü de aynı defter kurallarına tabidir. */
export type AccountKind = "banka" | "nakit" | "araci" | "fon";
/** `last_recon_*`: son mutabakat (Faz 16) — kullanıcının "gerçek bakiye buydu" dediği an ve tutar.
    Fark çıkmışsa 'duzeltme' hareketi yazılır, yani mutabakat sonrası defter her zaman tutar. */
export type Account = {
  id: number; name: string; balance: number; kind?: AccountKind;
  last_recon_date?: string | null; last_recon_balance?: number | null;
};
/** Virman (Faz 16) — kendi hesapların arasında para hareketi. TEK kayıt, İKİ hareket satırı
    (kaynak −, hedef +) yazar; net varlığı ve gelir/gider defterini değiştirmez. Başkasına gönderilen para
    virman DEĞİL giderdir (net varlıktan çıkar) — o `transactions`'ta kalır. */
export type Transfer = {
  id: number; date: string; from_account_id: number; to_account_id: number; amount: number; note?: string | null;
};
/** Düzenli gelir/gider. Opsiyonel hedef (`account_id` VEYA `card_id`; en fazla biri) verilirse günü
    gelince gerçek kayda dönüştürülebilir (transactions / card_txs). `auto` → cron otomatik gerçekleştirir. */
export type Recurring = { id: number; kind: "income" | "expense"; name: string; day: number; from_month: string | null; to_month: string | null; account_id?: number | null; card_id?: number | null; category_id?: number | null; auto?: boolean };
/** Düzenli kalemin tutar zaman çizelgesi: YM ayındaki tutar = from_month <= YM olan en büyük
    from_month'lu satır. from_month REC_AMOUNT_BEGIN ('0000-01') = baştan (PG PK kolonu NULL olamaz). */
export type RecurringAmount = { recurring_id: number; from_month: string; amount: number };
/** Bir recurring kaleminin belirli bir ayının (YYYY-MM) gerçekleştiğini işaretler — tahminde çift sayımı önler */
export type RecurringRealized = { recurring_id: number; ym: string };
export type Loan = { id: number; name: string; amount: number; first_date: string; total: number };
export type OneOff = { id: number; date: string; name: string; amount: number };
export type AssetType = "BIST" | "FON" | "ALTIN" | "DOVIZ" | "KRIPTO" | "ETF";
/** Bir varlığın/işlemin doğal (native) para birimi. TRY taban birimidir; USD döviz varlıklar içindir. */
export type Currency = "TRY" | "USD";
/** Pozisyon üzerindeki hareket türü (Faz 21'de temettü/bedelsiz eklendi).
    `trades` artık salt alım-satım değil, **pozisyon olayları defteridir**:
    - `ALIŞ`/`SATIŞ`  — adet ve maliyet değişir, nakit hareket eder
    - `TEMETTÜ`       — adet DEĞİŞMEZ, maliyet değişmez; nakit girer ve gerçekleşen getiriye yazılır
                        (`qty` = temettü ödenen hisse adedi, `price` = hisse başına NET tutar)
    - `BEDELSİZ`      — adet ARTAR, toplam maliyet AYNI kalır (ortalama maliyet kendiliğinden düşer);
                        nakit hareketi yoktur (`price` her zaman 0) */
export type TradeSide = "ALIŞ" | "SATIŞ" | "TEMETTÜ" | "BEDELSİZ";
export type Trade = { id: number; date: string; asset_type: AssetType; symbol: string; side: TradeSide; qty: number; price: number; fee: number; currency: Currency; account_id?: number | null; portfolio_id?: number | null };
/** Portföy grubu (Faz 11): varlıkları mantıksal olarak ayıran kap ("Alfa Portföy", "Emeklilik").
    Gruplama işlem düzeyindedir — aynı sembol iki portföyde ayrı pozisyon olarak durur. */
export type Portfolio = { id: number; name: string; note: string | null };
/** Vadeli mevduat (TRY): anapara `open_date`'te açılır, `term_days` gün sonra vade dolar.
    Faiz basit (yıllık `rate` %, 365 gün-sayımı); `withholding` = stopaj % (net faize düşer).
    `account_id` verilmişse açılışta anapara o hesaptan düşülür (silinince geri döner). */
export type Deposit = { id: number; name: string; principal: number; rate: number; open_date: string; term_days: number; withholding: number; account_id?: number | null };
/** `pay_account_id` doluysa otomatik ödeme talimatı: vadesi gelen ekstre cron ile o hesaptan ödenir */
export type Card = { id: number; name: string; limit_amount: number; statement_day: number; due_day: number; pay_account_id?: number | null };
export type CardTx = { id: number; card_id: number; date: string; name: string; amount: number; installments: number };
/** Bir kart ekstresinin (card_id + son ödeme günü) ödendiğini işaretler — borçtan ve projeksiyondan düşer */
export type StatementPayment = { card_id: number; due: string };
export type Price = { symbol: string; asset_type: string; price: number; source: string; updated_at: string; currency?: Currency };
export type Category = { id: number; name: string; kind: "income" | "expense"; color: string | null };
/** Gerçekleşen harcama/gelir defteri — projeksiyon sistemine (recurring/loan/card) bağlı değildir */
export type Transaction = { id: number; date: string; name: string; amount: number; category_id: number | null; account_id: number | null };
/** Hesap hareketi (Faz 15) — bakiyeyi oynatan her şey buraya bir satır yazar; değişmez kural:
    hesabın bakiyesi = Σ o hesabın hareketleri (açılış bakiyesi de 'acilis' türünde bir harekettir).
    `kind` hareketin kaynağını anlatır, `source_table`/`source_id` kaynağa geri bağlar (geri alma onu okur). */
export type AccountEntryKind = "islem" | "portfoy" | "mevduat" | "duzeltme" | "acilis" | "virman";
export type AccountEntry = {
  id: number; account_id: number; date: string; amount: number; kind: AccountEntryKind;
  source_table: string | null; source_id: number | null; note: string; created_at: string;
};
/** Günlük fiyat anlık görüntüsü — her tazelemede/elle girişte o günün satırı upsert edilir */
export type PriceHistoryEntry = { symbol: string; asset_type: AssetType; date: string; price: number; currency?: Currency };
export type AllData = {
  accounts: Account[]; recurring: Recurring[]; loans: Loan[]; oneoffs: OneOff[];
  trades: Trade[]; portfolios: Portfolio[]; cards: Card[]; card_txs: CardTx[]; prices: Price[]; price_history: PriceHistoryEntry[];
  categories: Category[]; transactions: Transaction[]; deposits: Deposit[]; recurring_realized: RecurringRealized[]; statement_payments: StatementPayment[]; settings: Record<string, string>;
  recurring_amounts: RecurringAmount[]; account_entries: AccountEntry[]; transfers: Transfer[];
  /** referans endeksler (global, TL'ye çevrilmiş) — bkz. benchmarks.ts.
      Opsiyonel: Faz 27'den önceki bir yanıt (PWA önbelleği, eski sunucu) bu alanı taşımaz. */
  benchmark_history?: BenchmarkPoint[];
};
