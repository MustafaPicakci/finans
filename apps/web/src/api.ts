import type { AllData } from "@finans/engine";

export type { Account, Recurring, Loan, OneOff, AssetType, Currency, Trade, Card, CardTx, Price, AllData } from "@finans/engine";

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
  delPrice: (asset_type: string, symbol: string) =>
    fetch(`/api/prices/${asset_type}/${encodeURIComponent(symbol)}`, { method: "DELETE" }).then(j),
  refreshPrices: () => fetch("/api/prices/refresh", { method: "POST" }).then(j),
};
