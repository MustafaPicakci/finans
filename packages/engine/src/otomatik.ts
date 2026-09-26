import type { AllData } from "./types.js";
import { keyOf } from "./date.js";
import { recurringAmountIndex, recAmountOn, recOccurrenceDate } from "./recurring.js";
import { txShares } from "./cards.js";

/* ————— OTOMATİK GERÇEKLEŞTİRME (E2EE aşama 2) —————
   `auto` işaretli düzenli kalemler ve ödeme talimatlı kart ekstreleri, günü gelince
   kendiliğinden deftere geçer. Bu karar SUNUCUDA 15 dakikalık bir cron'daydı ve tutarı
   okumak zorundaydı (`recurring_amounts.amount`, `card_txs.amount`) — şifreli dünyada
   yapamayacağı tek şey bu. Karar buraya taşındı, HTTP sürücüsü ise uygulama açılışında.

   Neden kopyasını sunucuda bırakmadık: cron'un şifreli bir tutarı yazabilmesi için o
   tutarın önceden şifrelenmiş İKİNCİ bir kopyasının durması gerekirdi (kalem tanımının
   yanında). O kopya beş şekilde bayatlar — tutar değişir, kalem silinir, hedef değişir,
   bitiş ayı konur, gün kayar — ve bayatladığında cron sessizce YANLIŞ bir finansal kayıt
   yazar. Geç yazmak yanlış yazmaktan iyidir; üstelik gecikme görünür, yanlış görünmez.

   Gecikmenin bedeli sanıldığından küçük çünkü defter yalnız istemci üzerinden okunuyor:
   uygulama açıldığı anda gecikmişler yazılıyor, yani ekranda hiçbir zaman eksik rakam
   oluşmuyor. Düzenli kalemde kayıt zamanında da geç de yazılsa BİREBİR aynı çıkıyor —
   tarih `recOccurrenceDate(ym)`'den gelir, yazıldığı andan değil.

   Pencereler sunucudaki cron'dan devralındı ve bilinçli: yeni açılan bir `auto` kaleme
   derin geçmiş doldurtulmaz. */

/** Düzenli kalemde telafi penceresi — bundan eski occurrence'lar otomatik yazılmaz. */
export const OTOMATIK_PENCERE_GUN = 45;
/** Ekstre ödeme talimatında telafi penceresi. */
export const EKSTRE_PENCERE_GUN = 10;

const gunFarki = (a: string, b: string): number => {
  const ms = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  return Math.round((ms(a) - ms(b)) / 86_400_000);
};
const oncekiYm = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Gerçekleşmeyi bekleyen bir occurrence. `amount` deftere/karta yazılacak tutar, İŞARETİYLE. */
export type BekleyenKalem = {
  recurring_id: number;
  ym: string;
  /** occurrence tarihi ('YYYY-MM-DD') — kayda bu tarih yazılır, bugünün tarihi değil */
  date: string;
  amount: number;
  account_id: number | null;
  card_id: number | null;
  category_id: number | null;
};

/** `auto` + hedefli kalemlerden günü gelmiş ama henüz gerçekleşmemiş olanlar. */
export function bekleyenDuzenli(data: AllData, today: string): BekleyenKalem[] {
  const [ty, tm] = today.split("-").map(Number);
  const ymCur = `${ty}-${String(tm).padStart(2, "0")}`;
  const aylar = [oncekiYm(ymCur), ymCur];
  const yapilmis = new Set(data.recurring_realized.map((x) => `${x.recurring_id}:${x.ym}`));
  const amtIdx = recurringAmountIndex(data.recurring_amounts ?? []);
  const out: BekleyenKalem[] = [];

  for (const r of data.recurring) {
    if (!r.auto) continue;
    if (r.account_id == null && r.card_id == null) continue; // hedefsiz kalem yalnız tahmindir
    for (const ym of aylar) {
      if (yapilmis.has(`${r.id}:${ym}`)) continue;
      if (r.from_month && ym < r.from_month) continue;
      if (r.to_month && ym > r.to_month) continue;
      const date = keyOf(recOccurrenceDate(r, ym));
      if (date > today) continue;                                  // günü gelmemiş
      if (gunFarki(today, date) > OTOMATIK_PENCERE_GUN) continue;  // pencere dışı
      const ham = recAmountOn(amtIdx.get(r.id), ym);
      if (ham === undefined) continue; // tutarı tanımlı değil: "gerçekleşti ama kayıt yok"a düşmesin
      /* İşaret hedefe göre: KARTA düşen gider ekstreye POZİTİF yazılır (borç büyür),
         hesaba düşen gider EKSİ, gelir ARTI. Sunucudaki dal ayrımıyla birebir. */
      const kartaMi = r.card_id != null && r.kind === "expense";
      out.push({
        recurring_id: r.id, ym, date,
        amount: kartaMi || r.kind === "income" ? ham : -ham,
        account_id: r.account_id ?? null, card_id: r.card_id ?? null, category_id: r.category_id ?? null,
      });
    }
  }
  return out;
}

/** Ödeme talimatlı kartlarda vadesi gelmiş ve henüz ödenmemiş ekstre. */
export type BekleyenEkstre = { card_id: number; due: string; amount: number; account_id: number };

export function bekleyenEkstreler(data: AllData, today: string): BekleyenEkstre[] {
  const odenmis = new Set((data.statement_payments ?? []).map((p) => `${p.card_id}:${p.due}`));
  const hesaplar = new Set(data.accounts.map((a) => a.id));
  const out: BekleyenEkstre[] = [];

  for (const card of data.cards) {
    const acc = card.pay_account_id;
    if (acc == null || !hesaplar.has(acc)) continue; // talimat yok ya da hesap silinmiş
    const tutarlar = new Map<string, number>();
    for (const tx of data.card_txs) {
      if (tx.card_id !== card.id) continue;
      for (const sh of txShares(tx, card)) {
        const k = keyOf(sh.due);
        if (k > today) continue;
        if (gunFarki(today, k) > EKSTRE_PENCERE_GUN) continue;
        tutarlar.set(k, (tutarlar.get(k) ?? 0) + sh.amount);
      }
    }
    for (const [due, amount] of tutarlar) {
      if (!(amount > 0) || odenmis.has(`${card.id}:${due}`)) continue;
      out.push({ card_id: card.id, due, amount, account_id: acc });
    }
  }
  return out;
}
