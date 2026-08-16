import React from "react";
import type { AllData } from "@finans/engine";
import { Modal } from "./ui";
import { KalemForm, CardTxForm, TradeForm, TransferForm, RecurringForm, LoanForm, DepositForm, type EditTarget } from "./features/forms";

export type { EditTarget };

/* ————— KAYIT DÜZENLEME (Faz 14) —————
   "+ Ekle" akışının formlarını düzenle modunda açan tek modal. Kayıtların listelendiği
   her sekme (Kayıtlar / Plan / Kart / Portföy-Hareketler) yalnız bir `EditTarget` state'i
   tutar ve bunu render eder — böylece düzenleme deneyimi her yerde aynıdır ve form
   mantığı (doğrulama, ipuçları, autocomplete) tek yerde kalır. */

const TITLES: Record<EditTarget["kind"], string> = {
  transaction: "Kaydı Düzenle",
  oneoff: "Plan Kalemini Düzenle",
  cardtx: "Kart Harcamasını Düzenle",
  trade: "Portföy İşlemini Düzenle",
  transfer: "Transferi Düzenle",
  recurring: "Düzenli Kalemi Düzenle",
  loan: "Krediyi Düzenle",
  deposit: "Vadeli Mevduatı Düzenle",
};

export function EditSheet({ data, target, onClose, reload }: {
  data: AllData; target: EditTarget; onClose: () => void; reload: () => void;
}) {
  const props = { data, reload, onClose };
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
