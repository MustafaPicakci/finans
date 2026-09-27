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

   SINIR: sabit gün penceresi DEĞİL, TALİMATIN BAŞLADIĞI GÜN (`auto_since` / `pay_since`).
   Eskiden 45 gün (kalem) / 10 gün (ekstre) pencere vardı — Faz 8'in sunucu cron'undan kalmaydı
   ve orada zararsızdı, çünkü cron 15 dakikada bir koşuyordu. Açılışa taşınınca zararlı oldu:
   uygulama 10 gün açılmazsa vadesi geçen ekstre BİR DAHA yazılmıyordu; geçmiş vadeli ekstre
   "ödendi" sayıldığı için borç ekrandan kalkıyor ama para hesaptan hiç düşmüyordu (bakiye
   olduğundan yüksek). Pencerenin tek meşru işi, talimattan ÖNCEKİ vadelere dokunmamaktı
   (kullanıcı onları zaten elle ödemiş/girmiş olabilir) — başlangıç tarihi bunu kesin yapar,
   üstelik kaç gün geçtiğinden bağımsız. Tarihi SUNUCU damgalar (eski ve yeni satırı aynı anda
   yalnız o görür): talimat pasiften aktife geçtiği gün yazılır, kapanınca silinir.
   Tarih yoksa (eski sunucu / önbellekteki eski paket) HİÇBİR ŞEY yazılmaz: sınırı bilmeden
   geriye gitmek, eski ekstreleri ikinci kez ödemek demek olabilir. */

const sonrakiYm = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
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
  const ymCur = today.slice(0, 7);
  const yapilmis = new Set(data.recurring_realized.map((x) => `${x.recurring_id}:${x.ym}`));
  const amtIdx = recurringAmountIndex(data.recurring_amounts ?? []);
  const out: BekleyenKalem[] = [];

  for (const r of data.recurring) {
    if (!r.auto) continue;
    if (r.account_id == null && r.card_id == null) continue; // hedefsiz kalem yalnız tahmindir
    const since = r.auto_since;
    if (!since) continue; // sınır bilinmiyor → yazma (bkz. dosya başı)
    const bas = r.from_month && r.from_month > since.slice(0, 7) ? r.from_month : since.slice(0, 7);
    for (let ym = bas; ym <= ymCur; ym = sonrakiYm(ym)) {
      if (yapilmis.has(`${r.id}:${ym}`)) continue;
      if (r.to_month && ym > r.to_month) continue;
      const date = keyOf(recOccurrenceDate(r, ym));
      if (date > today) continue;  // günü gelmemiş
      if (date < since) continue;  // talimattan önceki occurrence — elle girilmiş olabilir
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
    const since = card.pay_since;
    if (!since) continue; // sınır bilinmiyor → yazma (bkz. dosya başı)
    const tutarlar = new Map<string, number>();
    for (const tx of data.card_txs) {
      if (tx.card_id !== card.id) continue;
      for (const sh of txShares(tx, card)) {
        const k = keyOf(sh.due);
        if (k > today || k < since) continue; // vadesi gelmemiş ya da talimattan önceki ekstre
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
