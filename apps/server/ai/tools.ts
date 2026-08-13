/* ============================================================================
   Asistanın araç kaydı (Faz 22) — TEK GERÇEK KAYNAK
   ----------------------------------------------------------------------------
   Buradaki her kayıt bir API ucunun tarifidir; asistan bu tarifleri model'e
   "araç" olarak verir ve seçilen aracı **aynı Hono uygulamasına iç istek**
   olarak çalıştırır (bkz. agent.ts). Yani iş mantığı burada TEKRARLANMAZ:
   doğrulama, tenant-scope, bakiye/defter yan etkileri hep gerçek ucun kendi
   kodundan gelir. Asistanın yetkisi = giriş yapmış kullanıcının yetkisi
   (istek kullanıcının kendi oturum çerezi ile gider, guard yeniden doğrular).

   **Senkron kalma garantisi**: `scripts/check-ai-routes.mjs` index.ts'teki tüm
   `/api` yazma rotalarını tarar ve her birinin ya burada bir aracı ya da
   `SKIPPED` içinde gerekçesi olmasını şart koşar — script `pnpm build`e
   bağlıdır, yani yeni/değişen bir uç asistana tanıtılmadan CI'dan geçemez.
   Prompt'a elle yazılmış bir API dokümanı güncel kalmazdı; bu kalır. */

import type { JsonSchema } from "./provider.js";

export type ArgVals = Record<string, unknown>;
/** Onay kartında gösterilecek insan-okur özet için ad çözücüler (id → ad) */
export type NameLookup = {
  account: (id: unknown) => string;
  card: (id: unknown) => string;
  category: (id: unknown) => string;
  portfolio: (id: unknown) => string;
  recurring: (id: unknown) => string;
};

export type RouteTool = {
  name: string;
  method: "POST" | "PUT" | "DELETE";
  /** Hono yolu (`/api` öneki olmadan), yol parametreleri `:ad` biçiminde */
  path: string;
  description: string;
  parameters: JsonSchema;
  /** `path`'teki `:ad` parametrelerinin argüman adları — gövdeye DEĞİL yola yazılır */
  pathParams?: string[];
  /** Kullanıcının onay ekranında göreceği tek satır */
  summary: (a: ArgVals, n: NameLookup) => string;
  /** "Geri al" tarifi: uygulandıktan sonra bu isteği göndermek işlemi geri alır.
      `created` = ucun döndürdüğü gövde (yeni kaydın id'si oradadır). null/tanımsız =
      geri alınamaz (düzenleme ve silme araçlarında eski hâl saklanmıyor; mutabakat ise
      zaten defterde izli bir düzeltme hareketidir, sessizce silinmemeli).
      NOT: bu yollar `SKIPPED` listesindedir — yani MODEL onları çağıramaz. Geri alma
      modelin seçtiği bir eylem değil, sistemin uyguladığı deterministik tersidir. */
  undo?: (a: ArgVals, created: { id?: number }) => { method: "DELETE"; path: string } | null;
};

/** id ile silinen kayıtların ortak geri-alma tarifi */
const undoById = (route: string) => (_a: ArgVals, created: { id?: number }) =>
  created.id != null ? ({ method: "DELETE" as const, path: `/${route}/${created.id}` }) : null;

/* ---- şema kısayolları (Gemini + OpenAI ortak alt kümesi: type/description/enum) ---- */
const S = {
  str: (description: string) => ({ type: "string", description }),
  num: (description: string) => ({ type: "number", description }),
  int: (description: string) => ({ type: "integer", description }),
  bool: (description: string) => ({ type: "boolean", description }),
  enum: (description: string, values: string[]) => ({ type: "string", description, enum: values }),
};
const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({ type: "object", properties, required });

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺" : String(v);
};
const at = (a: ArgVals, n: NameLookup) => (a.account_id != null && a.account_id !== "" ? ` · ${n.account(a.account_id)}` : " · hesapsız");

const DATE = "Tarih 'YYYY-MM-DD' biçiminde";

export const ROUTE_TOOLS: RouteTool[] = [
  /* ---------------- gerçekleşen gelir/gider defteri ---------------- */
  {
    name: "islem_ekle", method: "POST", path: "/transactions",
    description:
      "Gerçekleşen (olmuş bitmiş) bir gelir veya gideri deftere yazar. Tutar İŞARETLİDİR: gider NEGATİF, gelir POZİTİF. " +
      "account_id verilirse o hesabın bakiyesi bu kadar oynar; verilmezse kayıt yalnız Rapor'a girer. " +
      "İleri tarihli (henüz olmamış) bir kalem için bunu DEĞİL plan_kalemi_ekle'yi kullan. Kendi hesapların arası para hareketi için virman_ekle kullan.",
    parameters: obj({
      date: S.str(DATE), name: S.str("Kısa açıklama, örn. 'Market'"),
      amount: S.num("İşaretli tutar (TRY): gider negatif, gelir pozitif"),
      category_id: S.int("Kategori id (opsiyonel)"), account_id: S.int("Hesap id (opsiyonel)"),
    }, ["date", "name", "amount"]),
    summary: (a, n) => `${Number(a.amount) < 0 ? "Gider" : "Gelir"}: ${a.name} · ${money(a.amount)} · ${a.date}${at(a, n)}${a.category_id ? ` · ${n.category(a.category_id)}` : ""}`,
    undo: undoById("transactions"),
  },
  {
    name: "islem_duzenle", method: "PUT", path: "/transactions/:id", pathParams: ["id"],
    description: "Mevcut bir gerçekleşen işlemi günceller (tüm alanlar yeniden verilir). Bakiye etkisi eskisi geri alınıp yenisi uygulanarak düzeltilir.",
    parameters: obj({
      id: S.int("Düzenlenecek işlemin id'si"), date: S.str(DATE), name: S.str("Açıklama"),
      amount: S.num("İşaretli tutar (gider negatif)"), category_id: S.int("Kategori id (opsiyonel)"), account_id: S.int("Hesap id (opsiyonel)"),
    }, ["id", "date", "name", "amount"]),
    summary: (a, n) => `İşlem #${a.id} düzenle → ${a.name} · ${money(a.amount)} · ${a.date}${at(a, n)}`,
  },
  {
    name: "islem_sil", method: "DELETE", path: "/transactions/:id", pathParams: ["id"],
    description: "Gerçekleşen bir işlemi siler; hesaba işlemişse bakiye etkisi geri alınır.",
    parameters: obj({ id: S.int("Silinecek işlemin id'si") }, ["id"]),
    summary: (a) => `İşlem #${a.id} silinecek`,
  },

  /* ---------------- portföy (pozisyon olayları defteri) ---------------- */
  {
    name: "portfoy_islemi_ekle", method: "POST", path: "/trades",
    description:
      "Portföy işlemi (pozisyon olayı) ekler. side: ALIŞ | SATIŞ | TEMETTÜ | BEDELSİZ. " +
      "TEMETTÜ'de qty = temettü ödenen hisse adedi, price = hisse başına net tutar (adet değişmez). " +
      "BEDELSİZ'de price 0 olmalıdır (adet artar, maliyet artmaz). " +
      "account_id verilirse ve currency TRY ise para o hesaptan çıkar (ALIŞ) / o hesaba girer (SATIŞ, TEMETTÜ). " +
      "Kullanıcı adet yerine TUTAR söylediyse (örn. '20.000 TL'lik aldım') adedi tutardan hesapla: ALIŞ için (tutar-fee)/price, SATIŞ için (tutar+fee)/price.",
    parameters: obj({
      date: S.str(DATE),
      asset_type: S.enum("Varlık türü", ["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"]),
      symbol: S.str("Sembol, büyük harf (ASELS, TP2, XAUUSD, BTC, VOO)"),
      side: S.enum("İşlem türü", ["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"]),
      qty: S.num("Adet (BEDELSİZ'de artan adet, TEMETTÜ'de temettü alan adet)"),
      price: S.num("Birim fiyat (BEDELSİZ'de 0)"),
      fee: S.num("Komisyon (opsiyonel, varsayılan 0)"),
      currency: S.enum("İşlem para birimi (varsayılan TRY)", ["TRY", "USD"]),
      account_id: S.int("Paranın gireceği/çıkacağı hesap id (opsiyonel)"),
      portfolio_id: S.int("Portföy grubu id (opsiyonel)"),
    }, ["date", "asset_type", "symbol", "side", "qty", "price"]),
    summary: (a, n) =>
      `${a.symbol} ${a.side} · ${a.qty} adet × ${a.price} ${a.currency ?? "TRY"}${Number(a.fee) ? ` (+${a.fee} komisyon)` : ""} · ${a.date}${at(a, n)}` +
      `${a.portfolio_id ? ` · ${n.portfolio(a.portfolio_id)}` : ""}`,
    undo: undoById("trades"),
  },
  {
    name: "portfoy_islemi_duzenle", method: "PUT", path: "/trades/:id", pathParams: ["id"],
    description: "Mevcut portföy işlemini günceller (tüm alanlar yeniden verilir); bakiye etkisi eskisi geri alınıp yenisi uygulanarak düzeltilir.",
    parameters: obj({
      id: S.int("Düzenlenecek işlemin id'si"), date: S.str(DATE),
      asset_type: S.enum("Varlık türü", ["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"]),
      symbol: S.str("Sembol"), side: S.enum("İşlem türü", ["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"]),
      qty: S.num("Adet"), price: S.num("Birim fiyat"), fee: S.num("Komisyon"),
      currency: S.enum("Para birimi", ["TRY", "USD"]), account_id: S.int("Hesap id"), portfolio_id: S.int("Portföy grubu id"),
    }, ["id", "date", "asset_type", "symbol", "side", "qty", "price"]),
    summary: (a, n) => `Portföy işlemi #${a.id} düzenle → ${a.symbol} ${a.side} · ${a.qty} × ${a.price} · ${a.date}${at(a, n)}`,
  },
  {
    name: "portfoy_islemi_sil", method: "DELETE", path: "/trades/:id", pathParams: ["id"],
    description: "Portföy işlemini siler; hesaba işlemişse bakiye etkisi geri alınır.",
    parameters: obj({ id: S.int("Silinecek portföy işleminin id'si") }, ["id"]),
    summary: (a) => `Portföy işlemi #${a.id} silinecek`,
  },

  /* ---------------- virman ---------------- */
  {
    name: "virman_ekle", method: "POST", path: "/transfers",
    description:
      "KENDİ hesapların arasında para hareketi (ATM'den nakit çekme, aracı kuruma para atma, hesaplar arası aktarım). " +
      "Net varlığı değiştirmez, Rapor'a girmez. BAŞKASINA gönderilen para virman DEĞİL giderdir → islem_ekle kullan.",
    parameters: obj({
      date: S.str(DATE), from_account_id: S.int("Paranın çıktığı hesap id"), to_account_id: S.int("Paranın girdiği hesap id"),
      amount: S.num("Tutar (pozitif, TRY)"), note: S.str("Not (opsiyonel)"),
    }, ["date", "from_account_id", "to_account_id", "amount"]),
    summary: (a, n) => `Virman: ${n.account(a.from_account_id)} → ${n.account(a.to_account_id)} · ${money(a.amount)} · ${a.date}`,
    undo: undoById("transfers"),
  },

  /* ---------------- kredi kartı ---------------- */
  {
    name: "kart_harcamasi_ekle", method: "POST", path: "/cardtxs",
    description:
      "Kredi kartı harcaması ekler. Tutar POZİTİF girilir. installments > 1 ise taksitler ardışık ekstrelere bölünür. " +
      "Harcama bakiyeyi anında değil, ekstresi ödendiğinde etkiler.",
    parameters: obj({
      card_id: S.int("Kart id"), date: S.str(DATE), name: S.str("Açıklama"),
      amount: S.num("Toplam tutar (pozitif, TRY)"), installments: S.int("Taksit sayısı (varsayılan 1)"),
    }, ["card_id", "date", "name", "amount"]),
    summary: (a, n) => `Kart harcaması: ${n.card(a.card_id)} · ${a.name} · ${money(a.amount)}${Number(a.installments) > 1 ? ` · ${a.installments} taksit` : ""} · ${a.date}`,
    undo: undoById("cardtxs"),
  },
  {
    name: "ekstre_ode", method: "POST", path: "/cards/:id/pay-statement", pathParams: ["id"],
    description:
      "Bir kredi kartı ekstresini ödendi olarak işaretler ve deftere gider kaydı yazar. " +
      "TUTAR SUNUCUDA HESAPLANIR, sen tutar veremezsin. 'due' o ekstrenin son ödeme tarihidir — " +
      "hangi tarih olduğunu bilmiyorsan önce kart_ekstreleri aracıyla öğren.",
    parameters: obj({
      id: S.int("Kart id"), due: S.str("Ekstrenin son ödeme tarihi 'YYYY-MM-DD'"),
      account_id: S.int("Ödemenin yapıldığı hesap id (opsiyonel ama önerilir)"), category_id: S.int("Kategori id (opsiyonel)"),
    }, ["id", "due"]),
    /* Tutar burada yok çünkü modelden gelmiyor; onay kartına ekstre matematiğinden
       hesaplanıp eklenir (enrich.ts) — kullanıcı ne ödediğini görmeden onaylamamalı. */
    summary: (a, n) => `Ekstre ödemesi: ${n.card(a.id)} · vade ${a.due}${at(a, n)}`,
    undo: (a) => ({ method: "DELETE", path: `/cards/${a.id}/pay-statement/${a.due}` }),
  },

  /* ---------------- plan (projeksiyon) ---------------- */
  {
    name: "plan_kalemi_ekle", method: "POST", path: "/oneoffs",
    description:
      "İLERİ TARİHLİ tek seferlik gelir/gider planı (henüz gerçekleşmedi; yalnız nakit projeksiyonuna girer, bakiyeye dokunmaz). " +
      "Tutar işaretlidir: gider negatif, gelir pozitif.",
    parameters: obj({ date: S.str(DATE), name: S.str("Açıklama"), amount: S.num("İşaretli tutar (gider negatif)") }, ["date", "name", "amount"]),
    summary: (a) => `Plan kalemi: ${a.name} · ${money(a.amount)} · ${a.date}`,
    undo: undoById("oneoffs"),
  },
  {
    name: "plan_kalemi_sil", method: "DELETE", path: "/oneoffs/:id", pathParams: ["id"],
    description: "Tek seferlik plan kalemini siler.",
    parameters: obj({ id: S.int("Plan kalemi id") }, ["id"]),
    summary: (a) => `Plan kalemi #${a.id} silinecek`,
  },
  {
    name: "duzenli_kalem_ekle", method: "POST", path: "/recurring",
    description:
      "Her ay tekrar eden gelir/gider tanımlar (maaş, kira, abonelik). day = ayın kaçında. " +
      "Hedef olarak account_id VEYA card_id verilebilir (en fazla biri). auto=true ise günü gelince otomatik gerçekleşir.",
    parameters: obj({
      kind: S.enum("Tür", ["income", "expense"]), name: S.str("Ad"), day: S.int("Ayın günü (1-31)"),
      amount: S.num("Aylık tutar (pozitif)"), from_month: S.str("Başlangıç ayı 'YYYY-MM' (opsiyonel)"),
      to_month: S.str("Bitiş ayı 'YYYY-MM' (opsiyonel)"), account_id: S.int("Hesap id (opsiyonel)"),
      card_id: S.int("Kart id (opsiyonel)"), category_id: S.int("Kategori id (opsiyonel)"), auto: S.bool("Otomatik gerçekleşsin mi"),
    }, ["kind", "name", "day", "amount"]),
    summary: (a) => `Düzenli ${a.kind === "income" ? "gelir" : "gider"}: ${a.name} · ${money(a.amount)} · her ayın ${a.day}. günü`,
    undo: undoById("recurring"),
  },
  {
    name: "duzenli_kalem_tutar_degistir", method: "POST", path: "/recurring/:id/amount", pathParams: ["id"],
    description:
      "Düzenli kalemin tutarını BELİRLİ BİR AYDAN İTİBAREN değiştirir (zam/indirim). Geçmiş aylar eski tutarla kalır — " +
      "bu yüzden tutar değişikliği kalemi silip yeniden eklemekle YAPILMAZ.",
    parameters: obj({
      id: S.int("Düzenli kalem id"), amount: S.num("Yeni tutar (pozitif)"),
      from_month: S.str("Bu aydan itibaren geçerli 'YYYY-MM' (opsiyonel; yoksa baştan)"),
    }, ["id", "amount"]),
    summary: (a, n) => `${n.recurring(a.id)} tutarı → ${money(a.amount)}${a.from_month ? ` (${a.from_month} ayından itibaren)` : ""}`,
  },
  {
    name: "duzenli_kalem_gerceklestir", method: "POST", path: "/recurring/:id/realize", pathParams: ["id"],
    description:
      "Düzenli kalemin belirli bir ayını gerçekleşmiş sayar: hedefine göre gerçek kayda dönüşür (hesap → işlem, kart → kart harcaması). " +
      "Tutar kalemin o aydaki tutarından çözülür. Aynı ay iki kez gerçekleşmez.",
    parameters: obj({
      id: S.int("Düzenli kalem id"), ym: S.str("Ay 'YYYY-MM'"),
      account_id: S.int("Hesap id (opsiyonel, kalemin hedefini geçersiz kılar)"), category_id: S.int("Kategori id (opsiyonel)"),
    }, ["id", "ym"]),
    summary: (a, n) => `${n.recurring(a.id)} → ${a.ym} ayı gerçekleşti olarak işaretlenecek`,
    undo: (a) => ({ method: "DELETE", path: `/recurring/${a.id}/realize/${a.ym}` }),
  },

  /* ---------------- borç & birikim ---------------- */
  {
    name: "kredi_ekle", method: "POST", path: "/loans",
    description: "Kredi tanımlar: aylık taksit tutarı, ilk taksit tarihi ve toplam taksit sayısı. Kalan taksit tarihten hesaplanır.",
    parameters: obj({
      name: S.str("Kredi adı"), amount: S.num("Aylık taksit tutarı (pozitif, TRY)"),
      first_date: S.str("İlk taksit tarihi 'YYYY-MM-DD'"), total: S.int("Toplam taksit sayısı"),
    }, ["name", "amount", "first_date", "total"]),
    summary: (a) => `Kredi: ${a.name} · ${money(a.amount)} × ${a.total} taksit · ilk ${a.first_date}`,
    undo: undoById("loans"),
  },
  {
    name: "mevduat_ekle", method: "POST", path: "/deposits",
    description: "Vadeli mevduat açar. account_id verilirse anapara o hesaptan düşer. Faiz basit, yıllık %; withholding = stopaj %.",
    parameters: obj({
      name: S.str("Ad"), principal: S.num("Anapara (TRY)"), rate: S.num("Yıllık faiz %"),
      open_date: S.str("Açılış tarihi 'YYYY-MM-DD'"), term_days: S.int("Vade (gün)"),
      withholding: S.num("Stopaj % (opsiyonel)"), account_id: S.int("Anaparanın çıktığı hesap id (opsiyonel)"),
    }, ["name", "principal", "rate", "open_date", "term_days"]),
    summary: (a, n) => `Vadeli mevduat: ${a.name} · ${money(a.principal)} · %${a.rate} · ${a.term_days} gün${at(a, n)}`,
    undo: undoById("deposits"),
  },

  /* ---------------- tanımlar ---------------- */
  {
    name: "hesap_ekle", method: "POST", path: "/accounts",
    description: "Yeni hesap açar (banka, nakit cüzdan, aracı kurum, fon hesabı). balance = açılış bakiyesi.",
    parameters: obj({
      name: S.str("Hesap adı"), balance: S.num("Açılış bakiyesi (varsayılan 0)"),
      kind: S.enum("Hesap türü", ["banka", "nakit", "araci", "fon"]),
    }, ["name"]),
    summary: (a) => `Yeni hesap: ${a.name} (${a.kind ?? "banka"}) · açılış ${money(a.balance ?? 0)}`,
    undo: undoById("accounts"),
  },
  {
    name: "hesap_mutabakat", method: "POST", path: "/accounts/:id/reconcile", pathParams: ["id"],
    description:
      "Hesabın GERÇEK bakiyesini bildirir; sistemdeki bakiye ile farkı 'düzeltme' hareketi olarak deftere yazılır. " +
      "Kullanıcı 'hesabımda şu kadar var / bakiyem şu' dediğinde bunu kullan.",
    parameters: obj({
      id: S.int("Hesap id"), balance: S.num("Gerçek bakiye (TRY)"),
      date: S.str("Mutabakat tarihi 'YYYY-MM-DD' (opsiyonel, varsayılan bugün)"), note: S.str("Not (opsiyonel)"),
    }, ["id", "balance"]),
    summary: (a, n) => `Mutabakat: ${n.account(a.id)} gerçek bakiye ${money(a.balance)} olarak işaretlenecek (fark düzeltme hareketi yazılır)`,
  },
  {
    name: "kategori_ekle", method: "POST", path: "/categories",
    description: "Rapor için gelir/gider kategorisi tanımlar. Var olan bir kategoriyi yeniden oluşturma — önce bağlamdaki listeye bak.",
    parameters: obj({ name: S.str("Kategori adı"), kind: S.enum("Tür", ["income", "expense"]), color: S.str("Renk (opsiyonel, #rrggbb)") }, ["name", "kind"]),
    summary: (a) => `Yeni kategori: ${a.name} (${a.kind === "income" ? "gelir" : "gider"})`,
    undo: undoById("categories"),
  },
  {
    name: "portfoy_grubu_ekle", method: "POST", path: "/portfolios",
    description: "Portföy grubu (kurum/strateji kabı) tanımlar.",
    parameters: obj({ name: S.str("Grup adı"), note: S.str("Not (opsiyonel)") }, ["name"]),
    summary: (a) => `Yeni portföy grubu: ${a.name}`,
    undo: undoById("portfolios"),
  },
  {
    name: "fiyat_belirle", method: "PUT", path: "/prices",
    description:
      "Bir sembolün fiyatını ELLE belirler (yalnız bu kullanıcı için geçerli; otomatik piyasa fiyatını ezer). " +
      "Otomatik çekilemeyen semboller (bazı fonlar) için kullanılır.",
    parameters: obj({
      symbol: S.str("Sembol"), asset_type: S.enum("Varlık türü", ["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"]),
      price: S.num("Birim fiyat"), currency: S.enum("Fiyatın para birimi (varsayılan TRY)", ["TRY", "USD"]),
    }, ["symbol", "asset_type", "price"]),
    summary: (a) => `Elle fiyat: ${a.symbol} = ${a.price} ${a.currency ?? "TRY"}`,
    undo: (a) => ({ method: "DELETE", path: `/prices/${a.asset_type}/${encodeURIComponent(String(a.symbol))}` }),
  },
];

/* ============================================================================
   Asistana BİLİNÇLİ olarak açılmayan yazma uçları.
   check-ai-routes.mjs bu listeyi de okur: her uç ya araç ya da burada gerekçeli
   olmalı. Yeni bir uç eklendiğinde build "karar ver" diye durur. */
export const SKIPPED: { route: string; reason: string }[] = [
  { route: "POST /auth/register", reason: "kimlik: oturum akışı asistanın işi değil" },
  { route: "POST /auth/login", reason: "kimlik" },
  { route: "POST /auth/logout", reason: "kimlik" },
  { route: "POST /auth/forgot", reason: "kimlik" },
  { route: "POST /auth/reset", reason: "kimlik" },
  { route: "POST /auth/verify", reason: "kimlik" },
  { route: "POST /auth/resend-verify", reason: "kimlik" },
  { route: "POST /account/delete", reason: "yıkıcı ve geri alınamaz: hesabın tamamını siler — yalnız kullanıcı elle yapar" },
  { route: "PUT /settings", reason: "uygulama ayarı; sohbetten değiştirilmesi beklenmiyor" },
  { route: "POST /prices/refresh", reason: "arayüzdeki 'Fiyatları yenile' düğmesi; kota tüketir" },
  { route: "POST /transactions/bulk", reason: "toplu ekstre içe aktarma arayüzden yapılır (önizleme + düzeltme akışı gerekir)" },
  { route: "PUT /accounts/:id", reason: "bakiye düzeltmesi için hesap_mutabakat aracı var (izli); ad/tür değişikliği arayüzden" },
  { route: "DELETE /accounts/:id", reason: "yıkıcı: hesabın tüm hareket geçmişi cascade siler" },
  { route: "PUT /transfers/:id", reason: "düzenleme arayüzden; asistan yeni virman ekler" },
  { route: "DELETE /transfers/:id", reason: "silme arayüzden (iki bacaklı geri alma kullanıcı onayıyla görünür olmalı)" },
  { route: "PUT /recurring/:id", reason: "düzenli kalemin kimlik alanları arayüzden düzenlenir" },
  { route: "DELETE /recurring/:id", reason: "yıkıcı: tutar çizelgesi ve gerçekleşme geçmişi cascade siler" },
  { route: "DELETE /recurring/:id/amount/:from_month", reason: "tutar çizelgesi düzeltmesi arayüzden" },
  { route: "DELETE /recurring/:id/realize/:ym", reason: "gerçekleşmeyi geri alma arayüzden (ürettiği kaydı da siler)" },
  { route: "PUT /trades/:id/portfolio", reason: "portfoy_islemi_duzenle aynı işi yapıyor (dar uç listede hızlı taşıma için)" },
  { route: "PUT /deposits/:id", reason: "mevduat düzenleme arayüzden" },
  { route: "DELETE /deposits/:id", reason: "silme arayüzden" },
  { route: "POST /cards", reason: "kart tanımı (kesim/vade günü, limit) arayüzden yapılır — sohbette yanlış kesim günü tüm ekstre matematiğini bozar" },
  { route: "PUT /cards/:id", reason: "kart tanımı (kesim/vade günü) arayüzden düzenlenir" },
  { route: "DELETE /cards/:id", reason: "yıkıcı: kartın harcamaları da gider" },
  { route: "PUT /cardtxs/:id", reason: "kart harcaması düzenleme arayüzden" },
  { route: "DELETE /cardtxs/:id", reason: "silme arayüzden" },
  { route: "DELETE /cards/:id/pay-statement/:due", reason: "ödeme geri alma arayüzden (ürettiği işlemi de siler)" },
  { route: "PUT /loans/:id", reason: "kredi düzenleme arayüzden" },
  { route: "DELETE /loans/:id", reason: "silme arayüzden" },
  { route: "PUT /oneoffs/:id", reason: "plan kalemi düzenleme arayüzden" },
  { route: "PUT /portfolios/:id", reason: "grup adı arayüzde satır içinde düzenlenir" },
  { route: "DELETE /portfolios/:id", reason: "silme arayüzden" },
  { route: "PUT /categories/:id", reason: "kategori arayüzde satır içinde düzenlenir" },
  { route: "DELETE /categories/:id", reason: "silme arayüzden" },
  { route: "DELETE /prices/:asset_type/:symbol", reason: "elle fiyatı sıfırlama arayüzdeki rozetten" },
  { route: "POST /ai/chat", reason: "asistanın kendi ucu" },
  { route: "POST /ai/execute", reason: "asistanın kendi ucu" },
  { route: "POST /ai/undo", reason: "asistanın kendi ucu (uygulanan planı geri alır; modelin çağırdığı bir araç değil)" },
];
