/* ============================================================================
   Onay kartı önizlemesi (Faz 22; E2EE aşama 4'te saf fonksiyon oldu)
   ----------------------------------------------------------------------------
   Tutarı modelin değil SİSTEMİN hesapladığı araçlarda plan aşamasında aynı hesap
   SALT OKUNUR yapılıp özete yazılır ("tutar: 3.200,00 ₺", "bu ekstre zaten ödenmiş").
   "Tutar sistemde hesaplanır" yazan bir onay, görülmeden verilen onaydır.
   Matematik engine'de — uygulama anında yazılan tutar da aynı fonksiyondan gelir. */

import { statementAmount, recurringAmountIndex, recAmountOn, accountBalance, type AllData } from "@finans/engine";
import type { ArgVals } from "./tools.js";

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

type Enricher = (data: AllData, args: ArgVals) => string | null;

export const ENRICHERS: Record<string, Enricher> = {
  /* Ekstre ödemesi: o vadeye düşen taksit paylarının toplamı + zaten ödenmiş mi */
  ekstre_ode(data, a) {
    const card = data.cards.find((c) => c.id === Number(a.id));
    if (!card) return null;
    const due = String(a.due ?? "");
    const amount = statementAmount(card, data.card_txs.filter((t) => t.card_id === card.id), due);
    if (!(amount > 0)) return "bu vadede ekstre yok";
    const paid = (data.statement_payments ?? []).some((p) => p.card_id === card.id && p.due === due);
    return `tutar: ${tl(amount)}${paid ? " (bu ekstre zaten ödenmiş görünüyor)" : ""}`;
  },

  /* Düzenli kalemin gerçekleştirilmesi: tutar o ayın zaman çizelgesinden çözülür */
  duzenli_kalem_gerceklestir(data, a) {
    const r = data.recurring.find((x) => x.id === Number(a.id));
    if (!r) return null;
    const ym = String(a.ym ?? "");
    const amount = recAmountOn(recurringAmountIndex(data.recurring_amounts ?? []).get(r.id), ym);
    if (amount === undefined) return "bu ay için tanımlı tutar yok";
    const done = data.recurring_realized.some((x) => x.recurring_id === r.id && x.ym === ym);
    return `tutar: ${tl(amount)}${done ? " (bu ay zaten gerçekleşmiş)" : ""}`;
  },

  /* Mutabakat: defterdeki bakiye ile bildirilen gerçek bakiye arasındaki fark */
  hesap_mutabakat(data, a) {
    if (!data.accounts.some((x) => x.id === Number(a.id))) return null;
    const mevcut = accountBalance(data.account_entries, Number(a.id));
    const diff = Number(a.balance) - mevcut;
    if (!Number.isFinite(diff)) return null;
    if (Math.abs(diff) < 0.005) return `sistemdeki bakiye zaten ${tl(mevcut)} — fark yok, yalnız doğrulama damgası atılır`;
    return `sistemde ${tl(mevcut)} görünüyor → ${diff > 0 ? "+" : ""}${tl(diff)} düzeltme hareketi yazılır`;
  },
};

/** Özete önizleme bilgisini ekler. Zenginleştirici yoksa/patlarsa özet olduğu gibi kalır —
    onay akışı hiçbir koşulda bu yüzden bozulmamalı. */
export function enrichSummary(data: AllData, tool: string, args: ArgVals, summary: string): string {
  const fn = ENRICHERS[tool];
  if (!fn) return summary;
  try {
    const extra = fn(data, args);
    return extra ? `${summary} · ${extra}` : summary;
  } catch {
    return summary;
  }
}
