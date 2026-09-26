import { describe, it, expect } from "vitest";
import { zarfla, zarfAc, veriAc, planIslemleri } from "./zarf";
import { ZARF } from "@finans/crypto/map";
import type { AllData } from "@finans/engine";

/* Zarf codec'inin sözleşmesi. Aşama 6'da `p1` (düz metin) yerine `v1` (şifreli) gelecek —
   bu testlerin koruduğu şey biçim değil, AKIŞ: hassas alan gövdeden YALNIZ zarfın içinde
   çıkar, kısmi güncellemede zarf eksiksiz yeniden kurulur, okumada alanlar yerine döner. */

const bos = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [], ...over,
});
const zarfIci = (enc: unknown) => zarfAc({ enc }) as Record<string, unknown>;

/* SIZINTI TESTİ — rota başına. Gövdedeki her hassas değer ayırt edilebilir bir işaret
   taşır (GIZLI_… / 987654.x). Çıktıdan zarf alanları (`enc`, `*_enc`) ÇIKARILINCA geriye
   kalan hiçbir yerde işaret görünmemeli: hassas veri gövdeden YALNIZ zarfın içinde çıkar.
   Aşama 6'da zarfın içi de şifreli olacak; bu testin koruduğu şey ondan önceki adım —
   hiçbir alanın zarfı ATLAMAMASI.
   Kapsam denetimi: haritadaki her tablo en az bir rotada geçmeli. Yeni bir zarflı tablo
   eklendiğinde bu test onu kapsayan bir rota eklenene kadar düşer. */
const G = (a: string) => `GIZLI_${a}`;
const veri = bos({
  accounts: [{ id: 1, name: G("hesap1"), last_recon_balance: 987654.11 }, { id: 2, name: G("hesap2") }] as any,
  cards: [{ id: 3, name: G("kart"), limit_amount: 987654.12, statement_day: 25, due_day: 10 }] as any,
  recurring: [{ id: 4, kind: "expense", name: G("kalem"), day: 5, from_month: null, to_month: null, account_id: 1 }] as any,
  trades: [{ id: 6, date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 987654.13, price: 987654.14, fee: 0, currency: "TRY" }] as any,
  deposits: [{ id: 7, name: G("mevduat"), principal: 987654.15, rate: 40, open_date: "2026-01-01", term_days: 32, withholding: 15 }] as any,
  transactions: [{ id: 8, date: "2026-01-01", name: G("islem"), amount: -987654.16 }] as any,
});
const ROTALAR: { ad: string; tablolar: string[]; method: string; path: string; body: Record<string, unknown> }[] = [
  { ad: "hesap aç", tablolar: ["accounts", "account_entries"], method: "POST", path: "/accounts", body: { name: G("hesap"), balance: 987654.2, kind: "banka" } },
  { ad: "hesap adı", tablolar: ["accounts"], method: "PUT", path: "/accounts/1", body: { name: G("yeni") } },
  { ad: "mutabakat", tablolar: ["accounts", "account_entries"], method: "POST", path: "/accounts/1/reconcile", body: { balance: 987654.21, diff: 987654.22, note: G("not"), date: "2026-01-01" } },
  { ad: "virman", tablolar: ["transfers", "account_entries"], method: "POST", path: "/transfers", body: { date: "2026-01-01", from_account_id: 1, to_account_id: 2, amount: 987654.23, note: G("virman") } },
  { ad: "virman, notsuz (not = karşı hesabın adı)", tablolar: ["transfers", "account_entries"], method: "PUT", path: "/transfers/9", body: { date: "2026-01-01", from_account_id: 1, to_account_id: 2, amount: 987654.24 } },
  { ad: "düzenli kalem", tablolar: ["recurring", "recurring_amounts"], method: "POST", path: "/recurring", body: { name: G("kira"), kind: "expense", day: 5, amount: 987654.25 } },
  { ad: "düzenli kalem adı", tablolar: ["recurring"], method: "PUT", path: "/recurring/4", body: { name: G("kira2") } },
  { ad: "tutar değişimi", tablolar: ["recurring_amounts"], method: "POST", path: "/recurring/4/amount", body: { amount: 987654.26, from_month: "2026-09" } },
  { ad: "gerçekleştirme", tablolar: ["transactions", "account_entries"], method: "POST", path: "/recurring/4/realize", body: { ym: "2026-09", amount: -987654.27 } },
  { ad: "portföy işlemi", tablolar: ["trades", "account_entries"], method: "POST", path: "/trades", body: { date: "2026-01-01", asset_type: "BIST", symbol: "THYAO", side: "ALIŞ", qty: 987654.28, price: 987654.29, fee: 987654.3, currency: "TRY", account_id: 1, entry_amount: -987654.31 } },
  { ad: "portföy, kısmi", tablolar: ["trades"], method: "PUT", path: "/trades/6", body: { qty: 987654.32 } },
  { ad: "mevduat", tablolar: ["deposits", "account_entries"], method: "POST", path: "/deposits", body: { name: G("vadeli"), principal: 987654.33, rate: 987654.34, open_date: "2026-01-01", term_days: 987654, withholding: 98.7651, account_id: 1, entry_amount: -987654.33 } },
  { ad: "ekstre ödemesi", tablolar: ["transactions", "account_entries"], method: "POST", path: "/cards/3/pay-statement", body: { due: "2026-02-10", amount: 987654.36, account_id: 1 } },
  { ad: "işlem", tablolar: ["transactions", "account_entries"], method: "POST", path: "/transactions", body: { date: "2026-01-01", name: G("market"), amount: -987654.37, account_id: 1 } },
  { ad: "işlem, kısmi", tablolar: ["transactions", "account_entries"], method: "PUT", path: "/transactions/8", body: { amount: -987654.38 } },
  { ad: "toplu içe aktarma", tablolar: ["transactions", "account_entries"], method: "POST", path: "/transactions/bulk", body: { rows: [{ date: "2026-01-01", name: G("b1"), amount: -987654.39, account_id: 1 }] } },
  { ad: "kart", tablolar: ["cards"], method: "POST", path: "/cards", body: { name: G("kart"), limit_amount: 987654.4, statement_day: 25, due_day: 10 } },
  { ad: "kart harcaması", tablolar: ["card_txs"], method: "POST", path: "/cardtxs", body: { card_id: 3, date: "2026-01-01", name: G("harcama"), amount: 987654.41, installments: 987654 } },
  { ad: "kategori", tablolar: ["categories"], method: "POST", path: "/categories", body: { name: G("kategori"), kind: "expense" } },
  { ad: "portföy grubu", tablolar: ["portfolios"], method: "POST", path: "/portfolios", body: { name: G("grup"), note: G("not") } },
  { ad: "plan kalemi", tablolar: ["oneoffs"], method: "POST", path: "/oneoffs", body: { date: "2026-01-01", name: G("vergi"), amount: -987654.42 } },
  { ad: "kredi", tablolar: ["loans"], method: "POST", path: "/loans", body: { name: G("kredi"), amount: 987654.43, total: 987654, first_date: "2026-01-01" } },
  /* asistan deposu (aşama 5d) */
  { ad: "asistan: yeni sohbetin ilk mesajı", tablolar: ["ai_messages", "ai_conversations"], method: "POST", path: "/ai/messages", body: { conversationId: null, role: "user", content: `${G("migros")} 987654 TL`, title: G("baslik") } },
  { ad: "asistan: yanıt", tablolar: ["ai_messages"], method: "POST", path: "/ai/messages", body: { conversationId: 5, role: "assistant", content: G("yanit"), planId: "p-1" } },
  { ad: "asistan: sohbet adı", tablolar: ["ai_conversations"], method: "PUT", path: "/ai/conversations/5", body: { title: G("ad") } },
  { ad: "asistan: plan", tablolar: ["ai_plans"], method: "POST", path: "/ai/plans", body: { conversationId: 5, actions: [{ tool: "gider_ekle", args: { name: G("migros"), amount: 987654.44 }, summary: G("ozet") }] } },
  { ad: "asistan: uygulama günlüğü", tablolar: ["ai_actions"], method: "POST", path: "/ai/plans/p-1/actions", body: { items: [{ tool: "gider_ekle", summary: `${G("migros")} 987654,45 ₺`, undo_method: "DELETE", undo_path: "/transactions/8" }] } },
];
const zarfsiz = (o: unknown): unknown =>
  Array.isArray(o) ? o.map(zarfsiz)
  : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "enc" && !k.endsWith("_enc")).map(([k, v]) => [k, zarfsiz(v)]))
  : o;

describe("sızıntı: hassas alan gövdeden yalnız zarfın içinde çıkar", () => {
  for (const r of ROTALAR) {
    it(`${r.method} ${r.path} — ${r.ad}`, () => {
      const out = zarfla(r.method, r.path, r.body, veri);
      const disari = JSON.stringify(zarfsiz(out));
      expect(disari).not.toMatch(/GIZLI_|987654|98\.765/); // 98.765x: stopaj (≤100 olmak zorunda, ayrı işaret)
      expect(JSON.stringify(out)).toMatch(/"(enc|[a-z_]+_enc)":"p1:/); // bir şeyler gerçekten zarflandı
    });
  }
  it("haritadaki HER tablo en az bir rotada kapsanıyor", () => {
    const kapsanan = new Set(ROTALAR.flatMap((r) => r.tablolar));
    expect(Object.keys(ZARF).filter((t) => !kapsanan.has(t))).toEqual([]);
  });
});

describe("defter hareketleri — notlar sunucunun ürettiğiyle birebir", () => {
  const hareketi = (out: any, k = "entry_enc") => zarfIci(out[k]);
  it("hesap açılışı", () => expect(hareketi(zarfla("POST", "/accounts", { name: "G", balance: 5000 }, veri))).toEqual({ amount: 5000, note: "Açılış bakiyesi" }));
  it("sıfır bakiyeyle açılan hesap hareket YAZMAZ", () => expect(zarfla("POST", "/accounts", { name: "G", balance: 0 }, veri).entry_enc).toBeUndefined());
  it("virman: kaynak eksi, hedef artı; not yoksa karşı hesabın adı", () => {
    const out = zarfla("POST", "/transfers", { date: "2026-01-01", from_account_id: 1, to_account_id: 2, amount: 300 }, veri);
    expect(hareketi(out, "entry_from_enc")).toEqual({ amount: -300, note: `→ ${G("hesap2")}` });
    expect(hareketi(out, "entry_to_enc")).toEqual({ amount: 300, note: `← ${G("hesap1")}` });
  });
  it("mutabakat: notlu ve notsuz", () => {
    expect(hareketi(zarfla("POST", "/accounts/1/reconcile", { balance: 1, diff: -50, note: "masraf" }, veri))).toEqual({ amount: -50, note: "Mutabakat: masraf" });
    expect(hareketi(zarfla("POST", "/accounts/1/reconcile", { balance: 1, diff: -50 }, veri))).toEqual({ amount: -50, note: "Mutabakat farkı" });
  });
  it("mutabakat hesabın zarfını gerçek bakiyeyle YENİDEN kurar (ad korunur)", () => {
    expect(zarfIci(zarfla("POST", "/accounts/1/reconcile", { balance: 750, diff: 1 }, veri).enc)).toEqual({ name: G("hesap1"), last_recon_balance: 750 });
  });
  it("portföy: '<sembol> <tür>'", () => expect(hareketi(zarfla("POST", "/trades", { symbol: "THYAO", side: "ALIŞ", qty: 1, price: 1, fee: 0, entry_amount: -1 }, veri))).toEqual({ amount: -1, note: "THYAO ALIŞ" }));
  it("mevduat: '<ad> (vadeli açılış)'", () => expect(hareketi(zarfla("POST", "/deposits", { name: "32 gün", principal: 5000, rate: 40, term_days: 32, withholding: 15, entry_amount: -5000 }, veri))).toEqual({ amount: -5000, note: "32 gün (vadeli açılış)" }));
  it("ekstre: '<kart> ekstresi', tutar EKSİ", () => {
    const out = zarfla("POST", "/cards/3/pay-statement", { due: "2026-02-10", amount: 740 }, veri);
    expect(zarfIci(out.kayit_enc)).toEqual({ name: `${G("kart")} ekstresi`, amount: -740 });
    expect(hareketi(out)).toEqual({ amount: -740, note: `${G("kart")} ekstresi` });
  });
  it("gerçekleştirme: kayıt kalemin ADIYLA kurulur", () => {
    const out = zarfla("POST", "/recurring/4/realize", { ym: "2026-09", amount: -3000 }, veri);
    expect(zarfIci(out.kayit_enc)).toEqual({ name: G("kalem"), amount: -3000 });
    expect(hareketi(out)).toEqual({ amount: -3000, note: G("kalem") });
  });
  it("gerçekleştirme, kart dalı: kart harcaması (taksit 1), hareket YOK", () => {
    const d = bos({ recurring: [{ id: 4, kind: "expense", name: "Spotify", day: 5, card_id: 3 }] as any });
    const out = zarfla("POST", "/recurring/4/realize", { ym: "2026-09", amount: 150 }, d);
    expect(zarfIci(out.kayit_enc)).toEqual({ name: "Spotify", amount: 150, installments: 1 });
    expect(out.entry_enc).toBeUndefined();
  });
  it("ekstre tutarı 0 ise reddedilir (sunucunun 'bu tarihte ekstre yok'u)", () =>
    expect(() => zarfla("POST", "/cards/3/pay-statement", { due: "2026-02-10", amount: 0 }, veri)).toThrow(/ekstre yok/));
});

describe("kısmi güncelleme", () => {
  const d = bos({ loans: [{ id: 5, name: "Konut", amount: 12500, first_date: "2026-10-15", total: 120 }] as any });
  it("yalnız tutar değişince zarf mevcut satırdan TAMAMLANIR (ad ve taksit kaybolmaz)", () => {
    const out = zarfla("PUT", "/loans/5", { amount: 13000 }, d);
    expect(zarfIci(out.enc)).toEqual({ name: "Konut", amount: 13000, total: 120 });
  });
  it("yalnız düz alan değişince zarfa DOKUNULMAZ (enc gönderilmez)", () => {
    expect(zarfla("PUT", "/loans/5", { first_date: "2026-11-01" }, d)).toEqual({ first_date: "2026-11-01" });
  });
  it("satır bulunamazsa zarf uydurulmaz — açık hata", () => {
    expect(() => zarfla("PUT", "/loans/99", { amount: 1 }, d)).toThrow(/bulunamadı/);
  });
  it("POST'ta gönderilmeyen hassas alan null olarak zarfa girer (okuma tarafı tutarlı olsun)", () => {
    expect(zarfIci(zarfla("POST", "/portfolios", { name: "Emeklilik" }, bos()).enc)).toEqual({ name: "Emeklilik", note: null });
  });
});

describe("yönlendirme", () => {
  it("tanımadığı uca dokunmaz", () => {
    expect(zarfla("PUT", "/settings", { horizon: "6" }, bos())).toEqual({ horizon: "6" });
  });
  it("portföy grubuna taşıma (yalnız FK) zarfa dokunmaz", () => {
    expect(zarfla("PUT", "/trades/6/portfolio", { portfolio_id: 2 }, bos())).toEqual({ portfolio_id: 2 });
  });
  it("DELETE ve GET gövdesine dokunmaz", () => {
    expect(zarfla("DELETE", "/loans/5", { x: 1 }, bos())).toEqual({ x: 1 });
  });
});

describe("okuma", () => {
  it("zarfı açar, alanları satıra yerleştirir, enc'i kaldırır", () => {
    expect(zarfAc({ id: 1, kind: "expense", enc: 'p1:{"name":"Market"}' })).toEqual({ id: 1, kind: "expense", name: "Market" });
  });
  it("zarfsız satır (göç öncesi sunucu, eski PWA önbelleği) olduğu gibi döner", () => {
    expect(zarfAc({ id: 1, name: "Market" })).toEqual({ id: 1, name: "Market" });
  });
  it("tanınmayan biçim SESSİZCE yutulmaz", () => {
    expect(() => zarfAc({ enc: "x9:abc" })).toThrow(/tanınmayan/);
  });
  it("sunucunun artık yapamadığı AD SIRALAMASINI kurar (Türkçe)", () => {
    const d = veriAc(bos({ categories: [
      { id: 1, kind: "expense", enc: 'p1:{"name":"Ulaşım"}' }, { id: 2, kind: "expense", enc: 'p1:{"name":"Çay"}' },
      { id: 3, kind: "expense", enc: 'p1:{"name":"Aidat"}' },
    ] as any }));
    expect(d.categories.map((c) => c.name)).toEqual(["Aidat", "Çay", "Ulaşım"]);
  });
  it("gidiş-dönüş: zarflanan satır okunduğunda aynı alanları verir", () => {
    const out = zarfla("POST", "/oneoffs", { date: "2026-12-01", name: "Vergi", amount: -8400.25 }, bos());
    expect(zarfAc({ id: 1, ...out })).toEqual({ id: 1, date: "2026-12-01", name: "Vergi", amount: -8400.25 });
  });
});

describe("sunucudan taşınan değer kuralları (adet/fiyat/anapara artık zarfta)", () => {
  const islem = { date: "2026-01-01", asset_type: "BIST", symbol: "X", side: "ALIŞ", qty: 10, price: 5, fee: 0, currency: "TRY" };
  it("adet 0 reddedilir", () => expect(() => zarfla("POST", "/trades", { ...islem, qty: 0 }, veri)).toThrow(/adet/));
  it("bedelsizde fiyat 0 olmalı", () => expect(() => zarfla("POST", "/trades", { ...islem, side: "BEDELSİZ", price: 5 }, veri)).toThrow(/bedelsiz/));
  it("bedelsiz, fiyat 0 → geçer", () => expect(() => zarfla("POST", "/trades", { ...islem, side: "BEDELSİZ", price: 0 }, veri)).not.toThrow());
  it("alışta fiyat 0 reddedilir", () => expect(() => zarfla("POST", "/trades", { ...islem, price: 0 }, veri)).toThrow(/fiyat/));
  it("komisyon verilmemişse 0 yazılır", () => expect(zarfIci(zarfla("POST", "/trades", { ...islem, fee: undefined }, veri).enc).fee).toBe(0));
  it("mevduat: anapara 0 / gün 0 / stopaj 120 reddedilir", () => {
    const m = { name: "V", principal: 1000, rate: 40, term_days: 32, withholding: 15, open_date: "2026-01-01" };
    expect(() => zarfla("POST", "/deposits", { ...m, principal: 0 }, veri)).toThrow(/geçersiz/);
    expect(() => zarfla("POST", "/deposits", { ...m, term_days: 0 }, veri)).toThrow(/geçersiz/);
    expect(() => zarfla("POST", "/deposits", { ...m, withholding: 120 }, veri)).toThrow(/geçersiz/);
    expect(() => zarfla("POST", "/deposits", m, veri)).not.toThrow();
  });
  it("virman: tutar 0 reddedilir", () => expect(() => zarfla("POST", "/transfers", { from_account_id: 1, to_account_id: 2, amount: 0 }, veri)).toThrow(/0'dan büyük/));
});

describe("asistan deposu (aşama 5d)", () => {
  it("başlık yalnız YENİ sohbette gider; verilmezse 'Yeni sohbet'", () => {
    expect(zarfla("POST", "/ai/messages", { conversationId: 5, role: "user", content: "a", title: "x" }, bos()).title_enc).toBeUndefined();
    expect(zarfIci(zarfla("POST", "/ai/messages", { conversationId: null, role: "user", content: "a" }, bos()).title_enc)).toEqual({ title: "Yeni sohbet" });
  });
  it("sunucunun eski kırpması istemcide: kullanıcı 4.000, asistan 8.000, başlık 120", () => {
    const uzun = "x".repeat(9000);
    expect((zarfIci(zarfla("POST", "/ai/messages", { conversationId: 1, role: "user", content: uzun }, bos()).enc).content as string).length).toBe(4000);
    expect((zarfIci(zarfla("POST", "/ai/messages", { conversationId: 1, role: "assistant", content: uzun }, bos()).enc).content as string).length).toBe(8000);
    expect((zarfIci(zarfla("PUT", "/ai/conversations/1", { title: "  a   b " + uzun }, bos()).enc).title as string).length).toBe(120);
  });
  it("boş mesaj, boş başlık ve biçimsiz plan reddedilir", () => {
    expect(() => zarfla("POST", "/ai/messages", { conversationId: 1, role: "user", content: "   " }, bos())).toThrow(/mesaj yok/);
    expect(() => zarfla("PUT", "/ai/conversations/1", { title: " " }, bos())).toThrow(/boş olamaz/);
    expect(() => zarfla("POST", "/ai/plans", { conversationId: 1, actions: [] }, bos())).toThrow(/geçersiz plan/);
    expect(() => zarfla("POST", "/ai/plans", { conversationId: 1, actions: [{ tool: "x" }] }, bos())).toThrow(/plan satırı/);
  });
  it("plan gidiş-dönüş; göçle gelen eski satırda actions METİNDİR, aynı listeye açılır", () => {
    const actions = [{ tool: "gider_ekle", args: { amount: 450 }, summary: "Migros 450" }];
    expect(planIslemleri(zarfIci(zarfla("POST", "/ai/plans", { conversationId: 1, actions }, bos()).enc).actions)).toEqual(actions);
    expect(planIslemleri(zarfIci(`p1:${JSON.stringify({ actions: JSON.stringify(actions) })}`).actions)).toEqual(actions);
  });
});
