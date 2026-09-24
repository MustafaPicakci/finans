/* Mobil görünüm denetimi için sahte API + statik sunucu.
   Veritabanı GEREKMEZ: apps/web/dist'i sunar ve /api uçlarına gerçekçi sabit veri döner.
   Amaç yalnız YERLEŞİMİ görmek (dar ekranda taşma/kayma), veri doğruluğu değil. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const today = new Date();
const d = (offset) => {
  const x = new Date(today); x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};

const accounts = [
  { id: 1, name: "Garanti Vadesiz", balance: 48250.75, kind: "banka", last_recon_date: null, last_recon_balance: null },
  { id: 2, name: "İş Bankası Maaş", balance: 12980.4, kind: "banka", last_recon_date: d(-40), last_recon_balance: 12000 },
  { id: 3, name: "Nakit Cüzdan", balance: 1750, kind: "nakit", last_recon_date: d(-3), last_recon_balance: 1750 },
  { id: 4, name: "Midas Yatırım", balance: 8400.2, kind: "araci", last_recon_date: null, last_recon_balance: null },
];
const categories = [
  { id: 1, name: "Market", kind: "expense", color: null },
  { id: 2, name: "Ulaşım", kind: "expense", color: null },
  { id: 3, name: "Maaş", kind: "income", color: null },
  { id: 4, name: "Faturalar", kind: "expense", color: null },
];
const cards = [
  { id: 1, name: "Akbank Axess", limit_amount: 60000, statement_day: 25, due_day: 10, pay_account_id: 1 },
  { id: 2, name: "Garanti Bonus", limit_amount: 35000, statement_day: 15, due_day: 3, pay_account_id: null },
];
/* Faz 39 — kategori İKİ HÂLİYLE duruyor (company_events'in `tahmini` fikstürüyle aynı gerekçe):
   biri kategorili (satırda "kart · kategori" görünür), biri kategorisiz (yalnız kart adı).
   Hepsi kategorili olsaydı kategorisiz satırın yerleşimi hiç denetlenemezdi. */
const card_txs = [
  { id: 1, card_id: 1, date: d(-12), name: "Teknoloji mağazası", amount: 18400, installments: 6, category_id: null },
  { id: 2, card_id: 1, date: d(-5), name: "Market alışverişi", amount: 1240.5, installments: 1, category_id: 1 },
  { id: 3, card_id: 2, date: d(-20), name: "Uçak bileti", amount: 7850, installments: 3, category_id: 2 },
];
const trades = [
  { id: 1, date: d(-120), asset_type: "BIST", symbol: "ASELS", side: "ALIŞ", qty: 200, price: 62.4, fee: 12, currency: "TRY", account_id: 4, portfolio_id: 1 },
  { id: 2, date: d(-90), asset_type: "FON", symbol: "TP2", side: "ALIŞ", qty: 30000, price: 1.82, fee: 0, currency: "TRY", account_id: 1, portfolio_id: null },
  { id: 3, date: d(-45), asset_type: "KRIPTO", symbol: "BTC", side: "ALIŞ", qty: 0.05, price: 93500, fee: 8, currency: "USD", account_id: null, portfolio_id: 2 },
  { id: 4, date: d(-30), asset_type: "ETF", symbol: "VOO", side: "ALIŞ", qty: 3, price: 545.2, fee: 1, currency: "USD", account_id: null, portfolio_id: 2 },
  { id: 5, date: d(-10), asset_type: "BIST", symbol: "ASELS", side: "SATIŞ", qty: 50, price: 78.9, fee: 6, currency: "TRY", account_id: 4, portfolio_id: 1 },
  /* Faz 31 — Varlık Takibi ekranının ASIL durumları burada doğrulanır. Bunlar olmadan
     fikstürde yalnız açık pozisyon vardı; kapanan pozisyon bölümü ve iki dönemli sembol
     hiç çizilmiyordu, yani yerleşimleri hiç görülemiyordu. */
  // tamamen kapanmış pozisyon — "Kapanan pozisyonlar" bölümü için
  { id: 6, date: d(-200), asset_type: "BIST", symbol: "EREGL", side: "ALIŞ", qty: 100, price: 38.2, fee: 5, currency: "TRY", account_id: 4, portfolio_id: 1 },
  { id: 7, date: d(-150), asset_type: "BIST", symbol: "EREGL", side: "SATIŞ", qty: 100, price: 45.6, fee: 7, currency: "TRY", account_id: 4, portfolio_id: 1 },
  // satılıp YENİDEN alınan sembol — iki ayrı pozisyon dönemi (biri kapalı, biri açık)
  { id: 8, date: d(-180), asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 80, price: 240, fee: 10, currency: "TRY", account_id: 4, portfolio_id: 1 },
  { id: 9, date: d(-100), asset_type: "BIST", symbol: "THYAO", side: "SATIŞ", qty: 80, price: 265, fee: 11, currency: "TRY", account_id: 4, portfolio_id: 1 },
  { id: 10, date: d(-20), asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 40, price: 290, fee: 6, currency: "TRY", account_id: 4, portfolio_id: 1 },
  // temettü — akış görünümündeki rozeti ve "gerçekleşenin içinde" ayrımını çizer
  { id: 11, date: d(-60), asset_type: "BIST", symbol: "ASELS", side: "TEMETTÜ", qty: 200, price: 1.5, fee: 45, currency: "TRY", account_id: 4, portfolio_id: 1 },
];
const prices = [
  { symbol: "ASELS", asset_type: "BIST", price: 81.25, source: "auto", updated_at: `${d(0)} 10:15:00`, currency: "TRY" },
  { symbol: "TP2", asset_type: "FON", price: 2.04, source: "auto", updated_at: `${d(0)} 09:00:00`, currency: "TRY" },
  { symbol: "BTC", asset_type: "KRIPTO", price: 98750, source: "auto", updated_at: `${d(0)} 10:15:00`, currency: "USD" },
  { symbol: "VOO", asset_type: "ETF", price: 561.8, source: "manual", updated_at: `${d(0)} 10:15:00`, currency: "USD" },
  { symbol: "THYAO", asset_type: "BIST", price: 312.5, source: "auto", updated_at: `${d(0)} 10:15:00`, currency: "TRY" },
];
/* Fiyat geçmişi — GERÇEKTEKİ kapsam farkını taklit eder (Faz 32 tablosunun asıl sınavı bu):
   BIST/ETF/KRIPTO Yahoo'dan 2 yıl geriye DOLDURULABİLİYOR, FON (TEFAS) ve ALTIN doldurulamıyor.
   Bu yüzden TP2 kısa geçmişli bırakıldı: tabloda "Yıllık" kolonunun "—" göstermesi doğru
   davranıştır ve uydurulmuş getiri olmadığının ekrandaki kanıtıdır.
   Günlük çözünürlük: 2 günde bir olsaydı "Günlük" kolonu aslında iki günü ölçerdi. */
const price_history = [];
const seri = (symbol, asset_type, gun, bas, egim, currency = "TRY") => {
  for (let i = gun; i >= 0; i--) {
    const t = gun - i;
    // hafif dalga: düz doğru, sparkline ve grafikleri gerçekçi göstermiyor
    const dalga = Math.sin(t / 9) * bas * 0.015;
    price_history.push({ symbol, asset_type, date: d(-i), price: +(bas + t * egim + dalga).toFixed(4), currency });
  }
};
seri("ASELS", "BIST", 400, 52, 0.073);
seri("THYAO", "BIST", 400, 195, 0.293);
seri("BTC", "KRIPTO", 400, 68000, 76.9, "USD");
seri("VOO", "ETF", 400, 470, 0.23, "USD");
seri("TP2", "FON", 120, 1.82, 0.0018); // TEFAS geriye doldurulamaz → uzun pencereler boş kalır
/* Faz 27 referans endeksleri — hepsi TL cinsinden (sunucuda o günün kuruyla çevrilir).
   Farklı eğimler bilinçli: grafikte serilerin ayrıştığı görülebilsin. */
const benchmark_history = [];
for (let i = 120; i >= 0; i -= 2) {
  const t = 120 - i;
  benchmark_history.push({ key: "BIST100", date: d(-i), price: 10500 + t * 24 });
  benchmark_history.push({ key: "SP500", date: d(-i), price: 268000 + t * 900 });
  benchmark_history.push({ key: "NASDAQ", date: d(-i), price: 915000 + t * 1800 });
  benchmark_history.push({ key: "GRAMALTIN", date: d(-i), price: 4380 + t * 6 });
  benchmark_history.push({ key: "USDTRY", date: d(-i), price: 41.2 + t * 0.05 });
}
const transactions = [
  { id: 1, date: d(-1), name: "Migros market alışverişi", amount: -1247.9, category_id: 1, account_id: 1 },
  { id: 2, date: d(-2), name: "Metro ulaşım", amount: -180, category_id: 2, account_id: 3 },
  { id: 3, date: d(-5), name: "Ağustos maaşı", amount: 68500, category_id: 3, account_id: 2 },
  { id: 4, date: d(-8), name: "Elektrik faturası", amount: -1890.25, category_id: 4, account_id: 1 },
  { id: 5, date: d(-15), name: "Akbank Axess ekstresi", amount: -12480, category_id: null, account_id: 1 },
];
const recurring = [
  { id: 1, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null, account_id: 2, card_id: null, category_id: 3, auto: true },
  { id: 2, kind: "expense", name: "Kira", day: 5, from_month: null, to_month: null, account_id: 1, card_id: null, category_id: null, auto: false },
  { id: 3, kind: "expense", name: "Netflix aboneliği", day: 20, from_month: null, to_month: null, account_id: null, card_id: 1, category_id: null, auto: true },
];
const all = {
  accounts, categories, cards, card_txs, trades, prices, price_history, benchmark_history, transactions, recurring,
  /* Sunucunun "şimdi"si — fiyat yaşı ("12 dk önce çekildi") bunun `prices.updated_at` ile
     farkından çıkar, tarayıcı saatinden DEĞİL. Gerçek saat yerine damgalara göre SABİT bir
     an seçiliyor: yaş her çekimde aynı çıksın, yerleşim denetimi günün saatine göre
     "az önce"den "9 sa önce"ye kaymasın. Fiyatlar 10:15, fon 09:00 → 12 dk / 1 sa 27 dk. */
  now: `${d(0)} 10:27:00`,
  recurring_amounts: [
    { recurring_id: 1, from_month: "0000-01", amount: 68500 },
    { recurring_id: 2, from_month: "0000-01", amount: 24000 },
    { recurring_id: 3, from_month: "0000-01", amount: 229.99 },
  ],
  loans: [{ id: 1, name: "Taşıt kredisi", amount: 9450.3, first_date: d(-200), total: 36 }],
  oneoffs: [{ id: 1, date: d(12), name: "Vergi ödemesi", amount: -8400 }],
  portfolios: [{ id: 1, name: "Alfa Portföy", note: null }, { id: 2, name: "Emeklilik", note: null }],
  deposits: [{ id: 1, name: "32 gün vadeli", principal: 50000, rate: 42.5, open_date: d(-20), term_days: 32, withholding: 15, account_id: 1 }],
  recurring_realized: [], statement_payments: [],
  account_entries: [
    { id: 1, account_id: 1, date: d(-1), amount: -1247.9, kind: "islem", source_table: "transactions", source_id: 1, note: "Migros market alışverişi", created_at: `${d(-1)} 19:00:00` },
    { id: 2, account_id: 1, date: d(-8), amount: -1890.25, kind: "islem", source_table: "transactions", source_id: 4, note: "Elektrik faturası", created_at: `${d(-8)} 12:00:00` },
    { id: 3, account_id: 1, date: d(-200), amount: 60000, kind: "acilis", source_table: null, source_id: null, note: "Açılış bakiyesi", created_at: `${d(-200)} 09:00:00` },
  ],
  transfers: [{ id: 1, date: d(-6), from_account_id: 1, to_account_id: 3, amount: 2000, note: "ATM çekimi" }],
  settings: { fx_usd_try: "41.85", horizon: "6", cash_funds: "", drip_symbols: "BIST:ASELS" },
  /* Faz 36 — kurumsal olaylar. Fikstür BİLEREK üç durumu birden kurar, yoksa Özet'teki kart
     hiç çizilmez ve yerleşimi görülemez:
     1. ASELS bedelsizi (150 gün önce, alımdan SONRA → öneri ÇIKAR),
     2. ASELS temettüsü + drip_symbols açık → "Geri yatır" düğmesi de çıkar,
     3. EREGL temettüsü pozisyon kapandıktan sonra → öneri ÇIKMAZ (kuralın sessiz kaldığı
        durum da denetlenebilsin; kart yalnız ikisini göstermeli). */
  corporate_actions: [
    { symbol: "ASELS", asset_type: "BIST", date: d(-100), kind: "bolunme", value: 2, currency: "TRY" },
    /* d(-60) DEĞİL: fikstürde o tarihte zaten bir TEMETTÜ kaydı var ve kural onu doğru
       şekilde bastırıyordu — yani "Geri yatır" yolu hiç çizilmiyordu. Kaydı olmayan bir
       tarih seçildi ki önerinin kendisi de denetlenebilsin. */
    { symbol: "ASELS", asset_type: "BIST", date: d(-25), kind: "temettu", value: 0.2346, currency: "TRY" },
    { symbol: "EREGL", asset_type: "BIST", date: d(-40), kind: "temettu", value: 1.15, currency: "TRY" },
  ],
  /* Faz 37 — bilanço tarihleri. İKİ durum birden kurulur, çünkü satırın görünümü buna göre
     değişiyor: duyurulmuş tarih düz yazılır, TAHMİNİ tarih "~" ile. Biri eksik olsaydı
     yerleşimde hangisinin nasıl göründüğü denetlenemezdi. */
  company_events: [
    { symbol: "ASELS", asset_type: "BIST", kind: "bilanco", date: d(18), tahmini: true },
    { symbol: "EREGL", asset_type: "BIST", kind: "bilanco", date: d(6), tahmini: false },
  ],
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };

/* Asistan sekmesinin stub deposu (bkz. /api/ai/* uçları) — süreç ömrü boyunca bellekte. */
const aiSimdi = () => new Date().toISOString().slice(0, 19).replace("T", " ");
let aiMesajNo = 2;
const aiKonusmalar = [
  {
    id: 1, title: "dün markete 1.250 TL harcadım, Axess'le", at: aiSimdi(), undoable: 0,
    messages: [
      { id: 1, role: "user", content: "dün markete 1.250 TL harcadım, Axess'le", at: aiSimdi(), planId: null },
      { id: 2, role: "assistant", content: "Anladım. Aşağıdaki iki kaydı oluşturacağım, onayına sunuyorum.", at: aiSimdi(), planId: null },
    ],
    plans: [],
    /* Onay kartı AÇILIŞTA duruyor: mobilde bakılacak asıl yerleşim o (kart sohbet
       gövdesinin dışındadır ki kaydırılan pencerede kırpılmasın). */
    pending: {
      planId: "stub-plan", at: aiSimdi(),
      actions: [
        { tool: "kart_harcamasi", summary: "Akbank Axess kartına 1.250,00 ₺ market harcaması (3 taksit), 6 Eyl", args: {} },
        { tool: "gelir_gider", summary: "Garanti Vadesiz hesabından 480,00 ₺ ulaşım gideri, bugün", args: {} },
      ],
    },
  },
  {
    id: 2, title: "Akbank kartının ekstresini ödedim", at: aiSimdi(), undoable: 1, pending: null,
    /* Uygulanmış plan: "geri al" düğmesinin mesaj ALTINDA render edildiği hâl */
    messages: [
      { id: 101, role: "user", content: "Akbank kartının ekstresini ödedim", at: aiSimdi(), planId: null },
      { id: 102, role: "assistant", content: "✓ Akbank ekstresi ödendi · 4.820,00 ₺ · Garanti Vadesiz", at: aiSimdi(), planId: "eski-plan" },
    ],
    plans: [{ planId: "eski-plan", at: aiSimdi(), total: 1, undoable: 1, summary: "Ekstre ödemesi: Akbank · vade 2026-09-14 · Garanti Vadesiz" }],
  },
];

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  /* GİRİŞ EKRANI da uygulamanın bir ekranı ve mobilde denetlenebilmeli: `CIKIS=1` ile
     stub oturumsuz davranır (`user: null`) → App kabuğu Auth ekranını render eder.
     Kullanım: CIKIS=1 node apps/web/scripts/mobil-stub.mjs */
  if (url.pathname === "/api/auth/me") {
    return json({ user: process.env.CIKIS ? null : { id: 1, email: "demo@finans.local" } });
  }
  if (url.pathname === "/api/all") return json(all);
  if (url.pathname === "/api/ai/status") return json({ enabled: true, model: "gemini/gemini-3.6-flash (2 anahtar)" });
  /* Asistan (Faz 34): sohbet sunucuda yaşadığından stub'ın da bir sohbeti olması gerekir —
     yoksa sekme boş açılır ve mobilde asıl bakılacak şeyler (sohbet listesi, onay kartı,
     mesaj altındaki "geri al") hiç render edilmez. Bellekte küçük bir depo yeter: model
     yok, ağ yok, ne gönderilirse gönderilsin sabit iki adımlık bir plan döner. */
  if (url.pathname === "/api/ai/conversations" && req.method === "GET") {
    return json({ conversations: aiKonusmalar.map(({ id, title, at, messages, undoable }) => ({ id, title, at, messages: messages.length, undoable })), more: false });
  }
  if (url.pathname.startsWith("/api/ai/conversations/")) {
    const id = Number(url.pathname.split("/").pop());
    const k = aiKonusmalar.find((x) => x.id === id);
    if (!k) return json({ error: "konuşma bulunamadı" }, 404);
    if (req.method === "DELETE") { aiKonusmalar.splice(aiKonusmalar.indexOf(k), 1); return json({ ok: true }); }
    if (req.method === "PUT") { k.title = "Yeniden adlandırıldı"; return json({ ok: true, title: k.title }); }
    return json({ id: k.id, title: k.title, messages: k.messages, truncated: false, plans: k.plans, pending: k.pending });
  }
  if (url.pathname === "/api/ai/chat") {
    const k = aiKonusmalar[0];
    k.messages.push({ id: ++aiMesajNo, role: "user", content: "dün markete 1.250 TL harcadım, Axess'le", at: aiSimdi(), planId: null });
    k.messages.push({ id: ++aiMesajNo, role: "assistant", content: "Anladım. Aşağıdaki iki kaydı oluşturacağım, onayına sunuyorum.", at: aiSimdi(), planId: null });
    k.pending = {
      planId: "stub-plan", at: aiSimdi(),
      actions: [
        { tool: "kart_harcamasi", summary: "Akbank Axess kartına 1.250,00 ₺ market harcaması (3 taksit), 6 Eyl", args: {} },
        { tool: "gelir_gider", summary: "Garanti Vadesiz hesabından 480,00 ₺ ulaşım gideri, bugün", args: {} },
      ],
    };
    return json({ conversationId: k.id, reply: "Anladım.", pending: k.pending.actions, model: "gemini/gemini-3.6-flash", planId: "stub-plan" });
  }
  if (url.pathname === "/api/ai/execute") {
    const k = aiKonusmalar[0];
    k.messages.push({ id: ++aiMesajNo, role: "assistant", content: "✓ Akbank Axess · Market · 1.250,00 ₺\n✓ Gider: Ulaşım · 480,00 ₺", at: aiSimdi(), planId: "stub-plan" });
    k.plans = [{ planId: "stub-plan", at: aiSimdi(), total: 2, undoable: 2, summary: "Akbank Axess kartına 1.250,00 ₺ market harcaması" }]; k.pending = null; k.undoable = 2;
    return json({ conversationId: k.id, results: [], undoable: 2 });
  }
  if (url.pathname === "/api/ai/undo") {
    const k = aiKonusmalar[0];
    k.plans = k.plans.map((p) => ({ ...p, undoable: 0 })); k.undoable = 0;
    return json({ conversationId: k.id, results: [] });
  }
  /* AYAR YAZMALARI GERÇEKTEN UYGULANIR — aşağıdaki catch-all'a düşseydi stub {ok:true} der,
     değeri saklamaz ve arayüz reload'dan sonra ESKİ değeri geri okurdu. Sonuç: "nakit say",
     "temettüyü geri yatır" gibi AÇIK/KAPALI düğmelerin yalnız bir hâli denetlenebiliyordu;
     kapalı hâlin yerleşimi (anahtar topuzu, renk) hiç görülmüyordu. */
  if (url.pathname === "/api/settings" && (req.method === "PUT" || req.method === "POST")) {
    let govde = "";
    for await (const parca of req) govde += parca;
    try { Object.assign(all.settings, JSON.parse(govde || "{}")); } catch { /* bozuk gövde: yok say */ }
    return json({ ok: true });
  }
  if (url.pathname.startsWith("/api/")) return json({ ok: true });
  try {
    const p = url.pathname === "/" ? "/index.html" : url.pathname;
    const buf = await readFile(join(DIST, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    const buf = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "content-type": "text/html" });
    res.end(buf);
  }
}).listen(8791, () => console.log("stub → http://localhost:8791"));
