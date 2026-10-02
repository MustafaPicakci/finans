import React, { useMemo } from "react";
import type { AllData } from "@finans/engine";
import { T, css, fmtMoney } from "./theme";
import { Modal } from "./ui";
import { KalemForm, TransferForm, CardTxForm, RecurringForm, LoanForm, TradeForm, BedelliForm, DepositForm, type AddKind, type KalemPrefill, type CardTxPrefill, type TradePrefill } from "./features/forms";
import { shortcuts } from "./features/forms/recall";

export type { AddKind, KalemPrefill, TradePrefill };
/** Açık form + (varsa) önden doldurma. `prefill` formun türüne göre yorumlanır. */
/** `secimden`: form "+ Ekle" seçim ekranından açıldı — sol üstte geri düğmesi oraya döner.
    Başka yerden önden dolu açılan formda (fon boz, "Gerçekleşti", kurumsal olay) dönülecek seçim ekranı yok. */
export type AddState = { kind: AddKind | "pick"; prefill?: KalemPrefill; cardPrefill?: CardTxPrefill; tradePrefill?: TradePrefill; secimden?: boolean };

/* ————— GLOBAL "+ EKLE" AKIŞI —————
   Tüm işlem girişlerinin tek kapısı. Seçim listesindeki açıklamalar, her kaydın
   neyi etkilediğini (bakiye / projeksiyon / ekstre / rapor) anlatır. */

/* Seçim ekranı (yeniden tasarım, Ekim 2026): dokuz eşit ağırlıklı seçenek + her birinin altında 2-4
   satır teknik açıklama telefonda iki ekran boyuydu. Şimdi: en üstte Asistan (kullanıcının asıl
   giriş yolu), son girdikleri, sık kullanılan DÖRT büyük karo, kalanı tek satırlık "Diğer" listesi.
   Açıklamalar iki-üç kelime; ne yaptığını form kendi sonuç cümlesiyle söylüyor. */
type Secenek = { kind: AddKind; title: string; desc: string; icon: React.ReactNode };
const ikon = (d: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ANA: Secenek[] = [
  { kind: "kalem", title: "Gider / gelir", desc: "hesaptan, nakitten", icon: ikon(<><circle cx="8.5" cy="8.5" r="6.5" /><path d="M5.5 8.5h6M8.5 5.5v6" /></>) },
  { kind: "cardtx", title: "Kart harcaması", desc: "ekstreye düşer", icon: ikon(<><rect x="1.5" y="3.5" width="14" height="10" rx="2" /><path d="M1.5 7h14" /></>) },
  { kind: "trade", title: "Portföy işlemi", desc: "alış, satış, temettü", icon: ikon(<><path d="M2 11.5l3.5-4 3 2.5L14 4" /><path d="M10.5 4H14v3.5" /></>) },
  { kind: "transfer", title: "Virman", desc: "hesapların arası", icon: ikon(<path d="M3 5.5h10l-2.5-2.5M14 11.5H4l2.5 2.5" />) },
];
const DIGER: Secenek[] = [
  { kind: "recurring", title: "Düzenli gelir / gider", desc: "her ay", icon: ikon(<><path d="M3 8.5a5.5 5.5 0 0 1 9.5-3.8M14 8.5a5.5 5.5 0 0 1-9.5 3.8" /><path d="M12.5 2v3h-3M4.5 15v-3h3" /></>) },
  { kind: "loan", title: "Kredi", desc: "taksit planı", icon: ikon(<><path d="M2 6l6.5-3.5L15 6" /><path d="M3.5 6.5v6M13.5 6.5v6M2 14.5h13" /></>) },
  { kind: "deposit", title: "Vadeli mevduat", desc: "faizli", icon: ikon(<><rect x="3" y="7" width="11" height="8" rx="1.5" /><path d="M5.5 7V5a3 3 0 0 1 6 0v2" /></>) },
  /* Bedelli ayrı bir SEÇENEK ama ayrı bir KAYIT TÜRÜ değil (Faz 21/35): duyurunun dili
     ("%150 bedelli, 1 TL nominal") ile formun dili (adet + birim fiyat) farklı; sonunda düz bir ALIŞ yazar. */
  { kind: "bedelli", title: "Bedelli", desc: "rüçhan hakkı", icon: ikon(<><circle cx="8.5" cy="8.5" r="6.5" /><path d="M8.5 5v7M5 8.5h7" /></>) },
  { kind: "import", title: "Toplu içe aktar", desc: "ekstre, PDF", icon: ikon(<><path d="M8.5 2v8.5M5 7l3.5 3.5L12 7" /><path d="M2.5 11.5v3h12v-3" /></>) },
];

const TITLES: Record<AddKind, string> = {
  kalem: "Gider / gelir",
  transfer: "Virman",
  cardtx: "Kart harcaması",
  recurring: "Düzenli gelir / gider",
  loan: "Kredi",
  trade: "Portföy işlemi",
  bedelli: "Bedelli sermaye artışı",
  deposit: "Vadeli mevduat",
  import: "Toplu içe aktar",
};

export function AddSheet({ data, state, setState, onClose, reload, onImport, onAsistan }: {
  data: AllData; state: AddState; setState: (s: AddState) => void; onClose: () => void; reload: () => void;
  /** toplu içe aktarma popup değil kendi sayfasıdır (ICE_AKTAR_META) — seçenek oraya götürür */
  onImport: () => void;
  /** "Asistan'a anlat" — harcamaların asıl giriş yolu (kullanıcı: "akbank 400 tl harcama") */
  onAsistan: () => void;
}) {
  // en sık girilen kalemler — tek tıkla ilgili form önden doldurulmuş açılır
  const chips = useMemo(() => (state.kind === "pick" ? shortcuts(data) : []), [data, state.kind]);
  if (state.kind === "pick") {
    // ön koşulu olmayan seçenek soluk görünür ve nedenini söyler (boş forma girip anlamaktansa)
    const engel = (k: AddKind) => k === "cardtx" && data.cards.length === 0 ? "önce Kartlar'da bir kart tanımla"
      : k === "transfer" && data.accounts.length < 2 ? "en az iki hesap gerekir" : null;
    const sec = (k: AddKind) => (k === "import" ? onImport() : setState({ kind: k, secimden: true }));
    const Ok = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.mut3} strokeWidth="1.6" strokeLinecap="round"><path d="M4.5 3l3 3-3 3" /></svg>;
    return (
      <Modal title="Ne ekliyorsun?" onClose={onClose}>
        {/* minmax(0,1fr): ızgaranın tek sütunu içeriğinin doğal genişliğine uzamasın — yatay kayan çip
            satırı sütunu kendi genişliğine çekiyor ve bütün içerik kutudan taşıyordu (gerçek veride; sahte
            veride çip yoktu). */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
          <button onClick={onAsistan} style={{
            display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 14px", borderRadius: 12, border: "none",
            background: T.panel2, color: T.mut, fontFamily: T.disp, fontSize: 15, cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ color: T.acc, display: "grid" }}>{ikon(<><path d="M2.5 3.5h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3.5 3v-3H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" /><path d="M5.5 7.5h6" /></>)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Asistan'a anlat: “akbank 400 tl market”</span>
            <Ok />
          </button>
          {/* en sık girilen kalemler — tek dokunuşla önden doldurulmuş form */}
          {chips.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: T.mut, marginBottom: 8 }}>Sık girdiklerin</div>
              {/* masaüstünde sarar, telefonda yatay kayar (App.tsx .ekle-cipler) — en fazla 6 çip */}
              <div className="ekle-cipler" style={{ display: "flex", gap: 8, minWidth: 0 }}>
                {chips.map((c, i) => (
                  <button key={i} style={{ ...css.chip, height: 36, fontSize: 14, flexShrink: 0, background: T.panel, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }} onClick={() => c.kind === "kalem"
                    ? setState({ kind: "kalem", secimden: true, prefill: { name: c.sug.name, amount: c.sug.amount, type: c.sug.type, category_id: c.sug.category_id, account_id: c.sug.account_id } })
                    : setState({ kind: "cardtx", secimden: true, cardPrefill: { name: c.sug.name, amount: c.sug.amount, card_id: c.sug.card_id, installments: c.sug.installments } })}>
                    {c.label} <span style={{ color: T.mut, fontWeight: 400, fontFamily: T.mono }}>{fmtMoney(c.sug.amount, "TRY")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Sığma (kullanıcı geri bildirimi: telefonda kutuya sığmıyordu): karolar yatay ve alçak,
              "Diğer" iki sütunlu kısa düğmeler — 375×667'de kaydırmadan sığar. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {ANA.map((o) => {
              const e = engel(o.kind);
              return (
                <button key={o.kind} disabled={!!e} onClick={() => sec(o.kind)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, minHeight: 60,
                  border: `1px solid ${T.line}`, background: T.panel, cursor: e ? "not-allowed" : "pointer", textAlign: "left",
                  fontFamily: T.disp, color: T.text, opacity: e ? 0.5 : 1, minWidth: 0,
                }}>
                  <span style={{ color: T.acc, display: "grid", flexShrink: 0 }}>{o.icon}</span>
                  <span style={{ minWidth: 0, lineHeight: 1.25 }}>
                    <span style={{ display: "block", fontSize: 14.5, fontWeight: 650 }}>{o.title}</span>
                    <span style={{ display: "block", fontSize: 12, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e ?? o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div>
            <div style={{ fontSize: 13, color: T.mut, marginBottom: 6 }}>Diğer</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {DIGER.map((o) => (
                <button key={o.kind} onClick={() => sec(o.kind)} title={o.desc} style={{
                  display: "flex", alignItems: "center", gap: 9, minHeight: 44, padding: "0 12px", borderRadius: 12,
                  border: `1px solid ${T.line}`, background: T.panel, cursor: "pointer", fontFamily: T.disp,
                  fontSize: 14, color: T.text, textAlign: "left", minWidth: 0,
                }}>
                  <span style={{ color: T.mut, display: "grid", flexShrink: 0 }}>{o.icon}</span>
                  {/* sarar, kırpmaz: 375px'te "Düzenli gelir / gider" tek satıra sığmıyor */}
                  <span style={{ minWidth: 0, lineHeight: 1.2, padding: "4px 0" }}>{o.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  const props = { data, reload, onClose };
  return (
    <Modal title={state.prefill?.oneoffId ? "Kalemi gerçekleştir" : TITLES[state.kind]} onClose={onClose}
      onBack={state.secimden ? () => setState({ kind: "pick" }) : undefined}>
      {state.kind === "kalem" && <KalemForm {...props} prefill={state.prefill} />}
      {state.kind === "transfer" && <TransferForm {...props} />}
      {state.kind === "cardtx" && <CardTxForm {...props} prefill={state.cardPrefill} />}
      {state.kind === "recurring" && <RecurringForm {...props} />}
      {state.kind === "loan" && <LoanForm {...props} />}
      {state.kind === "trade" && <TradeForm {...props} prefill={state.tradePrefill} />}
      {state.kind === "bedelli" && <BedelliForm {...props} />}
      {state.kind === "deposit" && <DepositForm {...props} />}
    </Modal>
  );
}
