import React from "react";
import type { AllData } from "@finans/engine";
import { T, css } from "./theme";
import { Modal } from "./ui";
import { KalemForm, CardTxForm, RecurringForm, LoanForm, TradeForm, type AddKind, type KalemPrefill } from "./features/forms";

export type { AddKind, KalemPrefill };
export type AddState = { kind: AddKind | "pick"; prefill?: KalemPrefill };

/* ————— GLOBAL "+ EKLE" AKIŞI —————
   Tüm işlem girişlerinin tek kapısı. Seçim listesindeki açıklamalar, her kaydın
   neyi etkilediğini (bakiye / projeksiyon / ekstre / rapor) anlatır. */

const OPTIONS: { kind: AddKind; dot: string; title: string; desc: string }[] = [
  { kind: "kalem", dot: "var(--cat-1)", title: "Gelir / Gider kalemi", desc: "Bugün veya geçmiş tarihli → gerçekleşen kayıt: hesabın bakiyesine işler, Rapor'a girer. İleri tarihli → plan: nakit projeksiyonuna girer" },
  { kind: "cardtx", dot: "var(--neg)", title: "Kart harcaması", desc: "Kesim gününe göre ekstreye işlenir; son ödeme günü nakit akışına gider olarak düşer" },
  { kind: "recurring", dot: "var(--brand)", title: "Düzenli gelir / gider", desc: "Maaş, kira, fatura… her ay tekrarlar, nakit projeksiyonuna girer" },
  { kind: "loan", dot: "var(--cat-8)", title: "Kredi / taksit", desc: "Sabit taksit planı; kalan taksitler nakit projeksiyonuna ve kredi borcuna girer" },
  { kind: "trade", dot: "var(--pos)", title: "Portföy işlemi", desc: "Hisse/fon/altın/döviz alış-satışı; pozisyonlara ve net varlığa yansır" },
];

const TITLES: Record<AddKind, string> = {
  kalem: "Gelir / Gider Kalemi",
  cardtx: "Kart Harcaması",
  recurring: "Düzenli Gelir / Gider",
  loan: "Kredi / Taksit",
  trade: "Portföy İşlemi",
};

export function AddSheet({ data, state, setKind, onClose, reload }: {
  data: AllData; state: AddState; setKind: (k: AddKind) => void; onClose: () => void; reload: () => void;
}) {
  if (state.kind === "pick") {
    return (
      <Modal title="Ne eklemek istiyorsun?" onClose={onClose}>
        <div style={{ display: "grid", gap: 8 }}>
          {OPTIONS.map((o) => {
            const noCard = o.kind === "cardtx" && data.cards.length === 0;
            return (
              <button key={o.kind} disabled={noCard} onClick={() => setKind(o.kind)} style={{
                display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left", cursor: noCard ? "not-allowed" : "pointer",
                background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, padding: "12px 14px",
                fontFamily: T.disp, color: T.text, opacity: noCard ? 0.5 : 1,
              }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: o.dot, marginTop: 5, flexShrink: 0 }} />
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 640 }}>{o.title}</span>
                  <span style={{ display: "block", fontSize: 12, color: T.mut, marginTop: 2 }}>
                    {noCard ? "Önce Kartlar sekmesinden bir kart tanımla" : o.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  const props = { data, reload, onClose };
  return (
    <Modal title={state.prefill ? "Kalemi Gerçekleştir" : TITLES[state.kind]} onClose={onClose}>
      {state.kind === "kalem" && <KalemForm {...props} prefill={state.prefill} />}
      {state.kind === "cardtx" && <CardTxForm {...props} />}
      {state.kind === "recurring" && <RecurringForm {...props} />}
      {state.kind === "loan" && <LoanForm {...props} />}
      {state.kind === "trade" && <TradeForm {...props} />}
    </Modal>
  );
}
