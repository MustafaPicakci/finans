import React from "react";
import type { AllData } from "@finans/engine";
import { api } from "./api";
import { T, tl } from "./theme";
import { Modal, SilDugmesi } from "./ui";
import { KalemForm, CardTxForm, TradeForm, TransferForm, RecurringForm, LoanForm, DepositForm, type EditTarget } from "./features/forms";
import { loanRemaining } from "@finans/engine";

export type { EditTarget };

/* ————— KAYIT DÜZENLEME (Faz 14) —————
   "+ Ekle" akışının formlarını düzenle modunda açan tek modal. Kayıtların listelendiği
   her sekme (Kayıtlar / Plan / Kart / Portföy-Hareketler / Hesaplar) yalnız bir `EditTarget`
   state'i tutar ve bunu render eder — böylece düzenleme deneyimi her yerde aynıdır ve form
   mantığı (doğrulama, ipuçları, autocomplete) tek yerde kalır.

   Yeniden tasarım (Ekim 2026): formun dibinde "Sil" de var — kaydı açan kişi silmeyi de orada
   arıyor (eskiden yalnız listedeki ✕'teydi; o da yerinde duruyor). Onay Faz 24 kural 4'e uyar:
   her türün YAN ETKİSİ yazılır, metinler listelerdeki SilDugmesi'leriyle aynı. */

const TITLES: Record<EditTarget["kind"], string> = {
  transaction: "Kaydı düzenle",
  oneoff: "Plan kalemini düzenle",
  cardtx: "Kart harcamasını düzenle",
  trade: "Portföy işlemini düzenle",
  transfer: "Virmanı düzenle",
  recurring: "Düzenli kalemi düzenle",
  loan: "Krediyi düzenle",
  deposit: "Mevduatı düzenle",
};

/** Türe göre silme yolu, onayda görünen ad ve yan etki */
function silBilgisi(t: EditTarget, data: AllData): { yol: string; ad: React.ReactNode; sonuc: React.ReactNode } {
  switch (t.kind) {
    case "transaction": return { yol: "transactions", ad: t.row.name, sonuc: "Kayıt silinir; bir hesaba bağlıysa tutar o hesaba geri işlenir." };
    case "oneoff": return { yol: "oneoffs", ad: t.row.name, sonuc: "Planlanan kalem nakit projeksiyonundan çıkar. Gerçekleşen bir kayıt oluşturmaz." };
    case "cardtx": return {
      yol: "cardtxs", ad: t.row.name,
      sonuc: t.row.installments > 1 ? <>Taksitli harcama: <b>{t.row.installments} taksidin tamamı</b> ekstrelerden düşer.</> : "İlgili ekstrenin tutarı azalır.",
    };
    case "trade": return {
      yol: "trades", ad: <>{t.row.side} · {t.row.symbol} · {t.row.qty} adet</>,
      sonuc: <>Pozisyon ve ortalama maliyet yeniden hesaplanır.{t.row.account_id != null && " Tutar bağlı hesaba geri işlenir."}</>,
    };
    case "transfer": return {
      yol: "transfers", ad: t.row.note || "Virman",
      sonuc: <>Virmanın <b>iki bacağı birden</b> geri alınır: {tl.format(Math.round(t.row.amount))} kaynak hesaba döner, hedef hesaptan düşer.</>,
    };
    case "recurring": return {
      yol: "recurring", ad: t.row.name,
      sonuc: <>Kalem ve <b>tüm tutar geçmişi</b> silinir; projeksiyondan çıkar. Bu kalemden daha önce deftere geçirdiğin gerçekleşmeler <b>silinmez</b>.</>,
    };
    case "loan": {
      const rem = loanRemaining(t.row, new Date());
      return {
        yol: "loans", ad: t.row.name,
        sonuc: rem > 0 ? <>Kalan <b>{rem} taksit</b> ({tl.format(t.row.amount * rem)}) projeksiyondan ve net varlık borcundan çıkar.</> : "Kredi zaten bitmiş; projeksiyonu etkilemez.",
      };
    }
    case "deposit": {
      const acc = t.row.account_id != null ? data.accounts.find((a) => a.id === t.row.account_id) : null;
      return {
        yol: "deposits", ad: t.row.name,
        sonuc: acc
          ? <>Anapara ({tl.format(Math.round(t.row.principal))}) <b>{acc.name}</b> hesabına iade edilir; birikmiş faiz kaydedilmez. Faizi de almak için önce Hesaplar'da <b>Hesaba geçir</b> kullan.</>
          : <>Mevduat net varlıktan çıkar. Bağlı hesap olmadığından anapara hiçbir yere iade edilmez.</>,
      };
    }
  }
}

export function EditSheet({ data, target, onClose, reload }: {
  data: AllData; target: EditTarget; onClose: () => void; reload: () => void;
}) {
  const s = silBilgisi(target, data);
  const sil = (
    <SilDugmesi ad={s.ad} sonuc={s.sonuc} className="form-sil" ikon="Sil" title="Bu kaydı sil"
      style={{ color: T.neg, fontSize: 14.5, fontWeight: 600, padding: "8px 6px" }}
      onSil={async () => { await api.del(s.yol, target.row.id); reload(); onClose(); }} />
  );
  const props = { data, reload, onClose, sil };
  return (
    <Modal title={TITLES[target.kind]} onClose={onClose}>
      {(target.kind === "transaction" || target.kind === "oneoff") && <KalemForm {...props} edit={target} />}
      {target.kind === "cardtx" && <CardTxForm {...props} edit={target.row} />}
      {target.kind === "trade" && <TradeForm {...props} edit={target.row} />}
      {target.kind === "transfer" && <TransferForm {...props} edit={target.row} />}
      {target.kind === "recurring" && <RecurringForm {...props} edit={target.row} />}
      {target.kind === "loan" && <LoanForm {...props} edit={target.row} />}
      {target.kind === "deposit" && <DepositForm {...props} edit={target.row} />}
    </Modal>
  );
}
