/* ============================================================================
   Yazma gövdelerinde TÜRETİLEN tutarlar (E2EE aşama 5a)
   ----------------------------------------------------------------------------
   Bazı uçlar kaydın kendisinden TÜRETİLEN bir tutar yazar: portföy işleminin hesaba
   etkisi (cashDelta), mevduatın açılış hareketi (−anapara), ekstre ödemesinin tutarı
   (statementAmount), düzenli kalemin o ayki işaretli tutarı, mutabakat farkı.
   Aşama 1b'de bunlar istemciye geçti ama sunucuda YEDEK olarak kaldılar, çünkü
   asistanın yazma araçları onları göndermiyordu. Şifreli dünyada sunucu bu hesapları
   yapamaz (qty, price, card_txs.amount… opak) — bu dosya o yedeklerin TEK kopyasıdır.

   Her yazma bu fonksiyondan geçer (formlar, asistan, otomatik gerçekleştirme): eksik
   olan türetilmiş alan burada, `/api/all`'dan gelen son veriyle doldurulur; formun
   zaten gönderdiği değere DOKUNULMAZ. Matematik engine'de — burada yalnız hangi uçta
   hangi alanın hangi fonksiyondan geldiği yazılı. */

import {
  cashDelta, statementAmount, recurringAmountIndex, recAmountOn, accountBalance, type AllData,
} from "@finans/engine";

type Govde = Record<string, unknown>;
const bos = (v: unknown) => v === undefined || v === null || v === "";
const sayi = (v: unknown, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);

/** `path`: `/api` öneksiz yol, örn. "/trades", "/cards/5/pay-statement". */
export function tutarTamamla(method: string, path: string, body: Govde, data: AllData | null): Govde {
  if (!data || method === "DELETE") return body;
  const b: Govde = { ...body };
  let m: RegExpMatchArray | null;

  /* Portföy işlemi: hesap etkisi yalnız TRY işlemde ve hesap seçiliyse (sunucudaki `affects`). */
  if ((method === "POST" && path === "/trades") || (method === "PUT" && /^\/trades\/\d+$/.test(path))) {
    const hesapli = (b.currency ?? "TRY") === "TRY" && !bos(b.account_id);
    if (hesapli && bos(b.entry_amount)) {
      b.entry_amount = cashDelta({ side: b.side as any, qty: sayi(b.qty), price: sayi(b.price), fee: sayi(b.fee) });
    }
    return b;
  }

  /* Vadeli mevduat: açılışta anapara hesaptan ÇIKAR. */
  if ((method === "POST" && path === "/deposits") || (method === "PUT" && /^\/deposits\/\d+$/.test(path))) {
    if (bos(b.entry_amount)) b.entry_amount = -sayi(b.principal);
    return b;
  }

  /* Ekstre ödemesi: o vadeye düşen taksit paylarının toplamı. */
  if (method === "POST" && (m = path.match(/^\/cards\/(\d+)\/pay-statement$/))) {
    const card = data.cards.find((c) => c.id === Number(m![1]));
    if (card && bos(b.amount)) b.amount = statementAmount(card, data.card_txs.filter((t) => t.card_id === card.id), String(b.due ?? ""));
    return b;
  }

  /* Düzenli kalem gerçekleştirme: o ayın tutarı, İŞARETİYLE. Karta düşen gider POZİTİF
     (ekstre borcu büyür), hesaba düşen gider EKSİ, gelir ARTI — sunucudaki dal ayrımıyla
     birebir (otomatik.ts'teki `bekleyenDuzenli` de aynı kuralı uygular). */
  if (method === "POST" && (m = path.match(/^\/recurring\/(\d+)\/realize$/))) {
    const r = data.recurring.find((x) => x.id === Number(m![1]));
    if (r && bos(b.amount)) {
      const ham = recAmountOn(recurringAmountIndex(data.recurring_amounts ?? []).get(r.id), String(b.ym ?? ""));
      if (ham !== undefined) b.amount = (r.card_id != null && r.kind === "expense") || r.kind === "income" ? ham : -ham;
    }
    return b;
  }

  /* Mutabakat: gerçek bakiye − defterden türeyen bakiye. */
  if (method === "POST" && (m = path.match(/^\/accounts\/(\d+)\/reconcile$/))) {
    if (bos(b.diff) && !bos(b.balance)) b.diff = sayi(b.balance) - accountBalance(data.account_entries, Number(m![1]));
    return b;
  }

  return b;
}
