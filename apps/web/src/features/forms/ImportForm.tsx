import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  parseStatement, parseIslemler, dokumKarsilastir, hesapDefteri, kartDefteri, hedefTahmin, type IslemSonucu, type HedefTahmini,
  type AllData, type Dogrulama, type ParsedRow, type DefterKaydi, type DokumDurum, type DokumKarsilastirma, type KonumluSatir,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { DahaFazla, Field, FiltreSeridi, useSayfalama } from "../../ui";
import { kalemSuggestions, normName } from "./recall";
import { belgeOku, PdfParolaGerekli } from "./pdfOku";
import { IslemOnizleme } from "./IslemOnizleme";
import { bellek, useKalici, iceAktarTemizle } from "./iceAktarBellek";
export { iceAktarTemizle };

/* ————— TOPLU İÇE AKTARMA (EKSTRE YAPIŞTIRMA / PDF) —————
   Banka/aracı kurum ekstresini ya da Excel tablosunu olduğu gibi yapıştır — ya da e-ekstre
   PDF'ini seç (Faz 45: tarayıcıda okunur, metni bu kutuya yazılır; bkz. pdfOku.ts) → satırlar
   `parseStatement` (engine, testli) ile ayrıştırılır → önizleme tablosunda düzeltilir →
   tek istekte (`POST /api/transactions/bulk`, atomik) deftere yazılır.
   Kategori tahmini geçmiş kayıtlardan yapılır.

   Faz 45.4 — "hepsini yaz" DEĞİL "farkı göster": döküm hedefin defteriyle karşılaştırılır
   (`dokumKarsilastir`, engine) ve yalnız EKSİK satırlar önden seçili gelir. Böylece aynı döküm
   eksikleri tamamlamak için de kullanılır; zaten girilmiş kayıt ikinci kez yazılmaz, açılış
   bakiyesinin içinde sayılmış geçmiş bakiyeyi şişirmez. */

/** `virman` (Faz 45.8): "" = gelir/gider; bir hesap kimliği = o hesapla virman (kendi hesapların arası) */
type Draft = ParsedRow & { include: boolean; category_id: string; durum: DokumDurum; kayit?: DefterKaydi; virman: string };
type Filtre = DokumDurum | "hepsi";
const FILTRE_ADI: Record<Filtre, string> = {
  eksik: "Eksik", farkli: "Farklı", eslesti: "Defterde", acilis: "Açılıştan önce", odeme: "Ödeme", hepsi: "Hepsi",
};
/** Çok yıllık dökümde "09-03" belirsiz kalırdı */
const kisaTarih = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

export function ImportForm({ data, reload, onClose: kapat }: { data: AllData; reload: () => void; onClose: () => void }) {
  const [text, setText] = useKalici("text", "");
  /* Hedef (Faz 45): "a:<hesap>" gerçekleşen işlem (+bakiye), "c:<kart>" kart harcaması, "" yalnız defter.
     Kart ekstresinin doğru yeri kart harcamalarıdır: hesaba yazılsa harcamalar karttan değil
     hesaptan çıkmış gibi olur ve ekstre ödemesiyle birlikte iki kez sayılırdı. */
  /* `secim` kullanıcının seçicideki değeri ("oto" = belgeden bul, varsayılan); `hedef` çözülmüş hâli —
     aşağıdaki her şey hedefe bakar. "Nereye"yi sormak hataya açıktı: Axess kart ekstresi Akbank
     hesabına seçildi (bkz. engine hedef.ts `hedefTahmin`). */
  const [secim, setSecim] = useKalici("secim", "oto");
  const [hedef, setHedef] = useKalici("hedef", "");
  const [oto, setOto] = useKalici<HedefTahmini | null>("oto", null);
  const accountId = hedef.startsWith("a:") ? hedef.slice(2) : "";
  const cardId = hedef.startsWith("c:") ? +hedef.slice(2) : null;
  const kart = cardId != null ? data.cards.find((c) => c.id === cardId) : undefined;
  /* Faz 45.9 — "t:<hesap>" / "t:": aracı kurum ekstresi → portföy işlemleri (ayrı önizleme, IslemOnizleme) */
  const islemModu = hedef.startsWith("t:");
  const islemHesap = islemModu && hedef.length > 2 ? +hedef.slice(2) : null;
  const [islemSonuc, setIslemSonuc] = useKalici<IslemSonucu | null>("islemSonuc", null);
  /** Kart hedefinde karta para GİREN satır (ekstre ödemesi, iade) aktarılmaz: ödeme Kart sekmesinde
      "Ödedim" ile kaydedilir (burada da yazılsa iki kez sayılırdı) ve kart harcaması modelinde iade yok. */
  const kartaGiren = (r: ParsedRow) => cardId != null && r.amount > 0;
  const [drafts, setDrafts] = useKalici<Draft[] | null>("drafts", null);
  const [fazla, setFazla] = useKalici<DefterKaydi[]>("fazla", []);
  const [filtre, setFiltre] = useKalici<Filtre>("filtre", "eksik");
  /** Faz 45.7 — açılıştan önceki satırlar eklenirken açılış hareketi aynı toplam kadar geri çekilsin mi */
  const [acilisGeri, setAcilisGeri] = useKalici("acilisGeri", false);
  const [duzeltilen, setDuzeltilen] = useState<number | null>(null);
  const [skipped, setSkipped] = useKalici<string[]>("skipped", []);
  const [dogrulama, setDogrulama] = useKalici<Dogrulama>("dogrulama", { tur: "yok" });
  const [bozukHarf, setBozukHarf] = useKalici("bozukHarf", false);
  /** Hesap hedefinde okunan belge aslında kart ekstresiyse (kart kipinde dönem borcu bulundu) o borç;
      kullanıcı yanlış hedef seçmiş olabilir — ödeme gelir, harcamalar hesaptan çıkmış gibi yazılırdı. */
  const [kartIpucu, setKartIpucu] = useKalici<number | null>("kartIpucu", null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* PDF: dosya parolalıysa elde tutulur, parola sorulur. Parola yalnız bu cihazda PDF'i açmak için. */
  const [pdf, setPdf] = useState<{ dosya: File; parolaIste: boolean; yanlis: boolean; okunuyor: boolean } | null>(null);
  const [parola, setParola] = useState("");
  /* PDF'ten gelen KONUMLU satırlar (sütunlar konumdan bulunur) ve onlardan üretilen metin. Kullanıcı
     kutudaki metni düzenlerse konum geçersiz olur ve düz metin ayrıştırılır. */
  const [konumlu, setKonumlu] = useKalici<{ satirlar: KonumluSatir[]; metin: string } | null>("konumlu", null);
  /** okuma sürerken okuyucunun söylediği adım ("Sayfa 1/2 … OCR %40"); bittikten sonra kaç sayfanın OCR'la okunduğu */
  const [ilerleme, setIlerleme] = useState("");
  const [ocrSayfa, setOcrSayfa] = useKalici("ocrSayfa", 0);
  /** Son okunan PDF (ve parolası): önizlemeden "OCR ile yeniden oku" için elde tutulur. */
  const [sonBelge, setSonBelge] = useKalici<{ dosya: File; parola?: string; sayfa: number } | null>("sonBelge", null);
  const [yenidenOkunuyor, setYenidenOkunuyor] = useState(false);
  /** Çıkış: bitmiş (kaydedilmiş ya da vazgeçilmiş) iş bellekten silinir. Sekme değiştirmek çıkış DEĞİLDİR. */
  const onClose = () => { iceAktarTemizle(); kapat(); };
  /** Seçili satır varken "Vazgeç" önce sorar: o seçimler okunan belgeyle birlikte silinecek. */
  const [cikisSor, setCikisSor] = useState(false);
  /** Ad/tutar düzenlemesi açık satır: satırlar salt okunur görünür, ✎ ile yalnız o satır alanlara döner.
      Eskiden her satırda üç giriş kutusu vardı (ad, tutar, kategori) ve telefonda satır üç sıraya
      yayılıyordu; ad/tutar düzeltmesi istisnadır (OCR hatası), kategori ise satırda kaldı. */
  const [duzenlenen, setDuzenlenen] = useState<number | null>(null);

  const sugs = useMemo(() => kalemSuggestions(data), [data]);
  /** geçmişte aynı/benzer adla girilmiş kaydın kategorisi (en sık kullanılan eşleşme) */
  const guessCategory = (name: string): number | null => {
    const n = normName(name);
    if (!n) return null;
    const hit = sugs.find((s) => normName(s.name) === n)
      ?? sugs.find((s) => s.category_id != null && (n.includes(normName(s.name)) || normName(s.name).includes(n)));
    return hit?.category_id ?? null;
  };
  /** Hedefin defteri: hesap → o hesabın bütün hareketleri; kart → o kartın harcamaları;
      "yalnız defter" → hesapsız gelir/gider kayıtları. */
  const karsilastir = (rows: ParsedRow[], h: string): DokumKarsilastirma => {
    if (h.startsWith("c:")) return dokumKarsilastir(rows, kartDefteri(data, +h.slice(2)), { kart: true });
    if (h.startsWith("a:")) {
      const { defter, acilis } = hesapDefteri(data, +h.slice(2));
      return dokumKarsilastir(rows, defter, { acilis });
    }
    return dokumKarsilastir(rows, data.transactions.filter((t) => t.account_id == null)
      .map((t) => ({ kimlik: `t${t.id}`, date: t.date, amount: t.amount, name: t.name, kaynak: { tablo: "transactions", id: t.id } })));
  };
  /** Satırları defterle karşılaştırıp durumlarını yazar; yalnız EKSİK olan önden seçilir. */
  const durumla = (rows: (ParsedRow & { category_id?: string })[], h = hedef): Draft[] => {
    const k = karsilastir(rows, h);
    setFazla(k.fazla);
    const d = rows.map((r, i) => ({
      ...r, durum: k.satirlar[i].durum, kayit: k.satirlar[i].kayit, include: k.satirlar[i].durum === "eksik", virman: "",
      category_id: r.category_id ?? (() => { const c = guessCategory(r.name); return c != null ? String(c) : ""; })(),
    }));
    setFiltre(d.some((x) => x.durum === "eksik") ? "eksik" : "hepsi");
    setAcilisGeri(false);
    return d;
  };

  /** `s`: seçici değeri; "oto" ise hedef belgeden tahmin edilir. Hedef state'i bu render'da henüz
      güncellenmediğinden çözülmüş hedef (`h`) aşağıya parametreyle geçer. */
  const analyze = (metin = text, satirlar = konumlu?.metin === metin ? konumlu.satirlar : null, s = secim) => {
    if (!satirlar) { setOcrSayfa(0); setSonBelge(null); }
    const tahmin = s === "oto" ? hedefTahmin(satirlar ?? metin, data) : null;
    const h = tahmin ? tahmin.hedef : s;
    setOto(tahmin); setHedef(h);
    const cardId = h.startsWith("c:") ? +h.slice(2) : null;
    if (h.startsWith("t:")) { setIslemSonuc(parseIslemler(satirlar ?? metin)); setErr(null); return; }
    /* Kart ekstresinin işaret dili farklıdır (harcama işaretsiz, ödeme "+" ya da "−" ile
       işaretli); ayrıştırıcı `kart` kipinde bunu çözer ve önizlemenin diliyle (− = harcama)
       döndürür. Yine de ters okunursa "işaretleri çevir" tek dokunuş. */
    const { rows, skipped, dogrulama, bozukHarf } = parseStatement(satirlar ?? metin, cardId != null ? "kart" : "gider");
    /* Belge kart kipinde "önceki dönem + harcamalar − ödemeler = dönem borcu" özetini taşıyorsa bir
       kart ekstresidir: hesap dökümünde bu satırlar yoktur. Hedef hesapsa söylenir (gerçek kullanımda
       Axess ekstresi Akbank hesabına seçildi; ödeme +19.394 gelir göründü). */
    const kartDog = cardId == null ? parseStatement(satirlar ?? metin, "kart").dogrulama : null;
    setKartIpucu(kartDog?.tur === "donem" ? kartDog.belge : null);
    setSkipped(skipped);
    setDogrulama(dogrulama);
    setBozukHarf(bozukHarf);
    setDrafts(durumla(rows, h));
    setErr(null);
  };
  /** Önizlemeden hedef değiştirme: belge yeni hedefle yeniden çözülür (dosyayı yeniden seçmeden). */
  const hedefDegistir = (v: string) => { setSecim(v); analyze(text, undefined, v); };
  /* Bellekten dönen önizleme, ayrıldığın sırada defterde değişen kayıtları bilmez (ör. Kartlar'da
     elle girilmiş kopyayı sildin). Veri değişince durumlar yeniden karşılaştırılır; durumu
     değişmeyen satırın seçimi korunur, yeni "eksik" seçili, zaten defterde olan seçimsiz gelir. */
  const sonVeri = useRef(bellek.veri as AllData | undefined);
  useEffect(() => {
    bellek.veri = data;
    if (sonVeri.current === data) return;
    sonVeri.current = data;
    if (!drafts || hedef.startsWith("t:")) return;
    const k = karsilastir(drafts, hedef);
    setFazla(k.fazla);
    setDrafts(drafts.map((d, i) => {
      const yeni = k.satirlar[i];
      return yeni.durum === d.durum ? { ...d, kayit: yeni.kayit } : { ...d, durum: yeni.durum, kayit: yeni.kayit, include: yeni.durum === "eksik" };
    }));
  }, [data]);

  const pdfOku = async (dosya: File, sifre?: string, ocrZorla = false) => {
    // yeni belge kutudakinin yerini alır: önceki metin kalsa parola sorulurken eski belge çözülebilirdi
    setPdf({ dosya, parolaIste: false, yanlis: false, okunuyor: true }); setErr(null); setText(""); setIlerleme("");
    try {
      const sonuc = await belgeOku(dosya, sifre, setIlerleme, ocrZorla);
      const { satirlar } = sonuc;
      const metin = satirlar.map((s) => s.map((h) => h.s).join("\t")).join("\n");
      setPdf(null); setParola(""); setIlerleme(""); setOcrSayfa(sonuc.ocrSayfa);
      setSonBelge(dosya.type === "application/pdf" || dosya.name.toLowerCase().endsWith(".pdf") ? { dosya, parola: sifre, sayfa: sonuc.sayfa } : null);
      if (!metin.trim()) { setErr("Bu belgede okunabilir metin bulunamadı."); return; }
      setText(metin);
      setKonumlu({ satirlar, metin });
      analyze(metin, satirlar);
    } catch (e) {
      if (e instanceof PdfParolaGerekli) { setPdf({ dosya, parolaIste: true, yanlis: e.yanlis, okunuyor: false }); return; }
      setPdf(null); setIlerleme("");
      setErr(e instanceof Error ? e.message : "Belge okunamadı");
    }
  };

  const kartaGec = (id: number) => hedefDegistir(`c:${id}`);

  const upd = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d!.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  /* Belgenin işaret dili bizimkinin tersi olabilir: kart ekstresinde harcama ARTI, ödeme eksi
     yazılır. Tek dokunuşla hepsi çevrilir; türü artık tutmayan kategori boşaltılır (gelir
     kategorisi gidere yazılmasın). */
  /* İşaret değişince eşleşme de değişir (gelir ≠ gider): karşılaştırma yeniden yapılır. */
  const isaretCevir = () => drafts && setDrafts(durumla(drafts.map((r) => {
    const amount = -r.amount;
    const kat = data.categories.find((c) => String(c.id) === r.category_id);
    const tutar = !kat || kat.kind === (amount < 0 ? "expense" : "income");
    return { date: r.date, name: r.name, amount, category_id: tutar ? r.category_id : "" };
  })));

  const chosen = drafts?.filter((d) => d.include) ?? [];
  const sum = chosen.reduce((s, d) => s + d.amount, 0);
  const sayac = useMemo(() => {
    const m = new Map<Filtre, number>([["hepsi", drafts?.length ?? 0]]);
    for (const d of drafts ?? []) m.set(d.durum, (m.get(d.durum) ?? 0) + 1);
    return m;
  }, [drafts]);
  const gorunen = useMemo(() => (drafts ?? []).map((d, i) => ({ d, i })).filter(({ d }) => filtre === "hepsi" || d.durum === filtre), [drafts, filtre]);
  const sayfa = useSayfalama(gorunen, 60, filtre);
  /* Mutabakat: dökümün en yeni bakiyesi (bankanın o günkü rakamı) ile aktarımdan SONRA defterin
     aynı günkü bakiyesi. Fark kalırsa var olan mutabakat akışı (Hesaplar) onu düzeltme olarak yazar. */
  /* Faz 45.7 — hesabın (en eski) açılış hareketi ve "geri çek" seçiliyse yeni hâli: tarih en eski
     seçili açılış-öncesi satırın günü, tutar eskisi eksi o satırların toplamı. Böylece bugünkü bakiye
     ve açılış gününden sonraki her gün değişmez; geçmiş deftere girer. */
  const acilisKaydi = useMemo(() => accountId
    ? data.account_entries.filter((e) => e.account_id === +accountId && e.kind === "acilis").sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[0] ?? null
    : null, [accountId, data.account_entries]);
  const acilisSecilen = chosen.filter((d) => d.durum === "acilis");
  const yeniAcilis = acilisGeri && acilisKaydi && acilisSecilen.length ? {
    date: acilisSecilen.map((d) => d.date).sort()[0],
    amount: Math.round((acilisKaydi.amount - acilisSecilen.reduce((s, d) => s + d.amount, 0)) * 100) / 100,
  } : null;
  const mutabakat = useMemo(() => {
    if (!accountId || dogrulama.tur !== "bakiye") return null;
    const { tarih, bakiye } = dogrulama.son;
    /* Açılış geri çekilecekse eski açılış hareketi YERİNE yenisi sayılır, ikisi de kendi TARİHİNE göre:
       hesap bugün açıldıysa eski açılış mutabakat gününden sonradır (sayılmaz) ama yenisi öncesindedir.
       Farkı eklemek bu durumda yanlıştı — uçtan uca testte önizleme "defter 0,00" diyordu, kaydedilen
       veri doğruyken. */
    const degisen = yeniAcilis && acilisKaydi ? acilisKaydi.id : null;
    const defter = data.account_entries
      .filter((e) => e.account_id === +accountId && e.date <= tarih && e.id !== degisen)
      .reduce((s, e) => s + e.amount, 0);
    const eklenecek = chosen.filter((d) => d.date <= tarih).reduce((s, d) => s + d.amount, 0);
    const yeniKatki = yeniAcilis && yeniAcilis.date <= tarih ? yeniAcilis.amount : 0;
    return { tarih, banka: bakiye, defter: Math.round((defter + eklenecek + yeniKatki) * 100) / 100 };
  }, [accountId, dogrulama, data.account_entries, chosen, yeniAcilis, acilisKaydi]);

  /* Faz 45.8 — virman: dökümde eksik çıkan satır kendi hesapların arası bir para hareketi olabilir
     ("Para Transferi" aracı kuruma, ATM'den nakde). Gelir/gider yazılsa para sistemden çıkmış gibi
     olurdu. Karşı hesapta aynı paranın kaydı (ters işaret, aynı tutar, ±3 gün) zaten varsa virman
     orada ikinci kez sayılır — engellenmez (kayıt yanlış türde girilmiş olabilir), SÖYLENİR. */
  const digerHesaplar = accountId ? data.accounts.filter((a) => a.id !== +accountId) : [];
  const karsiKayit = (d: Draft) => {
    if (!d.virman) return null;
    const { defter } = hesapDefteri(data, +d.virman);
    const gun = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
    return defter.find((k) => Math.abs(k.amount + d.amount) < 0.005 && gun(k.date, d.date) <= 3) ?? null;
  };

  /** "Farklı" satırın defterdeki karşılığını dökümdeki tutara düzeltir (yalnız gelir/gider ve tek
      çekimlik kart harcaması; virman/portföy/mevduat kendi ekranından). Kayıt YENİ yazılmaz. */
  const duzeltilebilir = (d: Draft) => {
    const k = d.kayit?.kaynak;
    return d.durum === "farkli" && !!k && (k.tablo === "transactions" || (k.tablo === "card_txs" && (d.kayit!.taksit ?? 1) <= 1));
  };
  const duzelt = async (i: number) => {
    const d = drafts![i], k = d.kayit!.kaynak!;
    setDuzeltilen(i); setErr(null);
    try {
      if (k.tablo === "transactions") {
        const t = data.transactions.find((x) => x.id === k.id);
        if (!t) throw new Error("Defterdeki kayıt bulunamadı");
        await api.put(`transactions/${t.id}`, { date: t.date, name: t.name, amount: d.amount, category_id: t.category_id, account_id: t.account_id });
      } else {
        const t = data.card_txs.find((x) => x.id === k.id);
        if (!t) throw new Error("Defterdeki kayıt bulunamadı");
        // önizleme hesap dilinde (− = harcama); kart harcaması tutarı artıdır
        await api.put(`cardtxs/${t.id}`, { card_id: t.card_id, date: t.date, name: t.name, amount: -d.amount, installments: t.installments, category_id: t.category_id ?? null });
      }
      upd(i, { durum: "eslesti", kayit: { ...d.kayit!, amount: d.amount }, include: false });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Düzeltilemedi");
    } finally {
      setDuzeltilen(null);
    }
  };

  const save = async () => {
    if (chosen.length === 0) return;
    setBusy(true); setErr(null);
    try {
      if (cardId != null) {
        // önizleme hesap diliyle (− = harcama) konuşur; kart harcaması tutarı artıdır
        /* Taksit payı alışverişin kendisi olarak yazılır (toplam + sayı + alış günü); paylar kart
           matematiğiyle ekstrelere dağılır. Pay elle değiştirildiyse toplam yeni paydan türer. */
        await api.bulkCardTxs(chosen.map((d) => {
          const t = d.taksit, pay = -d.amount;
          const toplam = !t ? pay : Math.abs(t.toplam / t.sayi - pay) <= 0.01 ? t.toplam : Math.round(pay * t.sayi * 100) / 100;
          return {
            card_id: cardId, date: t?.alis ?? d.date, name: d.name, amount: toplam, installments: t?.sayi ?? 1,
            category_id: d.category_id ? +d.category_id : null,
          };
        }));
      } else {
        const virmanlar = chosen.filter((d) => d.virman).map((d) => ({
          date: d.date, amount: Math.abs(d.amount), note: d.name,
          // bu hesaptan çıkan para → karşı hesaba; giren para ← karşı hesaptan
          from_account_id: d.amount < 0 ? +accountId : +d.virman, to_account_id: d.amount < 0 ? +d.virman : +accountId,
        }));
        await api.bulkTransactions(chosen.filter((d) => !d.virman).map((d) => ({
          date: d.date, name: d.name, amount: d.amount,
          category_id: d.category_id ? +d.category_id : null,
          account_id: accountId ? +accountId : null,
        })), {
          ...(yeniAcilis ? { acilis: { account_id: +accountId, ...yeniAcilis } } : {}),
          ...(virmanlar.length ? { virmanlar } : {}),
        });
      }
      reload();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  /** Hedef seçenekleri: 1. adımdaki seçici ile önizlemedeki "değiştir" seçicisi aynı listeyi gösterir. */
  const hedefSecenekleri = (
    <>
      {data.accounts.length > 0 && (
        <optgroup label="Hesap dökümü → hesap">
          {data.accounts.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} hesabı</option>)}
        </optgroup>
      )}
      {data.cards.length > 0 && (
        <optgroup label="Kart ekstresi → kart harcaması">
          {data.cards.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name} kartı</option>)}
        </optgroup>
      )}
      {data.accounts.length > 0 && (
        <optgroup label="Aracı kurum ekstresi → portföy işlemleri">
          {[...data.accounts].sort((a, b) => Number(b.kind === "araci") - Number(a.kind === "araci")).map((a) => (
            <option key={a.id} value={`t:${a.id}`}>{a.name} hesabına bağla</option>
          ))}
          <option value="t:">Hesaba bağlamadan</option>
        </optgroup>
      )}
      <option value="">Yalnız gelir/gider defteri (bakiyeye işleme)</option>
    </>
  );
  const TUR_ADI = { kart: "kart ekstresi", hesap: "hesap dökümü", islem: "aracı kurum ekstresi" } as const;

  if (islemSonuc) {
    return <div style={css.card}><IslemOnizleme data={data} sonuc={islemSonuc} accountId={islemHesap} reload={reload} onClose={onClose} onGeri={() => setIslemSonuc(null)} /></div>;
  }

  /* ——— 1. adım: metni yapıştır ——— */
  if (drafts === null) {
    return (
      <div style={css.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ ...css.ghost, display: "inline-flex", alignItems: "center", cursor: pdf?.okunuyor ? "wait" : "pointer" }}>
            {pdf?.okunuyor ? "Okunuyor…" : "PDF ya da ekran görüntüsü seç"}
            <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" hidden disabled={pdf?.okunuyor}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pdfOku(f); }} />
          </label>
          <span style={{ fontSize: 12, color: T.mut }}>{ilerleme || "Dosya bu cihazda okunur, hiçbir yere gönderilmez."}</span>
        </div>
        {pdf?.parolaIste && (
          <form onSubmit={(e) => { e.preventDefault(); if (parola) pdfOku(pdf.dosya, parola); }}
            style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
            <Field label={pdf.yanlis ? "Parola yanlış, tekrar dene" : "Bu PDF parolalı"} flex={2}>
              <input type="password" autoFocus style={css.input} value={parola} onChange={(e) => setParola(e.target.value)}
                placeholder="Bankanın bildirdiği parola" autoComplete="off" />
            </Field>
            <button type="submit" style={{ ...css.btn, opacity: parola ? 1 : 0.4 }} disabled={!parola}>Aç</button>
          </form>
        )}
        <div style={{ ...css.label, marginBottom: 6 }}>ya da ekstreyi / tabloyu yapıştır</div>
        <textarea
          autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={9}
          placeholder={"12.03.2026\tMIGROS ATASEHIR\t-450,25\n13.03.2026\tBENZIN\t-1.200,00"}
          style={{ ...css.input, resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Field label="Nereye" flex={2}>
            <select style={css.input} value={secim} onChange={(e) => setSecim(e.target.value)}>
              <option value="oto">Otomatik bul (belgeden)</option>
              {hedefSecenekleri}
            </select>
          </Field>
        </div>
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Sekmeli (Excel kopyası), noktalı virgüllü/virgüllü CSV ve boşlukla hizalanmış metin tanınır.
          Tarih <b>gg.aa.yyyy</b> veya <b>yyyy-aa-gg</b>, tutar <b>1.234,56</b> biçiminde olabilir.
          Eksi işareti olan satırlar gider, bakiye sütunu varsa yön bakiyeden çıkarılır. Belgede
          yalnız bazı satırlar eksi işaretliyse işaretsiz olanlar gelir sayılır; hiç işaret yoksa hepsi gider
          sayılır (ters çıkarsa önizlemede "işaretleri çevir"). Kart ekstresinde işaretsiz tutar harcamadır,
          işaretli olan ödeme.
        </div>
        {err && <div style={{ color: T.neg, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" style={{ ...css.btn, opacity: text.trim() ? 1 : 0.4 }} disabled={!text.trim()} onClick={() => analyze()}>Satırları çöz</button>
          <button type="button" style={css.ghost} onClick={onClose}>Vazgeç</button>
        </div>
      </div>
    );
  }

  /* ——— 2. adım: önizleme + düzeltme —————
     Yerleşim (yeniden tasarım, Ekim 2026): (1) belge kartı — ne okundu, nereye gidecek, belgeyle
     tutuyor mu; (2) süzgeç şeridi; (3) satır listesi; (4) altta yapışkan eylem çubuğu (seçili sayı +
     toplam + içe aktar). Eskiden üstte dört ayrı gri kutu, her satırda üç giriş kutusu ve satır
     başına tekrarlanan taksit açıklaması vardı; sayfanın kendisi de bir kartın içindeydi (kutu içinde
     kutu içinde kutu). */
  const satirMetni: React.CSSProperties = { fontSize: 12.5, color: T.mut, lineHeight: 1.45 };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...css.card, padding: "16px 18px", display: "grid", gap: 10 }}>
        {/* Hedef: otomatik bulunduysa nasıl bulunduğu yazılır; emin değilse göze batar. Değiştirmek
            belgeyi yeni hedefle yeniden çözer. */}
        <div style={{ display: "grid", gap: 2 }}>
          {/* Belge türü (otomatik bulunduysa) ya da hedefin türü; altında hedefin kendisi, değiştirilebilir */}
          <span style={{ fontSize: 12.5, color: T.mut }}>
            {oto ? TUR_ADI[oto.tur].replace(/^./, (c) => c.toLocaleUpperCase("tr"))
              : hedef.startsWith("c:") ? "Kart ekstresi" : hedef.startsWith("a:") ? "Hesap dökümü" : "Gelir/gider defteri"} · aktarılacak yer
          </span>
          <select className="inline-select" style={{ ...css.input, fontFamily: T.disp, fontSize: 16, fontWeight: 650, padding: "4px 6px", margin: "0 -6px", width: "auto", maxWidth: "calc(100% + 12px)", minWidth: 0, color: T.text,
            border: oto && !oto.emin ? `1px solid ${T.neg}` : undefined }}
            aria-label="Nereye aktarılsın" value={hedef} onChange={(e) => hedefDegistir(e.target.value)}>
            {hedefSecenekleri}
          </select>
        </div>
        {oto && (oto.hedef === "" || !oto.emin || oto.eslesen > 0) && (
          <div style={{ ...satirMetni, color: oto.hedef === "" || !oto.emin ? T.neg : T.mut, marginTop: -4 }}>
            {oto.hedef === ""
              ? (oto.tur === "kart" ? "Tanımlı kartın yok — Kartlar'da ekle, sonra buradan seç." : "Tanımlı hesabın yok.")
              : !oto.emin ? "Hangisine ait olduğundan emin değilim, kontrol et."
              : `${oto.eslesen} satırı defterindeki kayıtlarla eşleşti.`}
          </div>
        )}
        <DogrulamaSatiri d={dogrulama} />
        {(ocrSayfa > 0 || bozukHarf) && (
          <div style={satirMetni}>
            {ocrSayfa > 0 && <>Belgenin {ocrSayfa} sayfası görüntüden okundu (OCR); adlarda harf hatası olabilir. </>}
            {bozukHarf && <>Yazı tipi Türkçe harfleri bozuk veriyor ("%deme" gibi) — tutarlar etkilenmez, adları kontrol et.</>}
          </div>
        )}
        {/* Metin katmanı okundu ama belgeyle tutmuyor ya da harfler bozuk: katman güvenilmez olabilir.
            Karar belgenin kendi doğrulamasına bağlı; sonuç yine aynı doğrulamadan geçer. */}
        {sonBelge && ocrSayfa < sonBelge.sayfa && (bozukHarf || (dogrulama.tur !== "yok" && !dogrulama.tamam)) && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ ...satirMetni, flex: "1 1 220px" }}>
              {yenidenOkunuyor ? (ilerleme || "OCR hazırlanıyor…")
                : <>Metin katmanı {bozukHarf ? "bozuk görünüyor" : "belgeyle tutmuyor"}. Sayfaları görüntüden okumayı dene (sayfa başına birkaç saniye).</>}
            </span>
            <button type="button" style={{ ...css.ghost, fontSize: 13 }} disabled={yenidenOkunuyor}
              onClick={async () => { setYenidenOkunuyor(true); await pdfOku(sonBelge.dosya, sonBelge.parola, true); setYenidenOkunuyor(false); }}>
              {yenidenOkunuyor ? "Okunuyor…" : "OCR ile yeniden oku"}
            </button>
          </div>
        )}
        {kartIpucu != null && (
          <div style={{ fontSize: 13, lineHeight: 1.45, border: `1px solid ${T.neg}`, borderRadius: 10, padding: "10px 12px" }}>
            Bu bir <b>kredi kartı ekstresi</b> gibi görünüyor (dönem borcu <span style={css.mono}>{fmtMoney(kartIpucu, "TRY", true)}</span>).
            Hesap dökümü olarak aktarılırsa kart ödemesi hesaba giren para, harcamalar da
            {accountId ? <> <b>{data.accounts.find((a) => a.id === +accountId)?.name}</b> hesabından</> : " hesaptan"} çıkmış gibi yazılır.
            {data.cards.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {data.cards.map((c) => (
                  <button key={c.id} type="button" style={{ ...css.ghost, fontSize: 13 }} onClick={() => kartaGec(c.id)}>{c.name} kartının ekstresi olarak oku</button>
                ))}
              </div>
            ) : <div style={{ color: T.mut, marginTop: 4 }}>Önce Kartlar'da kartını tanımla, sonra buradan kart ekstresi olarak aktar.</div>}
          </div>
        )}
        <div style={{ ...satirMetni, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: T.text }}>{drafts.length}</b> satır · <b style={{ color: T.text }}>{sayac.get("eksik") ?? 0}</b> eksik · <b style={{ color: T.text }}>{sayac.get("eslesti") ?? 0}</b> zaten defterde
          </span>
          <button type="button" onClick={isaretCevir} title="Gider ↔ gelir: belgede harcama artı yazılıyorsa"
            style={{ background: "none", border: "none", padding: 0, color: T.acc, fontSize: 13, fontFamily: T.disp, cursor: "pointer", minHeight: 0 }}>
            işaretleri çevir
          </button>
        </div>
      </div>

      <FiltreSeridi kaydir>
        {(["eksik", "farkli", "eslesti", "acilis", "odeme", "hepsi"] as const).filter((f) => f === "hepsi" || sayac.get(f)).map((f) => (
          <button key={f} type="button" onClick={() => setFiltre(f)} style={{
            padding: "6px 11px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontFamily: T.disp, whiteSpace: "nowrap", flexShrink: 0,
            fontWeight: filtre === f ? 600 : 500, background: filtre === f ? T.panel : "transparent", color: filtre === f ? T.acc : T.mut,
            boxShadow: filtre === f ? "var(--shadow-sm)" : "none", minHeight: 0,
          }}>{FILTRE_ADI[f]} <span style={css.mono}>{sayac.get(f) ?? 0}</span></button>
        ))}
      </FiltreSeridi>
      {filtre === "acilis" && (
        acilisKaydi ? (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.45, color: T.mut, cursor: "pointer", padding: "0 4px" }}>
            <input type="checkbox" checked={acilisGeri} style={{ marginTop: 3, accentColor: "var(--brand)" }} onChange={(e) => {
              const acik = e.target.checked;
              setAcilisGeri(acik);
              setDrafts((ds) => ds!.map((r) => (r.durum === "acilis" ? { ...r, include: acik } : r)));
            }} />
            <span>
              Bu satırlar hesabın açılış gününde ya da öncesinde: açılış bakiyesinin içinde zaten sayıldılar.
              <b style={{ color: T.text }}> Geçmişi de ekle</b>: seçili satırlar eklenir ve açılış bakiyesi aynı toplam kadar geriye çekilir —
              bugünkü bakiye değişmez, geçmiş deftere ve raporlara girer.
              {yeniAcilis && <> Açılış: <span style={css.mono}>{kisaTarih(acilisKaydi.date)} {fmtMoney(acilisKaydi.amount, "TRY", true)}</span> → <span style={css.mono}>{kisaTarih(yeniAcilis.date)} {fmtMoney(yeniAcilis.amount, "TRY", true)}</span></>}
            </span>
          </label>
        ) : <div style={{ ...satirMetni, padding: "0 4px" }}>Bu satırlar hesabın açılış gününde ya da öncesinde: açılış bakiyesinin içinde zaten sayıldılar. Seçersen bakiye o kadar şişer.</div>
      )}
      {filtre === "acilis" && !acilisGeri && acilisSecilen.length > 0 && acilisKaydi && (
        <div style={{ ...satirMetni, color: T.neg, padding: "0 4px" }}>Açılıştan önceki {acilisSecilen.length} satır seçili ama açılış geri çekilmiyor — bakiye o kadar şişer.</div>
      )}
      {filtre === "farkli" && (
        <div style={{ ...satirMetni, padding: "0 4px" }}>Defterde adı ve günü tutan bir kayıt var ama tutarı farklı. Banka doğruysa "defterdekini düzelt" — kayıt yeni yazılmaz, tutarı düzeltilir. Satırı seçmek ikinci bir kayıt ekler.</div>
      )}
      {filtre === "odeme" && drafts.some(kartaGiren) && (
        <div style={{ ...satirMetni, padding: "0 4px" }}>Karta para giren satırlar (ekstre ödemesi ya da iade) aktarılmaz: ekstre ödemesi Kartlar'da "Ödedim" ile kaydedilir.</div>
      )}

      <div style={{ ...css.card, padding: 0, overflow: "hidden" }}>
        {sayfa.gorunen.map(({ d, i }, sira) => {
          const k = karsiKayit(d);
          const acik = duzenlenen === i;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px",
              borderTop: sira === 0 ? "none" : `1px solid ${T.line2}`, opacity: d.include ? 1 : 0.55,
              background: d.durum === "farkli" ? "color-mix(in srgb, var(--neg) 6%, transparent)" : "transparent",
            }}>
              <input type="checkbox" aria-label={`${d.name} aktarılsın`} checked={d.include} disabled={kartaGiren(d)}
                onChange={(e) => upd(i, { include: e.target.checked })}
                style={{ width: 18, height: 18, minHeight: 0, marginTop: 2, flexShrink: 0, accentColor: "var(--brand)" }} />
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
                {acik ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input aria-label="Ad" autoFocus style={{ ...css.input, fontFamily: T.disp, padding: "7px 10px", fontSize: 14, flex: "1 1 180px", minWidth: 0 }}
                      value={d.name} onChange={(e) => upd(i, { name: e.target.value })} />
                    <input aria-label="Tutar" inputMode="decimal" style={{ ...css.input, padding: "7px 10px", fontSize: 14, width: 120, flexShrink: 0, color: d.amount < 0 ? T.neg : T.pos }}
                      value={String(d.amount)} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(",", ".")) || 0 })} />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 1.35, overflowWrap: "anywhere" }}>{d.name}</span>
                    <span style={{ ...css.mono, fontSize: 14.5, fontWeight: 500, whiteSpace: "nowrap", color: d.amount < 0 ? T.neg : T.pos }}>{fmtMoney(d.amount, "TRY", true)}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", ...satirMetni }}>
                  <span style={css.mono}>{kisaTarih(d.date)}</span>
                  <span aria-hidden="true">·</span>
                  {/* Kategori ve virman TEK seçicide (Faz 45.8). "v:<hesap>" = kendi hesapların arası virman. */}
                  <select className="inline-select" aria-label="Kategori ya da virman"
                    style={{ ...css.input, fontFamily: T.disp, padding: "2px 4px", margin: "-2px 0", fontSize: 12.5, width: "auto", maxWidth: 200, minWidth: 0,
                      color: d.virman ? T.acc : d.category_id ? T.text : T.mut }}
                    value={d.virman ? `v:${d.virman}` : d.category_id}
                    onChange={(e) => { const v = e.target.value; upd(i, v.startsWith("v:") ? { virman: v.slice(2), category_id: "" } : { virman: "", category_id: v }); }}>
                    <option value="">Kategorisiz</option>
                    {data.categories.filter((c) => c.kind === (d.amount < 0 ? "expense" : "income")).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {digerHesaplar.length > 0 && (
                      <optgroup label="Kendi hesabıma virman">
                        {digerHesaplar.map((a) => <option key={a.id} value={`v:${a.id}`}>Virman {d.amount < 0 ? "→" : "←"} {a.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                {d.taksit && !d.kayit && (
                  <div style={satirMetni}>taksit {d.taksit.sira}/{d.taksit.sayi} · toplam <span style={css.mono}>{fmtMoney(d.taksit.toplam, "TRY", true)}</span> · alış <span style={css.mono}>{kisaTarih(d.taksit.alis)}</span></div>
                )}
                {k && (
                  <div style={{ ...satirMetni, color: T.neg }}>
                    {data.accounts.find((a) => a.id === +d.virman)?.name} hesabında bu paranın kaydı var gibi: {kisaTarih(k.date)} · {k.name} · <span style={css.mono}>{fmtMoney(k.amount, "TRY", true)}</span> — virman yazarsan orada ikinci kez sayılır.
                  </div>
                )}
                {d.kayit && (
                  <div style={{ ...satirMetni, color: d.durum === "farkli" ? T.neg : T.mut }}>
                    defterde: {kisaTarih(d.kayit.date)} · {d.kayit.name} · <span style={css.mono}>{fmtMoney(d.kayit.amount, "TRY", true)}</span>
                    {d.kayit.taksit && d.kayit.taksit > 1 ? ` (${d.kayit.taksit} taksit)` : ""}
                    {duzeltilebilir(d) && (
                      <button type="button" disabled={duzeltilen != null} onClick={() => duzelt(i)} style={{
                        marginLeft: 8, background: "none", border: "none", padding: 0, color: T.acc, fontSize: 12.5, fontFamily: T.disp, cursor: "pointer", minHeight: 0,
                      }}>{duzeltilen === i ? "düzeltiliyor…" : `defterdekini düzelt → ${fmtMoney(d.amount, "TRY", true)}`}</button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" aria-label={acik ? "Düzenlemeyi kapat" : "Adı ya da tutarı düzelt"} title={acik ? "Tamam" : "Adı ya da tutarı düzelt"}
                onClick={() => setDuzenlenen(acik ? null : i)}
                style={{ background: acik ? T.accSoft : "none", border: "none", borderRadius: 8, color: acik ? T.acc : T.mut, cursor: "pointer",
                  width: 32, height: 32, minHeight: 0, display: "grid", placeItems: "center", flexShrink: 0, marginTop: -5, marginRight: -6 }}>
                {acik
                  ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2.5 7.2l3 3L11.5 4" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M9.5 2.5l2 2L5 11H3v-2z" /></svg>}
              </button>
            </div>
          );
        })}
        {drafts.length === 0 && <div style={{ padding: 16, textAlign: "center", color: T.mut, fontSize: 13 }}>Hiçbir satır çözülemedi</div>}
        {drafts.length > 0 && gorunen.length === 0 && <div style={{ padding: 16, textAlign: "center", color: T.mut, fontSize: 13 }}>Bu grupta satır yok</div>}
      </div>
      <DahaFazla s={sayfa} ad="satır" yon="fazla" />

      {mutabakat && (
        <div style={{ ...satirMetni, fontSize: 13, padding: "0 4px", color: Math.abs(mutabakat.banka - mutabakat.defter) < 0.005 ? T.pos : T.text }}>
          {Math.abs(mutabakat.banka - mutabakat.defter) < 0.005
            ? <>✓ Aktarımdan sonra {kisaTarih(mutabakat.tarih)} itibarıyla defter bankayla aynı: <span style={css.mono}>{fmtMoney(mutabakat.banka, "TRY", true)}</span>.</>
            : <>Aktarımdan sonra {kisaTarih(mutabakat.tarih)} itibarıyla defter <span style={css.mono}>{fmtMoney(mutabakat.defter, "TRY", true)}</span>,
              banka <span style={css.mono}>{fmtMoney(mutabakat.banka, "TRY", true)}</span> diyor — fark <span style={css.mono}>{fmtMoney(mutabakat.banka - mutabakat.defter, "TRY", true)}</span>.
              Seçimi gözden geçir; kalan farkı Hesaplar'dan mutabakatla sabitleyebilirsin.</>}
        </div>
      )}
      {fazla.length > 0 && (
        <details style={{ fontSize: 13, padding: "0 4px" }}>
          <summary style={{ cursor: "pointer", color: T.mut }}>
            Defterde olup dökümde olmayan {fazla.length} kayıt — yanlış ya da çift giriş olabilir (silinmez)
          </summary>
          <div style={{ ...css.card, padding: 0, marginTop: 8, maxHeight: "30vh", overflowY: "auto" }}>
            {fazla.slice(0, 100).map((k, i) => (
              <div key={k.kimlik} style={{ display: "flex", gap: 10, padding: "8px 14px", borderTop: i === 0 ? "none" : `1px solid ${T.line2}` }}>
                <span style={{ ...css.mono, fontSize: 12, color: T.mut, flexShrink: 0 }}>{kisaTarih(k.date)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}</span>
                <span style={{ ...css.mono, color: k.amount < 0 ? T.neg : T.pos }}>{fmtMoney(k.amount, "TRY", true)}</span>
              </div>
            ))}
            {fazla.length > 100 && <div style={{ padding: "8px 14px", color: T.mut }}>… ve {fazla.length - 100} kayıt daha</div>}
          </div>
        </details>
      )}
      {skipped.length > 0 && (
        <div style={{ ...satirMetni, padding: "0 4px" }}>{skipped.length} satır atlandı (tarih veya tutar bulunamadı): <span style={css.mono}>{skipped.slice(0, 2).join(" / ").slice(0, 90)}…</span></div>
      )}
      {/* Ne yazılacağı BİR KEZ, listenin dibinde (taksit açıklaması eskiden her taksitli satırda tekrarlanıyordu) */}
      <div style={{ ...satirMetni, padding: "0 4px" }}>
        {kart
          ? <>Seçili satırlar <b style={{ color: T.text }}>{kart.name}</b> kartına harcama olarak yazılır ve tarihlerine göre ilgili ekstreye düşer. Taksitli satırlar alışverişin kendisi olarak (toplam tutar, taksit sayısı, alış günü) yazılır; kalan taksitler sonraki ekstrelere düşer. Defterde karşılığı olan satırlar seçili gelmez.</>
          : accountId
          ? <>Seçili satırlar gerçekleşen kayıt olarak yazılır ve <b style={{ color: T.text }}>{data.accounts.find((a) => a.id === +accountId)?.name}</b> bakiyesine toplam <span style={{ ...css.mono, color: sum < 0 ? T.neg : T.pos }}>{fmtMoney(sum, "TRY", true)}</span> işler.
            {chosen.some((d) => d.virman) && <> Bunlardan {chosen.filter((d) => d.virman).length} tanesi virman: gelir/gider sayılmaz, karşı hesaba da yazılır.</>}</>
          : "Hesap seçilmedi — kayıtlar yalnız gelir/gider defterine girer, bakiyeye dokunmaz."}
      </div>

      {/* Yapışkan eylem çubuğu: seçimi değiştirirken toplam ve "içe aktar" hep görünür (eskiden
          listenin en dibindeydi — 60 satırlık dökümde seçili toplamı görmek için başa dönülüyordu). */}
      <div className="ice-eylem" style={{
        ...css.card, padding: "10px 12px", display: "grid", gap: 8, zIndex: 5,
        boxShadow: "var(--shadow)",
      }}>
        {err && <div style={{ color: T.neg, fontSize: 13 }}>{err}</div>}
        {cikisSor && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ flex: "1 1 200px" }}>Seçtiğin {chosen.length} satır henüz aktarılmadı. Çıkarsan okunan belge ve seçimlerin silinir.</span>
            <button type="button" style={{ ...css.ghost, fontSize: 13, color: T.neg }} onClick={onClose}>Çık, sil</button>
            <button type="button" style={{ ...css.ghost, fontSize: 13 }} onClick={() => setCikisSor(false)}>Devam et</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" style={{ ...css.btn, flex: 1, maxWidth: 420, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", opacity: chosen.length && !busy ? 1 : 0.4 }}
            disabled={!chosen.length || busy} onClick={save}>
            <span>{busy ? "Kaydediliyor…" : `${chosen.length} kaydı içe aktar`}</span>
            {chosen.length > 0 && !busy && <span style={{ ...css.mono, fontWeight: 500, opacity: 0.85 }}>{fmtMoney(sum, "TRY", true)}</span>}
          </button>
          <button type="button" style={css.ghost} onClick={() => setDrafts(null)}>Geri</button>
          <button type="button" style={css.ghost} onClick={() => (chosen.length ? setCikisSor(true) : onClose())}>Vazgeç</button>
        </div>
      </div>
    </div>
  );
}

/** Okunan satırlar belgenin kendi rakamlarını açıklıyor mu (engine `Dogrulama`). Sessiz kayıp
    olmasın diye önizlemenin en üstünde durur; katlanmaz (rakamın güvenilirliğini söyler). */
function DogrulamaSatiri({ d }: { d: Dogrulama }) {
  const kutu = (renk: string, metin: React.ReactNode) => (
    <div style={{ fontSize: 13, lineHeight: 1.45, color: renk }}>{metin}</div>
  );
  if (d.tur === "yok") return kutu(T.mut, "Bu belgede kendi toplamıyla karşılaştırılacak bir dayanak bulunamadı — satırları gözden geçir.");
  if (d.tamam) return kutu(T.pos, d.tur === "bakiye"
    ? "✓ Belgeyle tutuyor: okunan satırlar bakiye sütununu baştan sona açıklıyor."
    : <>✓ Belgeyle tutuyor: önceki dönem + okunan harcamalar − ödemeler = dönem borcu (<span style={css.mono}>{fmtMoney(d.belge, "TRY", true)}</span>).</>);
  if (d.tur === "donem") return kutu(T.neg, <>⚠ Belgeyle tutmuyor: okunan satırlara göre dönem borcu <span style={css.mono}>{fmtMoney(d.okunan, "TRY", true)}</span>, belgede <span style={css.mono}>{fmtMoney(d.belge, "TRY", true)}</span>. Eksik ya da fazla satır olabilir.</>);
  return kutu(T.neg, <>
    ⚠ Bakiye sütunu {d.kopukluklar.length} yerde tutmuyor — o aralıkta okunamamış satır var:
    {d.kopukluklar.slice(0, 3).map((k, i) => (
      <div key={i} style={css.mono}>{k.sonra.slice(5)} – {k.once.slice(5)} arası: {fmtMoney(k.eksik, "TRY", true)}</div>
    ))}
    {d.kopukluklar.length > 3 && <div>… ve {d.kopukluklar.length - 3} yer daha</div>}
  </>);
}
