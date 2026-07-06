export type Account = { id: number; name: string; balance: number };
export type Recurring = { id: number; kind: "income" | "expense"; name: string; amount: number; day: number; from_month: string | null; to_month: string | null };
export type Loan = { id: number; name: string; amount: number; first_date: string; total: number };
export type OneOff = { id: number; date: string; name: string; amount: number };
export type AssetType = "BIST" | "FON" | "ALTIN" | "DOVIZ" | "KRIPTO";
export type Trade = { id: number; date: string; asset_type: AssetType; symbol: string; side: "ALIŞ" | "SATIŞ"; qty: number; price: number; fee: number };
export type Card = { id: number; name: string; limit_amount: number; statement_day: number; due_day: number };
export type CardTx = { id: number; card_id: number; date: string; name: string; amount: number; installments: number };
export type Price = { symbol: string; asset_type: string; price: number; source: string; updated_at: string };
export type AllData = {
  accounts: Account[]; recurring: Recurring[]; loans: Loan[]; oneoffs: OneOff[];
  trades: Trade[]; cards: Card[]; card_txs: CardTx[]; prices: Price[]; settings: Record<string, string>;
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as any).error || r.statusText);
  return r.json();
}
export const api = {
  all: () => fetch("/api/all").then((r) => j<AllData>(r)),
  post: (route: string, body: unknown) =>
    fetch(`/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j),
  put: (route: string, body: unknown) =>
    fetch(`/api/${route}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j),
  del: (route: string, id: number) => fetch(`/api/${route}/${id}`, { method: "DELETE" }).then(j),
  refreshPrices: () => fetch("/api/prices/refresh", { method: "POST" }).then(j),
};
