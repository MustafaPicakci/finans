import React, { useEffect, useState } from "react";
import {
  num, parseD, fmtD, todayStr, ilkProjeksiyon, balancesByAccount, loanRemaining, recAmountOn, ACCOUNT_KIND_LABEL,
  type AllData, type AccountKind, type Day, type Recurring,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Row, SilDugmesi, Empty, Aciklama } from "../../ui";
import { Segment } from "../forms/parcalar";
import { pushDestekli, buCihaz, bildirimAc } from "../../bildirim";

/* ————— Kurulum sihirbazı —————
   Uygulamanın değeri ("ay sonunda elimde ne kalacak") ancak hesaplar, gelir, kartlar, düzenli
   giderler ve krediler girilince görünür; bunlar sekiz sekmeye dağılmış tanım formlarıdır ve
   yeni kullanıcı boş bir Özet'le karşılaşıyordu. Sihirbaz aynı tanımları tek bir sırayla sorar.

   Yeni bir yazma yolu YOKTUR: her satır aynı uca, aynı gövdeyle gider (`api.post` → `yaz()` boru
   hattı — şifreleme dahil), yani burada eklenen hesap Hesaplar sekmesinde eklenenden farksızdır.
   Her satır EKLENDİĞİ AN kaydedilir: sonraki adımlar öncekinin id'lerine bağlanır (maaş hangi
   hesaba yatıyor) ve yarıda bırakılan kurulum kaybolmaz — sihirbaz yeniden açılınca girilenleri
   listeler. Kendiliğinden yalnız hiçbir şey girilmemiş hesaba açılır (`kurulumGerekli`). */

type Adim = "hesap" | "gelir" | "kart" | "gider" | "kredi" | "sonuc";
const ADIMLAR: { k: Adim; baslik: string; soru: string }[] = [
  { k: "hesap", baslik: "Hesaplar", soru: "Paran nerede duruyor? Banka hesaplarını ve bugünkü bakiyelerini ekle." },
  { k: "gelir", baslik: "Gelirler", soru: "Her ay düzenli ne geliyor? Maaş, kira geliri…" },
  { k: "kart", baslik: "Kredi kartları", soru: "Kartlarını kesim ve son ödeme günleriyle ekle." },
  { k: "gider", baslik: "Düzenli giderler", soru: "Her ay aynı gün çıkan paralar: kira, aidat, faturalar…" },
  { k: "kredi", baslik: "Krediler", soru: "Ödemekte olduğun krediler ve kalan taksitleri." },
  { k: "sonuc", baslik: "Hazır", soru: "Girdiklerine göre önümüzdeki günler." },
];
const GIDER_CIPLERI = ["Kira", "Aidat", "Elektrik", "Doğalgaz", "Su", "İnternet", "Telefon"];

export function Kurulum({ data, days, reload, onBitir }: {
  data: AllData; days: Day[]; reload: () => void | Promise<void>;
  /** sihirbazdan çıkış (bitir ya da tamamen atla) — Özet'e döner */
  onBitir: () => void;
}) {
  const [i, setI] = useState(0);
  const adim = ADIMLAR[i];
  const son = i === ADIMLAR.length - 1;
  /* adımda en az bir kayıt varsa düğme "İleri", yoksa "Bu adımı atla" — ikisi aynı işi yapar ama
     boş adımda "İleri" demek kullanıcıya bir şey eksik bırakmadığını ima ederdi */
  const dolu: Record<Adim, boolean> = {
    hesap: data.accounts.length > 0, gelir: data.recurring.some((r) => r.kind === "income"),
    kart: data.cards.length > 0, gider: data.recurring.some((r) => r.kind === "expense"),
    kredi: data.loans.length > 0, sonuc: true,
  };
  const git = (n: number) => { setI(n); window.scrollTo({ top: 0 }); };

  return (<>
    <div style={{ ...css.card, maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: T.mut, whiteSpace: "nowrap" }}>{i + 1} / {ADIMLAR.length}</span>
        {/* ilerleme: adımlar arasında serbest gezinme — sıra bir öneri, zorunluluk değil */}
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {ADIMLAR.map((a, n) => (
            <button key={a.k} aria-label={a.baslik} title={a.baslik} onClick={() => git(n)} style={{
              flex: 1, height: 5, minHeight: 0, padding: 0, border: "none", borderRadius: 99, cursor: "pointer",
              background: n <= i ? T.acc : T.line,
            }} />
          ))}
        </div>
        {!son && <button style={{ background: "none", border: "none", padding: "4px 0", minHeight: 0, color: T.mut, fontSize: 13.5, fontFamily: T.disp, cursor: "pointer" }} onClick={onBitir}>Sonra</button>}
      </div>
      <h2 style={{ margin: "0 0 4px", fontSize: 21, fontFamily: T.disp }}>{adim.baslik}</h2>
      <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.45, marginBottom: 14 }}>{adim.soru}</div>

      {adim.k === "hesap" && <HesapAdimi data={data} reload={reload} />}
      {adim.k === "gelir" && <KalemAdimi kind="income" data={data} reload={reload} />}
      {adim.k === "kart" && <KartAdimi data={data} reload={reload} />}
      {adim.k === "gider" && <KalemAdimi kind="expense" data={data} reload={reload} />}
      {adim.k === "kredi" && <KrediAdimi data={data} reload={reload} />}
      {adim.k === "sonuc" && <Sonuc data={data} days={days} />}

    </div>
    {/* Eylem çubuğu altta yapışık (telefonda alt menünün üstünde — .ice-eylem): adımın formu uzayınca
        "İleri" ekranın altında kaybolmasın. Düğme bir sonraki adımın ADINI söyler. */}
    <div className="ice-eylem" style={{ ...css.card, maxWidth: 720, width: "100%", margin: "0 auto", padding: "10px 12px", display: "flex", gap: 8, zIndex: 5, boxShadow: "var(--shadow)" }}>
      {i > 0 && <button style={{ ...css.ghost, height: 48 }} onClick={() => git(i - 1)}>Geri</button>}
      {son
        ? <button style={{ ...css.btn, flex: 1, height: 48, fontSize: 15.5 }} onClick={onBitir}>Özet'e git</button>
        : <button style={{ ...(dolu[adim.k] ? css.btn : css.ghost), flex: 1, height: 48, fontSize: 15.5 }} onClick={() => git(i + 1)}>
          {dolu[adim.k] ? `İleri: ${ADIMLAR[i + 1].baslik}` : "Bu adımı atla"}
        </button>}
    </div>
    </>
  );
}

/** Ekleme formu sarmalayıcısı: kaydederken düğmeyi kilitler, hatayı formun altında gösterir.
    Hata yutulmaz — "eklendi" sanılıp geçilen bir satır sonraki adımda eksik çıkardı. */
function useKaydet(reload: () => void | Promise<void>) {
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const kaydet = async (fn: () => Promise<unknown>) => {
    setMesgul(true); setHata(null);
    try { await fn(); await reload(); return true; } catch (e) { setHata(e instanceof Error ? e.message : String(e)); return false; } finally { setMesgul(false); }
  };
  return { mesgul, hata, kaydet };
}
const HataSatiri = ({ hata }: { hata: string | null }) =>
  hata ? <div style={{ fontSize: 12.5, color: T.neg, marginTop: 8 }}>Kaydedilemedi: {hata}</div> : null;
const EkleDugmesi = ({ ok, mesgul }: { ok: boolean; mesgul: boolean }) => (
  <button type="submit" disabled={!ok || mesgul} style={{ ...css.btn, alignSelf: "flex-end", opacity: ok && !mesgul ? 1 : 0.5 }}>
    {mesgul ? "…" : "Ekle"}
  </button>
);
/** Ekleme alanı kendi kutusunda (yeniden tasarım, grup 8): eklenenlerin listesinden ayrışsın */
const formKutu: React.CSSProperties = { marginTop: 14, padding: "4px 12px 12px", border: `1px solid ${T.line}`, borderRadius: 14, background: T.panel2 };
const gunGecerli = (s: string) => +s >= 1 && +s <= 31 && Number.isInteger(+s);

function HesapAdimi({ data, reload }: { data: AllData; reload: () => void | Promise<void> }) {
  const bakiyeler = balancesByAccount(data.account_entries);
  const [f, setF] = useState({ kind: "banka" as AccountKind, name: "", balance: "" });
  const { mesgul, hata, kaydet } = useKaydet(reload);
  const ok = !!f.name.trim() && /^-?\s*[\d.,]+$/.test(f.balance.trim() || "0");
  return (<>
    {data.accounts.length === 0 ? <Empty>Henüz hesap yok.</Empty> : data.accounts.map((a, n) => (
      <Row key={a.id} last={n === data.accounts.length - 1}>
        <span className="row-title" style={{ flex: 1, minWidth: 0 }}>{a.name} <span style={{ color: T.mut3, fontSize: 12 }}>· {ACCOUNT_KIND_LABEL[a.kind ?? "banka"]}</span></span>
        <span className="row-amount" style={{ ...css.mono, marginLeft: "auto" }}>{tl.format(bakiyeler.get(a.id) ?? 0)}</span>
        <SilDugmesi ad={a.name} onSil={async () => { await api.del("accounts", a.id); await reload(); }}
          sonuc="Açılış bakiyesi net varlığından düşer; bu hesaba bağlanan düzenli kalemler hedefsiz kalır." />
      </Row>
    ))}
    <form style={formKutu} onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      if (await kaydet(() => api.post("accounts", { name: f.name.trim(), balance: num(f.balance), kind: f.kind })))
        setF({ ...f, name: "", balance: "" });
    }}>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flexBasis: "100%", display: "flex", paddingTop: 8 }}>
          <Segment kucuk ad="Hesap türü" deger={f.kind} sec={(k) => setF({ ...f, kind: k })}
            secenek={(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => ({ v: k, l: ACCOUNT_KIND_LABEL[k] }))} />
        </div>
        <Field label="Ad" flex={2}><input style={css.input} value={f.name} placeholder={f.kind === "nakit" ? "örn. Cüzdan" : "örn. Garanti"} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Bugünkü bakiye (TL)" value={f.balance} onChange={(v) => setF({ ...f, balance: v })} sign="serbest" />
        <EkleDugmesi ok={ok} mesgul={mesgul} />
      </div>
    </form>
    <HataSatiri hata={hata} />
    <Aciklama label="hangi hesapları eklemeliyim?" k="kurulum-hesap">
      Parasını takip etmek istediğin her yeri: banka hesapları, cüzdandaki nakit (tür: Nakit) ve
      yatırım yaptığın aracı kurum (tür: Aracı kurum). Nakit cüzdanı eklersen ATM'den çektiğin para
      gider sayılmaz, bir hesaptan diğerine geçmiş olur. Eksi bakiye (KMH) de girilebilir.
    </Aciklama>
  </>);
}

/** Düzenli gelir ve düzenli gider aynı adımdır — tek farkları tür ve hedef seçenekleri. */
function KalemAdimi({ kind, data, reload }: { kind: Recurring["kind"]; data: AllData; reload: () => void | Promise<void> }) {
  const gelir = kind === "income";
  const ilkHesap = data.accounts[0] ? `acc:${data.accounts[0].id}` : "";
  const bos = { name: gelir ? "Maaş" : "", amount: "", day: "", target: ilkHesap, auto: true };
  const [f, setF] = useState(bos);
  const { mesgul, hata, kaydet } = useKaydet(reload);
  const kalemler = data.recurring.filter((r) => r.kind === kind);
  const ym = todayStr().slice(0, 7);
  const tutar = (r: Recurring) => recAmountOn(data.recurring_amounts.filter((x) => x.recurring_id === r.id), ym) ?? 0;
  const hedefAdi = (r: Recurring) => r.account_id != null ? data.accounts.find((a) => a.id === r.account_id)?.name
    : r.card_id != null ? data.cards.find((c) => c.id === r.card_id)?.name : null;
  const ok = !!f.name.trim() && num(f.amount) > 0 && gunGecerli(f.day);
  return (<>
    {kalemler.length === 0 ? <Empty>Henüz {gelir ? "düzenli gelir" : "düzenli gider"} yok.</Empty> : kalemler.map((r, n) => (
      <Row key={r.id} last={n === kalemler.length - 1}>
        {/* gün Plan sekmesindeki kalıpla yazılır ("ayın 15. günü") — "15'i" gibi bir ek sayıya göre
            değişir (1'i, 2'si, 6'sı) ve sabit yazılınca çoğu günde yanlış çıkar */}
        <span className="row-title" style={{ flex: 1, minWidth: 0 }}>{r.name}
          <span style={{ color: T.mut3, fontSize: 12 }}> · ayın {r.day}. günü{hedefAdi(r) && ` · ${hedefAdi(r)}`}</span></span>
        <span className="row-amount" style={{ ...css.mono, marginLeft: "auto", color: gelir ? T.pos : T.text }}>{gelir ? "+" : "−"}{tl.format(tutar(r))}</span>
        <SilDugmesi ad={r.name} onSil={async () => { await api.del("recurring", r.id); await reload(); }}
          sonuc="Kalem nakit akışı tahmininden çıkar." />
      </Row>
    ))}
    {!gelir && (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        {GIDER_CIPLERI.filter((c) => !kalemler.some((k) => k.name === c)).map((c) => (
          <button key={c} type="button" style={{ ...css.chip, ...(f.name === c ? { borderColor: T.acc, color: T.acc } : {}) }}
            onClick={() => setF({ ...f, name: c })}>{c}</button>
        ))}
      </div>
    )}
    <form style={formKutu} onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      const account_id = f.target.startsWith("acc:") ? +f.target.slice(4) : null;
      const card_id = f.target.startsWith("card:") ? +f.target.slice(5) : null;
      const body = {
        kind, name: f.name.trim(), day: +f.day, from_month: null, to_month: null,
        account_id, card_id, category_id: null, auto: !!f.target && f.auto, amount: num(f.amount),
      };
      if (await kaydet(() => api.post("recurring", body))) setF({ ...bos, name: "", target: f.target, auto: f.auto });
    }}>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={f.name} placeholder={gelir ? "örn. Maaş" : "örn. Kira"} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Aylık tutar (TL)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field label="Ayın kaçı"><input style={css.input} inputMode="numeric" placeholder="1-31" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={gelir ? "Hangi hesaba yatıyor" : "Nereden ödeniyor"} flex={2}>
          <select style={css.input} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
            <option value="">Belirtme (yalnız tahmin)</option>
            {data.accounts.map((a) => <option key={`a${a.id}`} value={`acc:${a.id}`}>{a.name}</option>)}
            {!gelir && data.cards.map((c) => <option key={`c${c.id}`} value={`card:${c.id}`}>Kart: {c.name}</option>)}
          </select>
        </Field>
        <EkleDugmesi ok={ok} mesgul={mesgul} />
      </div>
      {f.target && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} />
          Günü gelince kendiliğinden {f.target.startsWith("card:") ? "karta" : "hesaba"} işlensin
        </label>
      )}
    </form>
    <HataSatiri hata={hata} />
    <Aciklama label="kendiliğinden işlensin ne demek?" k="kurulum-kalem">
      İşaretliyse kalem her ay günü geldiğinde seçtiğin {gelir ? "hesaba gelir" : "hesaptan ya da karttan gider"} olarak
      yazılır ve bakiye kendiliğinden güncellenir; bugünden önceki aylara dokunulmaz. İşaretsizse kalem yalnız
      tahminde görünür, gerçekleştiğinde Plan sekmesinden "Gerçekleşti" ile işlersin. Tutar değişirse Plan'daki
      "Değiştir" ile o aydan itibaren yenisini girersin.
    </Aciklama>
  </>);
}

function KartAdimi({ data, reload }: { data: AllData; reload: () => void | Promise<void> }) {
  const [f, setF] = useState({ name: "", limit: "", kesim: "", sonOdeme: "", odeme: "" });
  const { mesgul, hata, kaydet } = useKaydet(reload);
  const ok = !!f.name.trim() && gunGecerli(f.kesim) && gunGecerli(f.sonOdeme);
  return (<>
    {data.cards.length === 0 ? <Empty>Henüz kart yok.</Empty> : data.cards.map((c, n) => (
      <Row key={c.id} last={n === data.cards.length - 1}>
        <span className="row-title" style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
        <span className="row-amount" style={{ fontSize: 12.5, color: T.mut, marginLeft: "auto" }}>kesim {c.statement_day} · son ödeme {c.due_day}</span>
        <SilDugmesi ad={c.name} onSil={async () => { await api.del("cards", c.id); await reload(); }}
          sonuc="Karta girilmiş harcamalar da silinir." />
      </Row>
    ))}
    <form style={formKutu} onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      const body = {
        name: f.name.trim(), limit_amount: num(f.limit), statement_day: +f.kesim, due_day: +f.sonOdeme,
        pay_account_id: f.odeme ? +f.odeme : null,
      };
      if (await kaydet(() => api.post("cards", body))) setF({ name: "", limit: "", kesim: "", sonOdeme: "", odeme: f.odeme });
    }}>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Field label="Kart adı" flex={2}><input style={css.input} value={f.name} placeholder="örn. Bonus" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kesim günü"><input style={css.input} inputMode="numeric" placeholder="1-31" value={f.kesim} onChange={(e) => setF({ ...f, kesim: e.target.value })} /></Field>
        <Field label="Son ödeme günü"><input style={css.input} inputMode="numeric" placeholder="1-31" value={f.sonOdeme} onChange={(e) => setF({ ...f, sonOdeme: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <AmountField label="Limit (TL, ops.)" value={f.limit} onChange={(v) => setF({ ...f, limit: v })} />
        <Field label="Ekstre otomatik ödensin mi" flex={2}>
          <select style={css.input} value={f.odeme} onChange={(e) => setF({ ...f, odeme: e.target.value })}>
            <option value="">Hayır, elle öderim</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>Evet, {a.name} hesabından</option>)}
          </select>
        </Field>
        <EkleDugmesi ok={ok} mesgul={mesgul} />
      </div>
    </form>
    <HataSatiri hata={hata} />
    <Aciklama label="kesim ve son ödeme günü nerede yazar?" k="kurulum-kart">
      İkisi de ekstrenin üstünde yazar. Kesim günü, harcamaların hangi ekstreye gireceğini belirler; son ödeme
      günü, paranın hesabından çıkacağı gündür. Kart harcamalarını daha sonra "+ Ekle" ile girersin;
      bugünkü ekstre borcunu da ilk harcama olarak girebilirsin.
    </Aciklama>
  </>);
}

function KrediAdimi({ data, reload }: { data: AllData; reload: () => void | Promise<void> }) {
  const [f, setF] = useState({ name: "", amount: "", kalan: "", sonraki: "" });
  const { mesgul, hata, kaydet } = useKaydet(reload);
  const bugun = parseD(todayStr());
  const ok = !!f.name.trim() && num(f.amount) > 0 && Number.isInteger(+f.kalan) && +f.kalan >= 1 && !!f.sonraki;
  return (<>
    {data.loans.length === 0 ? <Empty>Henüz kredi yok.</Empty> : data.loans.map((l, n) => (
      <Row key={l.id} last={n === data.loans.length - 1}>
        <span className="row-title" style={{ flex: 1, minWidth: 0 }}>{l.name} <span style={{ color: T.mut3, fontSize: 12 }}>· {loanRemaining(l, bugun)} taksit kaldı</span></span>
        <span className="row-amount" style={{ ...css.mono, marginLeft: "auto" }}>{tl.format(l.amount)}/ay</span>
        <SilDugmesi ad={l.name} onSil={async () => { await api.del("loans", l.id); await reload(); }}
          sonuc="Kalan taksitler nakit akışından ve borç toplamından çıkar." />
      </Row>
    ))}
    {/* Kullanıcı kredinin İLK taksit tarihini ve TOPLAM taksit sayısını çoğu zaman hatırlamaz,
        ama "kaç taksit kaldı, sıradaki ne zaman" sorusunu bilir. Kalan taksit sayısı ilk tarih +
        toplamdan türediği için (loanRemaining) sıradaki taksiti "ilk", kalanı "toplam" yazmak
        projeksiyonu ve borcu birebir aynı verir — yeni bir alan ya da kural gerekmez. */}
    <form style={formKutu} onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      const body = { name: f.name.trim(), amount: num(f.amount), first_date: f.sonraki, total: +f.kalan };
      if (await kaydet(() => api.post("loans", body))) setF({ name: "", amount: "", kalan: "", sonraki: "" });
    }}>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={f.name} placeholder="örn. Taşıt kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Aylık taksit (TL)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Field label="Kalan taksit"><input style={css.input} inputMode="numeric" placeholder="örn. 18" value={f.kalan} onChange={(e) => setF({ ...f, kalan: e.target.value })} /></Field>
        <Field label="Sıradaki taksit"><input type="date" style={css.input} value={f.sonraki} min={todayStr()} onChange={(e) => setF({ ...f, sonraki: e.target.value })} /></Field>
        <EkleDugmesi ok={ok} mesgul={mesgul} />
      </div>
    </form>
    <HataSatiri hata={hata} />
  </>);
}

function Sonuc({ data, days }: { data: AllData; days: Day[] }) {
  const p = ilkProjeksiyon(days);
  const tarih = (k: string) => fmtD(parseD(k), { day: "numeric", month: "long" });
  if (!data.accounts.length || !p) {
    return <Empty>Hesap eklemeden nakit tahmini çıkmaz. İlk adıma dönüp en az bir hesap ekleyebilirsin.</Empty>;
  }
  const kutu = (etiket: string, deger: number, alt?: string) => (
    <div style={{ flex: 1, minWidth: 150, background: T.panel2, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: T.mut, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{etiket}</div>
      <div style={{ ...css.mono, fontSize: 18, marginTop: 4, color: deger < 0 ? T.neg : T.text }}>{tl.format(deger)}</div>
      {alt && <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>{alt}</div>}
    </div>
  );
  return (<>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {kutu("Bugün", p.bugun, "hesaplarındaki nakit")}
      {kutu("Ay sonunda", p.aySonu.bal, tarih(p.aySonu.k))}
      {kutu("En dar gün", p.enDusuk.bal, `${tarih(p.enDusuk.k)} · 60 gün içinde`)}
    </div>
    {p.enDusuk.bal < 0 && (
      <div style={{ fontSize: 13, color: T.neg, marginTop: 10 }}>
        {tarih(p.enDusuk.k)} günü nakdin eksiye düşüyor. Nakit Akışı sekmesinde o güne hangi ödemelerin denk geldiğini görebilirsin.
      </div>
    )}
    <BildirimDaveti />
    <div style={{ fontSize: 13, color: T.mut, marginTop: 12, lineHeight: 1.55 }}>
      Bundan sonra harcamalarını <b>+ Ekle</b> düğmesiyle girersin. Yanlış görünen bir rakamı ilgili sekmeden düzeltebilirsin.
    </div>
  </>);
}

/* Bildirim izni BURADA istenir (Faz 44): ilk açılışta sormak bağlamsız bir izin penceresi olurdu
   ve "Engelle" denirse sayfa bir daha soramaz. Burada kullanıcı az önce kira/kart/kredi günlerini
   girdi — "bunlardan 3 gün önce haber vereyim mi" sorusunun anlamı ekranda duruyor. */
function BildirimDaveti() {
  const [durum, setDurum] = useState<"soru" | "mesgul" | "tamam" | "yok">(() => pushDestekli() && Notification.permission !== "denied" ? "soru" : "yok");
  const [mesaj, setMesaj] = useState<string | null>(null);
  useEffect(() => { buCihaz().then((s) => { if (s) setDurum("tamam"); }).catch(() => {}); }, []);
  if (durum === "yok") return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.line}` }}>
      <div style={{ flex: 1, minWidth: 190, fontSize: 13 }}>
        {durum === "tamam" ? "Ödemelerden 3 gün önce bildirim alacaksın." : "Kira, taksit ve ekstre günlerinden 3 gün önce haber vereyim mi?"}
        {mesaj && <div style={{ fontSize: 12, color: T.neg, marginTop: 4 }}>{mesaj}</div>}
      </div>
      {durum !== "tamam" && (
        /* ikincil stil: bu adımda "sıradaki eylem" Özet'e git'tir (mor ona ayrılmış, Faz 24 kural 2);
           bildirim isteğe bağlı bir davet */
        <button style={css.ghost} disabled={durum === "mesgul"} onClick={async () => {
          setDurum("mesgul"); setMesaj(null);
          const r = await bildirimAc().catch((e) => ({ ok: false, mesaj: e instanceof Error ? e.message : String(e) }));
          setDurum(r.ok ? "tamam" : "soru"); if (!r.ok) setMesaj(r.mesaj);
        }}>{durum === "mesgul" ? "…" : "Bildirimleri aç"}</button>
      )}
    </div>
  );
}
