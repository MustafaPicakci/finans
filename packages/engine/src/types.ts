export type Account = { id: number; name: string; balance: number };
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
export type Trade = { id: number; date: string; asset_type: AssetType; symbol: string; side: "ALIŞ" | "SATIŞ"; qty: number; price: number; fee: number; currency: Currency; account_id?: number | null };
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
/** Günlük fiyat anlık görüntüsü — her tazelemede/elle girişte o günün satırı upsert edilir */
export type PriceHistoryEntry = { symbol: string; asset_type: AssetType; date: string; price: number; currency?: Currency };
export type AllData = {
  accounts: Account[]; recurring: Recurring[]; loans: Loan[]; oneoffs: OneOff[];
  trades: Trade[]; cards: Card[]; card_txs: CardTx[]; prices: Price[]; price_history: PriceHistoryEntry[];
  categories: Category[]; transactions: Transaction[]; deposits: Deposit[]; recurring_realized: RecurringRealized[]; statement_payments: StatementPayment[]; settings: Record<string, string>;
  recurring_amounts: RecurringAmount[];
};
