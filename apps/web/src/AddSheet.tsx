import React, { useMemo } from "react";
import type { AllData } from "@finans/engine";
import { T, css, fmtMoney } from "./theme";
import { Modal } from "./ui";
import { KalemForm, CardTxForm, RecurringForm, LoanForm, TradeForm, DepositForm, ImportForm, type AddKind, type KalemPrefill, type CardTxPrefill } from "./features/forms";
import { shortcuts } from "./features/forms/recall";

export type { AddKind, KalemPrefill };
/** Açık form + (varsa) önden doldurma. `prefill` formun türüne göre yorumlanır. */
export type AddState = { kind: AddKind | "pick"; prefill?: KalemPrefill; cardPrefill?: CardTxPrefill };

/* ————— GLOBAL "+ EKLE" AKIŞI —————
   Tüm işlem girişlerinin tek kapısı. Seçim listesindeki açıklamalar, her kaydın
   neyi etkilediğini (bakiye / projeksiyon / ekstre / rapor) anlatır. */

const OPTIONS: { kind: AddKind; dot: string; title: string; desc: string }[] = [
  { kind: "kalem", dot: "var(--cat-1)", title: "Gelir / Gider kalemi", desc: "Bugün veya geçmiş tarihli → gerçekleşen kayıt: hesabın bakiyesine işler, Rapor'a girer. İleri tarihli → plan: nakit projeksiyonuna girer" },
  { kind: "cardtx", dot: "var(--neg)", title: "Kart harcaması", desc: "Kesim gününe göre ekstreye işlenir; son ödeme günü nakit akışına gider olarak düşer" },
  { kind: "recurring", dot: "var(--brand)", title: "Düzenli gelir / gider", desc: "Maaş, kira, fatura… her ay tekrarlar, nakit projeksiyonuna girer" },
  { kind: "loan", dot: "var(--cat-8)", title: "Kredi / taksit", desc: "Sabit taksit planı; kalan taksitler nakit projeksiyonuna ve kredi borcuna girer" },
  { kind: "trade", dot: "var(--pos)", title: "Portföy işlemi", desc: "Hisse/fon/altın/döviz alış-satışı; pozisyonlara ve net varlığa yansır" },
  { kind: "deposit", dot: "var(--type-doviz)", title: "Vadeli mevduat", desc: "Anapara + faiz oranı + gün sayısı; net varlığa kilitli varlık olarak faiz işleyerek girer" },
  { kind: "import", dot: "var(--cat-4)", title: "Toplu içe aktar", desc: "Banka ekstresini veya tabloyu yapıştır; satırlar çözülür, kontrol edip tek seferde deftere aktarırsın" },
];

const TITLES: Record<AddKind, string> = {
  kalem: "Gelir / Gider Kalemi",
  cardtx: "Kart Harcaması",
  recurring: "Düzenli Gelir / Gider",
  loan: "Kredi / Taksit",
  trade: "Portföy İşlemi",
  deposit: "Vadeli Mevduat",
  import: "Toplu İçe Aktar",
};

export function AddSheet({ data, state, setState, onClose, reload }: {
  data: AllData; state: AddState; setState: (s: AddState) => void; onClose: () => void; reload: () => void;
}) {
  // en sık girilen kalemler — tek tıkla ilgili form önden doldurulmuş açılır
  const chips = useMemo(() => (state.kind === "pick" ? shortcuts(data) : []), [data, state.kind]);
  if (state.kind === "pick") {
    return (
      <Modal title="Ne eklemek istiyorsun?" onClose={onClose}>
        {chips.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...css.label, marginBottom: 8 }}>Sık girdiklerin</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {chips.map((c, i) => (
                <button key={i} style={css.chip} onClick={() => c.kind === "kalem"
                  ? setState({ kind: "kalem", prefill: { name: c.sug.name, amount: c.sug.amount, type: c.sug.type, category_id: c.sug.category_id, account_id: c.sug.account_id } })
                  : setState({ kind: "cardtx", cardPrefill: { name: c.sug.name, amount: c.sug.amount, card_id: c.sug.card_id, installments: c.sug.installments } })}>
                  {c.label} <span style={{ color: T.mut3, fontWeight: 400 }}>{fmtMoney(c.sug.amount, "TRY")}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {OPTIONS.map((o) => {
            const noCard = o.kind === "cardtx" && data.cards.length === 0;
            return (
              <button key={o.kind} disabled={noCard} onClick={() => setState({ kind: o.kind })} style={{
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
    <Modal title={state.prefill?.oneoffId ? "Kalemi Gerçekleştir" : TITLES[state.kind]} onClose={onClose}>
      {state.kind === "kalem" && <KalemForm {...props} prefill={state.prefill} />}
      {state.kind === "cardtx" && <CardTxForm {...props} prefill={state.cardPrefill} />}
      {state.kind === "recurring" && <RecurringForm {...props} />}
      {state.kind === "loan" && <LoanForm {...props} />}
      {state.kind === "trade" && <TradeForm {...props} />}
      {state.kind === "deposit" && <DepositForm {...props} />}
      {state.kind === "import" && <ImportForm {...props} />}
    </Modal>
  );
}
