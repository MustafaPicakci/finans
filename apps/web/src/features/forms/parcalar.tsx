import React from "react";
import { num, fmtD, parseD, todayStr, type Currency } from "@finans/engine";
import { T, fmtMoney } from "../../theme";

/* ————— FORM PARÇALARI (yeniden tasarım, Ekim 2026) —————
   "+ Ekle" ve düzenleme formlarının ortak dili. Eski formlarda her alan aynı gri kutuydu (etiket
   küçük BÜYÜK HARF, yazı tipi mono), en önemli seçim (gider mi gelir mi) dördüncü alanda bir açılır
   listeydi ve formun dibinde genel kuralı anlatan gri bir bilgi kutusu dururdu. Yeni dil:
   - üstte SEGMENT (beşten az seçenek açılır liste değil, görünür seçenek),
   - büyük TUTAR,
   - etiketi görünür tek sütun alanlar (adlar sans, rakamlar mono),
   - ikincil alanlar SATIR: etiket solda, değer sağda; dokununca yerel seçici açılır,
   - dipte yapışkan ALT ÇUBUK: kaydedince NE OLACAĞINI söyleyen tek cümle + ne yaptığını söyleyen düğme. */

export const girdi: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", height: 48, border: `1px solid ${T.line}`, borderRadius: 12,
  padding: "0 14px", fontSize: 16, fontFamily: T.disp, background: T.panel, color: T.text, outline: "none",
};
export const girdiMono: React.CSSProperties = { ...girdi, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" };

/** Dikey yığın — formun gövdesi */
export const Bolum = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
);

/** Etiketi her zaman görünür alan (yer tutucu etiket DEĞİLDİR — yazmaya başlayınca kaybolur) */
export const Etiketli = ({ etiket, children, flex, alt }: { etiket: string; children: React.ReactNode; flex?: number; alt?: React.ReactNode }) => (
  <div style={{ flex: flex ?? 1, minWidth: 0 }}>
    <div style={{ fontSize: 13, color: T.mut, marginBottom: 6 }}>{etiket}</div>
    {children}
    {alt && <div style={{ fontSize: 12.5, color: T.mut, marginTop: 5 }}>{alt}</div>}
  </div>
);

/** Veri SEÇİMİ (gider/gelir, alış/satış…): görünür seçenekler, seçili = beyaz yüzey + kendi rengi.
    Faz 24 kural 2'deki filtre şeridinden farkı: bu kaydın kendisini değiştirir, o yüzden formun içinde. */
export function Segment<V extends string>({ secenek, deger, sec, kucuk, ad }: {
  secenek: { v: V; l: string; renk?: string; title?: string }[]; deger: V; sec: (v: V) => void; kucuk?: boolean; ad: string;
}) {
  return (
    <div role="radiogroup" aria-label={ad} style={{ display: "flex", padding: kucuk ? 2 : 3, gap: 2, background: T.panel2, borderRadius: kucuk ? 10 : 12, flexShrink: 0 }}>
      {secenek.map((s) => {
        const on = s.v === deger;
        return (
          <button key={s.v} type="button" role="radio" aria-checked={on} title={s.title} onClick={() => sec(s.v)} style={{
            flex: 1, border: "none", borderRadius: kucuk ? 8 : 9, cursor: "pointer", fontFamily: T.disp, whiteSpace: "nowrap",
            padding: kucuk ? "5px 12px" : "9px 4px", fontSize: kucuk ? 13 : 14.5, minHeight: 0,
            fontWeight: on ? 650 : 500, background: on ? T.panel : "transparent",
            color: on ? (s.renk ?? T.acc) : T.mut, boxShadow: on ? "var(--shadow-sm)" : "none",
          }}>{s.l}</button>
        );
      })}
    </div>
  );
}

/** Büyük tutar. Altındaki biçimli önizleme sessiz yanlış ayrıştırmayı önler ("1.234,56" → ₺1.234,56)
    — eski `AmountField`'ın işi; burada tutar büyük yazıldığı için yalnız girdi rakamdan farklı
    okunabilecekse (ayırıcı varsa) ya da geçersizse çıkar. */
export function TutarGirdisi({ value, onChange, renk, ccy = "TRY", inputRef, autoFocus, etiket, serbest }: {
  value: string; onChange: (v: string) => void; renk?: string; ccy?: Currency;
  inputRef?: React.Ref<HTMLInputElement>; autoFocus?: boolean; etiket?: string;
  /** 0 ve eksi de geçerli (açılış bakiyesi, mutabakatta gerçek bakiye: boş cüzdan, KMH) — `AmountField sign="serbest"` */
  serbest?: boolean;
}) {
  const v = value.trim();
  /* `num` çözemediğinde 0 döner → serbest modda "abc" ile "0" ayırt edilemez; biçime de bakılır */
  const ok = serbest ? /^-?\s*[\d.,]+$/.test(v) : num(value) > 0;
  return (
    <div>
      {etiket && <div style={{ fontSize: 13, color: T.mut, marginBottom: 2 }}>{etiket}</div>}
      <label style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: "text" }}>
        <span style={{ fontFamily: T.mono, fontSize: 26, color: T.mut }}>{ccy === "USD" ? "$" : "₺"}</span>
        <input ref={inputRef} autoFocus={autoFocus} inputMode="decimal" placeholder="0" value={value} aria-label={etiket ?? "Tutar"}
          onChange={(e) => onChange(e.target.value)} className="tutar-girdisi"
          style={{
            flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", padding: "2px 0",
            fontFamily: T.mono, fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em", color: v ? (renk ?? T.text) : T.mut3,
          }} />
      </label>
      {v !== "" && (!ok || /[.,]/.test(v)) && (
        <div style={{ fontSize: 12.5, color: ok ? T.mut : T.neg, marginTop: -2 }}>
          {ok ? fmtMoney(num(value), ccy, true, true) : "geçersiz tutar"}
        </div>
      )}
    </div>
  );
}

const Ok = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.mut3} strokeWidth="1.6" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M4.5 3l3 3-3 3" /></svg>
);
const satirStil: React.CSSProperties = {
  position: "relative", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 14px",
  borderTop: `1px solid ${T.line2}`, fontSize: 15, color: T.text,
};
const satirEtiket: React.CSSProperties = { color: T.mut, flex: "0 0 auto" };
const satirDeger: React.CSSProperties = { flex: 1, minWidth: 0, textAlign: "right", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
/** Yerel seçiciyi satırın tamamına görünmez yayar: dokunma hedefi satırın kendisi olur, açılan
    liste/takvim cihazın kendi seçicisidir (telefonda erişilebilir ve tanıdık). */
const ortu: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", minHeight: 0, fontSize: 16 };

/** Satır grubu — ilk satırın üst çizgisi çerçevenin kendisi */
export const Satirlar = ({ children }: { children: React.ReactNode }) => (
  <div className="form-satirlar" style={{ border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden", background: T.panel }}>{children}</div>
);

export function SatirSec({ etiket, goruntu, value, onChange, children, soluk }: {
  etiket: string; goruntu: React.ReactNode; value: string | number; onChange: (v: string) => void;
  children: React.ReactNode; soluk?: boolean;
}) {
  return (
    <label style={satirStil}>
      <span style={satirEtiket}>{etiket}</span>
      <span style={{ ...satirDeger, color: soluk ? T.mut : T.text, fontWeight: soluk ? 400 : 500 }}>{goruntu}</span>
      <Ok />
      <select aria-label={etiket} value={value} onChange={(e) => onChange(e.target.value)} style={ortu}>{children}</select>
    </label>
  );
}

/** Tarih (ve ay) satırı. Tıklamada `showPicker`: görünmez tarih alanına tıklamak masaüstünde takvimi açmıyordu. */
export function SatirTarih({ etiket = "Tarih", value, onChange, tur = "date", bos = "—", temizle }: {
  etiket?: string; value: string; onChange: (v: string) => void; tur?: "date" | "month"; bos?: string;
  /** isteğe bağlı alan: değer varken küçük "temizle" düğmesi */
  temizle?: boolean;
}) {
  const bugun = todayStr();
  const goruntu = !value ? bos
    : tur === "month" ? fmtD(parseD(`${value}-01`), { month: "long", year: "numeric" })
    : value === bugun ? `Bugün, ${fmtD(parseD(value), { day: "numeric", month: "short" })}`
    : fmtD(parseD(value), { day: "numeric", month: "short", ...(value.slice(0, 4) !== bugun.slice(0, 4) ? { year: "numeric" } : {}) });
  return (
    <label style={satirStil}>
      <span style={satirEtiket}>{etiket}</span>
      <span style={{ ...satirDeger, color: value ? T.text : T.mut, fontWeight: value ? 500 : 400 }}>{goruntu}</span>
      {temizle && value
        ? <button type="button" aria-label={`${etiket} temizle`} onClick={(e) => { e.preventDefault(); onChange(""); }}
          style={{ position: "relative", zIndex: 1, background: "none", border: "none", color: T.mut, cursor: "pointer", padding: 4, minHeight: 0, fontSize: 13 }}>✕</button>
        : <Ok />}
      <input type={tur} aria-label={etiket} value={value} onChange={(e) => onChange(e.target.value)}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* eski tarayıcı */ } }}
        style={ortu} />
    </label>
  );
}

/** Satır içi kısa metin/sayı (not, komisyon, faiz oranı…): değer sağda yazılır */
export function SatirMetin({ etiket, value, onChange, placeholder, sayi, sonEk }: {
  etiket: string; value: string; onChange: (v: string) => void; placeholder?: string; sayi?: boolean; sonEk?: string;
}) {
  return (
    <label style={satirStil}>
      <span style={satirEtiket}>{etiket}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={sayi ? "decimal" : undefined}
        aria-label={etiket}
        style={{
          flex: 1, minWidth: 0, textAlign: "right", border: "none", outline: "none", background: "transparent", padding: 0, minHeight: 0,
          fontSize: 15, fontWeight: 500, color: T.text, fontFamily: sayi ? T.mono : T.disp,
        }} />
      {sonEk && <span style={{ color: T.mut, fontSize: 14 }}>{sonEk}</span>}
    </label>
  );
}

/** Kalıcı tercih anahtarı (onay kutusu değil: "kendiliğinden işlensin", "geri yatır") */
export function Anahtar({ etiket, alt, acik, onChange }: { etiket: string; alt?: React.ReactNode; acik: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={acik} onClick={() => onChange(!acik)} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "none", border: "none",
      padding: "2px 0", cursor: "pointer", fontFamily: T.disp, color: T.text,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15 }}>{etiket}</span>
        {alt && <span style={{ display: "block", fontSize: 12.5, color: T.mut, marginTop: 1 }}>{alt}</span>}
      </span>
      <span style={{ width: 44, height: 26, borderRadius: 13, flexShrink: 0, position: "relative", background: acik ? T.acc : T.line, transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: acik ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s" }} />
      </span>
    </button>
  );
}

/** Küçük tamsayı sayacı (taksit sayısı) — elle de yazılabilir */
export function Sayac({ etiket, value, onChange, min = 1, alt }: { etiket: string; value: string; onChange: (v: string) => void; min?: number; alt?: React.ReactNode }) {
  const n = Math.max(min, Math.floor(Number(value) || min));
  const dug: React.CSSProperties = {
    width: 40, height: 40, minHeight: 0, borderRadius: 12, border: `1px solid ${T.line}`, background: T.panel, color: T.mut,
    fontSize: 20, cursor: "pointer", display: "grid", placeItems: "center", fontFamily: T.disp, flexShrink: 0,
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 15, flex: 1 }}>{etiket}</span>
        <button type="button" aria-label="Azalt" style={{ ...dug, opacity: n <= min ? 0.4 : 1 }} disabled={n <= min} onClick={() => onChange(String(n - 1))}>−</button>
        <input aria-label={etiket} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          style={{ width: 44, textAlign: "center", border: "none", outline: "none", background: "transparent", fontFamily: T.mono, fontSize: 18, fontWeight: 600, color: T.text, minHeight: 0 }} />
        <button type="button" aria-label="Artır" style={dug} onClick={() => onChange(String(n + 1))}>+</button>
      </div>
      {alt && <div style={{ fontSize: 12.5, color: T.mut, textAlign: "right", marginTop: 4 }}>{alt}</div>}
    </div>
  );
}

/** Seçilebilir çipler (kart, hisse) — az sayıda tanım kaydı arasında görünür seçim */
export function Cipler<V extends string | number>({ secenek, deger, sec, ad }: { secenek: { v: V; l: React.ReactNode }[]; deger: V; sec: (v: V) => void; ad: string }) {
  return (
    <div role="radiogroup" aria-label={ad} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {secenek.map((s) => {
        const on = s.v === deger;
        return (
          <button key={String(s.v)} type="button" role="radio" aria-checked={on} onClick={() => sec(s.v)} style={{
            height: 38, minHeight: 0, padding: "0 14px", borderRadius: 19, cursor: "pointer", fontFamily: T.disp, fontSize: 14, whiteSpace: "nowrap",
            border: `1px solid ${on ? T.acc : T.line}`, background: on ? T.accSoft : T.panel, color: on ? T.acc : T.text, fontWeight: on ? 600 : 500,
          }}>{s.l}</button>
        );
      })}
    </div>
  );
}

/** Tek dokunuşla doldurma çipi ("güncel fiyat", "tümünü sat") */
export const Doldur = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} style={{
    height: 32, minHeight: 0, padding: "0 12px", borderRadius: 16, border: `1px solid ${T.line}`, background: T.panel2,
    color: T.text, fontSize: 13, fontFamily: T.disp, cursor: "pointer", whiteSpace: "nowrap",
  }}>{children}</button>
);

/** Formun dibi (yapışkan): kaydedince ne olacağı (eksik alan varsa ne eksik), ne yaptığını söyleyen
    düğme ve art arda giriş için ikincil "Kaydet, yenisini gir". Düzenlemede solda "Sil". */
export function FormAlt({ sonuc, ok, reason, etiket, onSaveNew, editing, sil }: {
  sonuc: React.ReactNode; ok: boolean; reason: string | null; etiket: string;
  onSaveNew?: () => void; editing?: boolean; sil?: React.ReactNode;
}) {
  return (
    <div className="form-alt">
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: ok ? T.text : T.mut }}>{ok ? sonuc : reason}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {sil}
        {!editing && onSaveNew && (
          <button type="button" disabled={!ok} onClick={onSaveNew} className="form-ikincil" style={{
            background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 14.5, fontWeight: 600,
            cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.4, padding: "8px 4px",
          }}>Kaydet, yenisini gir</button>
        )}
        <button type="submit" disabled={!ok} className="form-birincil" style={{
          flex: 1, minWidth: 180, height: 48, border: "none", borderRadius: 13, background: T.acc, color: T.accInk,
          fontFamily: T.disp, fontSize: 15.5, fontWeight: 650, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.4,
        }}>{etiket}</button>
      </div>
    </div>
  );
}

/** Kısa tarih (sonuç cümleleri için): "25 Eyl", farklı yılsa "25 Eyl 2027" */
export const kisaGun = (d: Date) => fmtD(d, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });

/** Tutarı işaretiyle, sonuç cümlesinde vurgulu */
export const Vurgu = ({ v, ccy = "TRY", isaret }: { v: number; ccy?: Currency; isaret?: "+" | "−" }) => (
  <b style={{ fontFamily: T.mono, fontWeight: 600, color: isaret === "−" ? T.neg : isaret === "+" ? T.pos : T.text }}>
    {isaret ?? ""}{fmtMoney(v, ccy, true)}
  </b>
);
