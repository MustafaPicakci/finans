import React from "react";
import { createPortal } from "react-dom";
import { num, type Currency } from "@finans/engine";
import { T, css, tl, fmtMoney } from "../theme";

export const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) => (
  <div style={{ flex: flex || 1, minWidth: 120 }}><div style={css.label}>{label}</div>{children}</div>
);

/** Tutar girişi + canlı "₺1.234,56" (veya seçili para birimi) önizlemesi — sessiz yanlış-ayrıştırmayı önler */
/** `sign`: alanın kabul ettiği değer aralığı. Varsayılan "pozitif" — bir gelir/gider/işlem
    tutarı sıfır ya da eksi olamaz. Ama her tutar alanı böyle DEĞİL: mutabakatta girilen
    "gerçek bakiye" 0 olabilir (boşalmış nakit cüzdanı) ve eksi olabilir (KMH'li hesap).
    Bu ayrım prop'a bağlı, yoksa alan geçerli girdiyi "geçersiz tutar" diye reddeder gibi
    görünür ve kullanıcı denemekten vazgeçer. */
export const AmountField = ({ label, value, onChange, placeholder, flex, inputRef, ccy = "TRY", sign = "pozitif" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; flex?: number;
  inputRef?: React.Ref<HTMLInputElement>; ccy?: Currency; sign?: "pozitif" | "serbest";
}) => {
  const parsed = num(value);
  /* `num` çözemediğinde 0 döner → "abc" ile "0"ı ayırt edemez; serbest modda 0 geçerli
     olduğundan girdinin biçimine de bakılır. */
  const sayisal = /^-?\s*[\d.,]+$/.test(value.trim());
  const ok = sign === "serbest" ? sayisal : parsed > 0;
  return (
    <Field label={label} flex={flex}>
      <input ref={inputRef} style={css.input} inputMode="decimal" placeholder={placeholder ?? "0"} value={value}
        onChange={(e) => onChange(e.target.value)} />
      {value.trim() !== "" && (
        <div style={{ fontSize: 11, color: ok ? T.mut3 : T.neg, marginTop: 4 }}>
          {/* raw: girdi alanı zaten rakamları gösterdiğinden önizleme gizlilik modunda maskelenmez */}
          {ok ? fmtMoney(parsed, ccy, true, true) : "geçersiz tutar"}
        </div>
      )}
    </Field>
  );
};

/** Geçmişten öğrenen metin girişi: yazarken eşleşen kayıtlar listelenir, seçilince `onPick`
    formun geri kalanını (tutar/kategori/hesap…) doldurur. Klavye: ↑/↓ gezinme, Enter seç, Esc kapat.
    Liste açıkken Enter formu göndermez (öneri seçer) — art arda giriş akışı bozulmasın. */
export function SuggestInput<S>({ value, onChange, onPick, options, labelOf, subOf, inputRef, placeholder, style, max = 6, autoFocus }: {
  value: string; onChange: (v: string) => void; onPick: (s: S) => void;
  options: S[]; labelOf: (s: S) => string; subOf?: (s: S) => string;
  inputRef?: React.RefObject<HTMLInputElement>; placeholder?: string; style?: React.CSSProperties;
  max?: number; autoFocus?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [i, setI] = React.useState(0);
  const q = value.trim().toLocaleLowerCase("tr");
  // boşken en sık kullanılanlar, yazarken içinde geçenler (baştan eşleşenler önce)
  const hits = React.useMemo(() => {
    const list = q === "" ? options : options.filter((o) => labelOf(o).toLocaleLowerCase("tr").includes(q));
    if (q !== "") {
      list.sort((a, b) => Number(labelOf(b).toLocaleLowerCase("tr").startsWith(q)) - Number(labelOf(a).toLocaleLowerCase("tr").startsWith(q)));
    }
    // birebir aynı tek eşleşme varsa liste anlamsız
    return list.length === 1 && labelOf(list[0]).toLocaleLowerCase("tr") === q ? [] : list.slice(0, max);
  }, [options, q, max]);
  const show = open && hits.length > 0;
  const pick = (s: S) => { onPick(s); setOpen(false); };
  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef} style={{ ...css.input, ...style }} value={value} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setI(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // tıklama blur'dan sonra gelir
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => (x + 1) % hits.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => (x - 1 + hits.length) % hits.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hits[i]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      />
      {show && (
        <div style={{
          position: "absolute", zIndex: 5, left: 0, right: 0, top: "calc(100% + 4px)", background: T.panel,
          border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: "var(--shadow)", overflow: "hidden",
        }}>
          {hits.map((o, k) => (
            <div key={k} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setI(k)}
              style={{
                display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", cursor: "pointer",
                padding: "8px 11px", fontSize: 13, background: k === i ? T.panel2 : "transparent",
                borderTop: k === 0 ? "none" : `1px solid ${T.line}`,
              }}>
              <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(o)}</span>
              {subOf && <span style={{ color: T.mut3, fontSize: 11, flexShrink: 0 }}>{subOf(o)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Devre dışı bir "Ekle" butonunun yanında, formu neden gönderemediğini açıklayan küçük ipucu */
export const Hint = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12, color: T.mut3, marginTop: 8 }}>{children}</div>
);

/** Katlanır yardım metni. Bu açıklamalar bir kez okunur, sonra her açılışta ekranda yer
    kaplayan gürültüye döner (Özet mobilde 5900px'ti; payın önemli kısmı bu paragraflardı).
    Metin silinmez, ⓘ'nin arkasına alınır. `k` verilirse kullanıcının açık/kapalı tercihi
    localStorage'da kalır — açık bırakmayı seçtiyse bir dahaki sefere de açık gelir. */
export const Aciklama = ({ label = "nasıl okunur?", k, children }: {
  label?: string; k?: string; children: React.ReactNode;
}) => {
  const key = k ? `finans-aciklama-${k}` : null;
  const [open, setOpen] = React.useState(() => (key ? localStorage.getItem(key) === "1" : false));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (key) localStorage.setItem(key, next ? "1" : "0");
  };
  return (
    <div style={{ margin: "6px 0" }}>
      <button onClick={toggle} aria-expanded={open} style={{
        display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0,
        color: T.mut3, fontSize: 11.5, fontWeight: 500, fontFamily: T.disp, cursor: "pointer", minHeight: 0,
      }}>
        <span style={{
          width: 14, height: 14, borderRadius: 999, border: `1px solid ${T.line}`, display: "grid",
          placeItems: "center", fontSize: 9, fontWeight: 700, lineHeight: 1,
        }}>i</span>
        {label}
        <span style={{ fontSize: 8, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ fontSize: 11.5, color: T.mut, lineHeight: 1.55, marginTop: 6 }}>{children}</div>}
    </div>
  );
};

export const Money = ({ v, size = 14, sign, mut }: { v: number; size?: number; sign?: boolean; mut?: boolean }) => (
  <span style={{ ...css.mono, fontSize: size, color: mut ? T.mut : v > 0 ? (sign ? T.pos : T.text) : v < 0 ? T.neg : T.mut }}>
    {v > 0 && sign ? "+" : ""}{tl.format(v)}
  </span>
);

/** Filtre şeridi: içindeki her şey GÖRÜNÜMÜ değiştirir, veriyi değiştirmez.
    Eylem düğmeleri (kaydet, öde, yenile) kartın yüzeyinde yükseltilmiş dururken filtreler
    bu çukur şeritte toplanır — kullanıcı "bu düğme bir şey yapar mı, yoksa sadece süzer mi?"
    sorusunu düğmeyi okuyarak değil, nerede durduğuna bakarak cevaplasın. Yeni bir filtre
    eklerken bunun İÇİNE koy; dışına koyulan her filtre ayrımı tekrar bulanıklaştırır. */
export const FiltreSeridi = ({ children, sag }: { children: React.ReactNode; sag?: React.ReactNode }) => (
  <div style={{
    display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10,
    background: T.panel2, border: `1px solid ${T.line2}`, borderRadius: 12, padding: "8px 10px",
  }}>
    <span aria-hidden="true" title="süzgeç" style={{ fontSize: 11, color: T.mut3, flexShrink: 0, letterSpacing: "-0.05em" }}>▽</span>
    {children}
    {sag && <span style={{ marginLeft: "auto" }}>{sag}</span>}
  </div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: T.mut, fontSize: 13, padding: "18px 0", textAlign: "center" }}>{children}</div>
);

/* Liste satırı. `ui-row` mobilde satırı SARMALANIR kılar (App.tsx'teki medya sorgusu):
   sabit genişlikli çocuklar (tür seçici, tutar, düğmeler) toplamda ~500px yer ister,
   telefonun ~360px'inde sarmalama olmadan hepsi birbirine geçer.

   Ama yalnız sarmalamak yetmiyordu: nereye sarılacağı satırın İÇERİĞİNE bağlı kalıyordu,
   yani tutar kimi satırda 1., kimi satırda 3. satıra düşüyor, adlar kırpılıyordu. Mobilde
   düzen artık `order` ile SABİTLENİR — içerik ne olursa olsun aynı yerleşim çıkar:

     satır 1:  [row-lead] [row-title ............] [row-amount]
     satır 2+: geri kalan her şey (seçiciler, düğmeler, ✕)

   Bunu `row-break` sağlar: görünmez, tam genişlikte, tutardan sonra/kontrollerden önce
   sıralanan bir öğe — kontrolleri kesin olarak alt satıra iter. Kuralın işlemesi için her
   satır kendi başlığını `row-title`, tutarını `row-amount`, baştaki sabit öğesini (tarih,
   ikon, renk noktası) `row-lead` ile işaretlemeli. İŞARETSİZ içerik alt satıra düşer —
   yeni bir Row eklerken bu üç sınıfı vermeyi unutma. */
export const Row = ({ children, last }: { children: React.ReactNode; last?: boolean }) => (
  <div className="ui-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: last ? "none" : `1px solid ${T.line}` }}>
    {children}
    <span className="row-break" aria-hidden="true" />
  </div>
);

/** Onay isteyen silme düğmesi — ✕ tıklaması kaydı DOĞRUDAN silmez, önce sorar.
 *
 *  Silme bu uygulamada geri alınamaz ve çoğu zaman göründüğünden fazlasını yapar: bir virmanın
 *  iki bacağı birden geri alınır, hesap silinince tüm hareket defteri gider, kategori silinince
 *  geçmiş işlemlerin kategorisi düşer. Bu yüzden onay kutusu "emin misiniz?" demekle yetinmez,
 *  `sonuc` ile o kaydın YAN ETKİSİNİ yazar — görülmeden verilen onay, onay değildir.
 *
 *  Tek mekanizma olması bilinçli: bazı silmeler native `confirm()` ile soruyor, bazıları hiç
 *  sormuyordu. Yeni bir silme düğmesi eklerken `<button style={css.del}>` YAZMA, bunu kullan. */
export const SilDugmesi = ({ ad, sonuc, onSil, title, ikon = "✕", className = "row-end", style }: {
  /** silinecek kaydın adı — onay kutusunda gösterilir ("hangisini siliyorum?") */
  ad: React.ReactNode;
  /** bu silmenin yan etkisi; yoksa yalnız "kalıcı olarak silinecek" yazılır */
  sonuc?: React.ReactNode;
  onSil: () => void | Promise<void>;
  title?: string;
  ikon?: string;
  className?: string;
  /** css.del üzerine eklenir (satır içi küçük ✕'ler için) */
  style?: React.CSSProperties;
}) => {
  const [acik, setAcik] = React.useState(false);
  const [siliniyor, setSiliniyor] = React.useState(false);
  const sil = async () => {
    setSiliniyor(true);
    try { await onSil(); setAcik(false); } finally { setSiliniyor(false); }
  };
  return (<>
    <button className={className} style={{ ...css.del, ...style }} title={title ?? "Sil"} aria-label="Sil"
      onClick={() => setAcik(true)}>{ikon}</button>
    {acik && (
      <Modal title="Silinsin mi?" onClose={() => !siliniyor && setAcik(false)}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          <b>{ad}</b> kalıcı olarak silinecek.
          {sonuc && <div style={{ fontSize: 13, color: T.mut, marginTop: 8 }}>{sonuc}</div>}
          <div style={{ fontSize: 12.5, color: T.mut3, marginTop: 8 }}>Bu işlem geri alınamaz.</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button style={css.ghost} disabled={siliniyor} onClick={() => setAcik(false)}>Vazgeç</button>
          <button disabled={siliniyor} onClick={sil} style={{
            ...css.btn, background: T.neg, color: "#fff", opacity: siliniyor ? 0.6 : 1,
          }}>{siliniyor ? "Siliniyor…" : "Sil"}</button>
        </div>
      </Modal>
    )}
  </>);
};

export const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: T.bg, minHeight: "100vh", color: T.mut, display: "grid", placeItems: "center", fontFamily: T.disp, padding: 24, textAlign: "center" }}>
    {children}
  </div>
);

/** Basit modal: overlay tıklaması ve Escape kapatır.
 *
 *  PORTAL ŞART — `document.body`'ye taşınmazsa yanlış yerde açılır. Sekme içeriği
 *  (`.tab-grid`, App.tsx) `animation: fadeUp .4s ease both` taşır; `both` dolgu modu
 *  animasyon bittikten sonra da transform'u "dolduruyor" sayılır ve tarayıcı bu öğeyi
 *  `position:fixed` için KAPSAYICI BLOK yapar. Sonuç: `inset:0` viewport'u değil binlerce
 *  piksellik sekme kutusunu kaplar, modal ekranın çok aşağısında ortalanır. Sekme içinden
 *  açılan her modal (EditSheet, SilDugmesi onayı) bundan etkileniyordu. */
export const Modal = ({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) => {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  /* modal açıkken arka plan kaymasın (mobilde kutu kaybolup sayfa kayıyordu) */
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50, background: "rgba(10,8,18,.45)", backdropFilter: "blur(2px)",
      display: "grid", placeItems: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...css.card, width: "100%", maxWidth: 600, maxHeight: "88vh", overflowY: "auto", boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button style={css.del} aria-label="Kapat" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
};
