import type { AllData } from "./types.js";
import type { Day } from "./projection.js";
import { firstCutoff, clampDay, dueOf, statementAmount } from "./cards.js";
import { loanRemaining } from "./loans.js";
import { keyOf, fmtD } from "./date.js";

/* ————— Bildirim planı (Faz 44) —————
   "3 gün sonra kira var, ₺25.000" türünden hatırlatmalar. Sunucu şifreli veriyi okuyamadığı için
   (E2EE) bildirimi SUNUCU HESAPLAYAMAZ: plan uygulama açıldığında istemcide bu fonksiyonla kurulur,
   her öğe cihazın push anahtarıyla şifrelenir ve sunucu yalnız zamanı gelince kapalı zarfı iletir.

   YENİ MATEMATİK YOKTUR: ödeme olayları projeksiyonun kendi olaylarından (`Day.ev`) okunur — kira
   günü, gerçekleşmiş ayın atlanması, kredinin bitişi, ödenmiş ekstrenin düşmesi Nakit Akışı ile
   tanım gereği aynıdır. Kesim günü ve o ana kadarki tutar kart ekstre matematiğinden gelir.

   Bayatlık sorunu YOK ve bu bir varsayım değil yapının sonucu: veritabanı yalnız uygulama açıkken
   değişir (otomatik kayıtlar da açılışta yazılıyor) ve her açılış planı baştan kurar. Yani
   bildirimdeki tutar, sistemin o an bildiği en güncel tutardır.

   Kapsam (kullanıcı kararı): yalnız GİDERLER + kart kesimi, olaydan `gunOnce` gün önce, tutarıyla.
   Gelir hatırlatılmaz. Kesimde harcama yoksa bildirim çıkmaz (her ay "₺0" demek gürültüdür). */

/** Plan kuralları değişince artırılır: sunucu daha DÜŞÜK sürümlü bir planı reddeder — önbellekteki
    eski bir PWA, yeni sürümün kurduğu planın üzerine eski kurallarla yazamasın. */
export const BILDIRIM_SURUM = 1;

export type BildirimOge = {
  /** tekrar gönderim anahtarı: kaynak kayıt + olay günü ("r:12:2026-10-01", "k:3:2026-10-05") */
  anahtar: string;
  /** gönderim anı (ISO, UTC) — kullanıcının yerel saatiyle kurulur */
  zaman: string;
  /** bu andan sonra gönderilmez: olay günü geçtiyse "3 gün sonra" demek yalan olur */
  bitis: string;
  baslik: string;
  govde: string;
  /** bildirime dokununca açılacak ekran */
  url: string;
};

export type BildirimSecenek = { gunOnce?: number; saat?: number; ufukGun?: number };

const para = (v: number) => new Intl.NumberFormat("tr-TR", {
  style: "currency", currency: "TRY", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2,
}).format(v);
const gun = (d: Date) => fmtD(d, { day: "numeric", month: "long", weekday: "long" });
const kaydir = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function bildirimPlani(data: AllData, days: Day[], simdi: Date, s: BildirimSecenek = {}): BildirimOge[] {
  const gunOnce = s.gunOnce ?? 3, saat = s.saat ?? 9, ufukGun = s.ufukGun ?? 60;
  const bugun = new Date(simdi); bugun.setHours(0, 0, 0, 0);
  const ufuk = kaydir(bugun, ufukGun);
  const sonra = `${gunOnce} gün sonra`;
  const out: BildirimOge[] = [];
  /** olay günü → gönderim anı; geçmişte kalıyorsa null (olay yakın, hatırlatma fırsatı geçti) */
  const an = (olay: Date) => {
    const z = kaydir(olay, -gunOnce); z.setHours(saat, 0, 0, 0);
    return z > simdi ? z : null;
  };
  const ekle = (olay: Date, anahtar: string, baslik: string, govde: string, url: string) => {
    const z = an(olay);
    if (!z || olay > ufuk) return;
    out.push({ anahtar, zaman: z.toISOString(), bitis: kaydir(olay, 1).toISOString(), baslik, govde, url });
  };

  /* ödemeler: projeksiyonun olayları */
  for (const d of days) {
    for (const ev of d.ev) {
      if (ev.a >= 0 || !ev.r) continue; // gelir ve kaynaksız olay yok
      const [tur, idStr] = ev.r.split(":");
      const id = Number(idStr), tutar = -ev.a, anahtar = `${ev.r}:${d.k}`;
      if (tur === "r") {
        const ad = data.recurring.find((x) => x.id === id)?.name ?? ev.n;
        ekle(d.date, anahtar, `${ad} · ${sonra}`, `${gun(d.date)} · ${para(tutar)}`, "/nakit");
      } else if (tur === "l") {
        const l = data.loans.find((x) => x.id === id);
        /* loanRemaining o günün taksidi ÖDENDİKTEN sonrasını sayar: 2 taksitli kredinin ilkinde 1
           döner. "kalan 1 taksit" yazmak bunu son taksit sanıtırdı — cümle ne saydığını söylemeli. */
        const kalan = l ? loanRemaining(l, d.date) : null;
        const kalanMetni = kalan == null ? "" : kalan === 0 ? " · son taksit" : ` · bu taksitten sonra ${kalan} kalıyor`;
        ekle(d.date, anahtar, `${l?.name ?? ev.n} taksiti · ${sonra}`, `${gun(d.date)} · ${para(tutar)}${kalanMetni}`, "/nakit");
      } else if (tur === "e") {
        const ad = data.cards.find((x) => x.id === id)?.name ?? ev.n;
        ekle(d.date, anahtar, `${ad} ekstresi · son ödeme ${sonra}`, `${gun(d.date)} · ${para(tutar)}`, "/kart");
      } else if (tur === "o") {
        ekle(d.date, anahtar, `${ev.n} · ${sonra}`, `${gun(d.date)} · ${para(tutar)}`, "/nakit");
      }
    }
  }

  /* kesimler: projeksiyonda olay değildir (para kesimde değil son ödemede çıkar) */
  for (const card of data.cards) {
    for (let c = firstCutoff(bugun, card.statement_day); c <= ufuk;
      c = clampDay(c.getFullYear(), c.getMonth() + 1, card.statement_day)) {
      const tutar = statementAmount(card, data.card_txs, keyOf(dueOf(c, card.due_day)));
      if (tutar <= 0) continue;
      ekle(c, `k:${card.id}:${keyOf(c)}`, `${card.name} ekstresi ${sonra} kesiliyor`,
        `Kesim: ${gun(c)} · şu ana kadar ${para(tutar)}`, "/kart");
    }
  }
  return out.sort((a, b) => a.zaman.localeCompare(b.zaman) || a.anahtar.localeCompare(b.anahtar));
}
