/* ============================================================================
   Onay kartı zenginleştiricileri (Faz 22)
   ----------------------------------------------------------------------------
   Bazı araçların tutarını KULLANICI (ve model) vermez, sunucu hesaplar:
   ekstre ödemesinin tutarı ekstre matematiğinden, düzenli kalemin tutarı zaman
   çizelgesinden, mutabakatın farkı mevcut bakiyeden çıkar. Bunlar doğru
   davranıştır (istemciden gelen tutara güvenilmez) ama onay ekranında
   "tutar sunucuda hesaplanır" yazması kötü bir onaydır: kullanıcı neyi
   onayladığını görmeden onaylar.

   Burası o boşluğu kapatır: plan aşamasında, işlemi UYGULAMADAN, aynı hesabı
   yapıp özete yazar ("tutar: 3.200,00 ₺"). Salt okunurdur — hiçbir şey yazmaz.
   Uygulama anında tutar yine ucun kendi kodunda hesaplanır; buradaki sayı
   önizlemedir (arada bir harcama daha girerse uç güncel tutarı yazar).

   tools.ts'in saf (db bilmeyen) tarif dosyası olarak kalması için zenginleştirme
   araç adına göre burada eşlenir. */

import { statementAmount, type Card, type CardTx } from "@finans/engine";
import { db } from "../db.js";
import type { ArgVals } from "./tools.js";

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

type Enricher = (uid: number, args: ArgVals) => Promise<string | null>;

export const ENRICHERS: Record<string, Enricher> = {
  /* Ekstre ödemesi: o vadeye düşen taksit paylarının toplamı + zaten ödenmiş mi */
  async ekstre_ode(uid, a) {
    const card = await db.get<Card>("SELECT * FROM cards WHERE id=? AND user_id=?", Number(a.id), uid);
    if (!card) return null;
    const due = String(a.due ?? "");
    const txs = await db.all<CardTx>("SELECT * FROM card_txs WHERE card_id=? AND user_id=?", card.id, uid);
    const amount = statementAmount(card, txs, due);
    if (!(amount > 0)) return "bu vadede ekstre yok";
    const paid = await db.get("SELECT 1 FROM statement_payments WHERE card_id=? AND due=? AND user_id=?", card.id, due, uid);
    return `tutar: ${tl(amount)}${paid ? " (bu ekstre zaten ödenmiş görünüyor)" : ""}`;
  },

  /* Düzenli kalemin gerçekleştirilmesi: tutar o ayın zaman çizelgesinden çözülür */
  async duzenli_kalem_gerceklestir(uid, a) {
    const r = await db.get<{ id: number; kind: string }>("SELECT id, kind FROM recurring WHERE id=? AND user_id=?", Number(a.id), uid);
    if (!r) return null;
    const row = await db.get<{ amount: number }>(
      "SELECT amount FROM recurring_amounts WHERE recurring_id=? AND from_month<=? AND user_id=? ORDER BY from_month DESC LIMIT 1",
      r.id, String(a.ym ?? ""), uid,
    );
    if (!row) return "bu ay için tanımlı tutar yok";
    const done = await db.get("SELECT 1 FROM recurring_realized WHERE recurring_id=? AND ym=? AND user_id=?", r.id, String(a.ym ?? ""), uid);
    return `tutar: ${tl(row.amount)}${done ? " (bu ay zaten gerçekleşmiş)" : ""}`;
  },

  /* Mutabakat: defterdeki bakiye ile bildirilen gerçek bakiye arasındaki fark */
  async hesap_mutabakat(uid, a) {
    const acc = await db.get<{ balance: number }>("SELECT balance FROM accounts WHERE id=? AND user_id=?", Number(a.id), uid);
    if (!acc) return null;
    const diff = Number(a.balance) - acc.balance;
    if (!Number.isFinite(diff)) return null;
    if (Math.abs(diff) < 0.005) return `sistemdeki bakiye zaten ${tl(acc.balance)} — fark yok, yalnız doğrulama damgası atılır`;
    return `sistemde ${tl(acc.balance)} görünüyor → ${diff > 0 ? "+" : ""}${tl(diff)} düzeltme hareketi yazılır`;
  },
};

/** Özete önizleme bilgisini ekler. Zenginleştirici yoksa/patlarsa özet olduğu gibi kalır —
    onay akışı hiçbir koşulda bu yüzden bozulmamalı. */
export async function enrichSummary(uid: number, tool: string, args: ArgVals, summary: string): Promise<string> {
  const fn = ENRICHERS[tool];
  if (!fn) return summary;
  try {
    const extra = await fn(uid, args);
    return extra ? `${summary} · ${extra}` : summary;
  } catch {
    return summary;
  }
}
