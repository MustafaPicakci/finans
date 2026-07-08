# Finans — Kişisel Finans Uygulamasına Evrim Planı

## Durum

- ✅ **Faz 0 tamamlandı** — pnpm monorepo iskeleti (`apps/server`, `apps/web`, `packages/engine`), finans matematiğinin `packages/engine`'e çıkarımı + 46 vitest testi, `apps/web`'in tab başına `features/` klasörlerine bölünmesi. Davranış değişikliği yok; gerçek `data/finans.db` ile doğrulandı.
- ✅ **Faz 1 tamamlandı (kapsamı daraltılmış)** — Faz 1'e başlarken kullanıcıyla "hesap bakiyesi türetilir" (orijinal plan) vs "ek defter" seçeneği tekrar değerlendirildi; kullanıcı **ek defter**i seçti: `accounts.balance` ve tüm projeksiyon/kart/kredi matematiği **hiç değişmedi**. Sadece kategorili *gerçekleşen harcama* takibi için ayrı `categories`+`transactions` tabloları ve Bütçe sekmesinde yeni bir bölüm eklendi. Aşağıdaki "Faz 1" planı bu yüzden orijinal haliyle değil, gerçekleşen (daraltılmış) haliyle güncellendi.
- ✅ **Faz 2 tamamlandı** — `vite-plugin-pwa` ile manifest + service worker (statikler precache, `/api/all` network-first), mobil ikonlar (`apps/web/public/`), mobilde alt sekme çubuğu (bottom nav) + masaüstünde üst sekmeler arası responsive geçiş (`max-width:720px`). Playwright ile hem masaüstü hem mobil görünüm görsel olarak doğrulandı (konsol hatası yok, gerçek veriyle).
- ⬜ Faz 3–5 henüz başlamadı.

## Context (Neden)

Başlangıç durumu: tek süreçli Hono + SQLite API, tek dosyalık React arayüz (`src/App.tsx`, ~1000 satır), projeksiyon-odaklı model (hesap bakiyeleri elle güncellenir, `recurring`/`loans`/`oneoffs`/`card_txs` gelecek nakit akışını üretir). Portföy `trades` defteriyle zaten ledger mantığında.

Hedef vizyon (kullanıcının tarifi): tüm yatırımlar + bütçe/nakit akışını ilgilendiren her gelir-gider tek uygulamada; arayüzden takip; ileride banka/Midas ekstre importu; sonunda web + mobil uygulama; auth en sonda.

Kullanıcı kararları:
1. **Mobil = PWA** (tek kod tabanı, kurulabilir web uygulaması)
2. **Entegrasyon = şimdilik manuel, dosya importu sonraki faz**
3. **Mimari = pnpm monorepo** (apps/server, apps/web, packages/engine)
4. **Veri modeli = sadece gerçekleşen defter (ledger-first)**: bakiye = Σ işlemler; projeksiyon şablonlardan üretilir

Not: TEFAS API'si F5 bot-koruması arkasına alınmış (fon fiyatı otomatik çekilemiyor); fonlar elle fiyatlanıyor, istenirse anahtarlı sağlayıcı adaptörü Faz 3'te değerlendirilebilir.

---

## Faz 0 — Monorepo İskeleti (davranış değişikliği yok) ✅

```
finans/
  package.json            (pnpm workspaces kök; scripts: dev/build/start/test)
  pnpm-workspace.yaml
  apps/
    server/               (Hono API + SQLite; kendi package.json)
    web/                  (React/Vite SPA; kendi package.json)
  packages/
    engine/               (saf TS finans matematiği + vitest testleri)
  data/                   (yerinde kalır; DATA_DIR mantığı korunur)
  Dockerfile, docker-compose.yml (pnpm monorepo'ya uyarlandı)
```

Yapılanlar:
- pnpm'e geçiş (`packageManager` alanı, `pnpm-workspace.yaml`). Node 22 + `NODE_OPTIONS=--experimental-sqlite` korundu.
- `packages/engine`: saf fonksiyonlar taşındı — `project()`, `cardInfos/txShares/firstCutoff/dueOf`, `positions()`, `loanRemaining/loanActiveOn`, `recActiveOn`, tarih yardımcıları (`hits`, `clampDay`, `ymOf`, `normYm`...).
- `packages/engine` testleri (vitest, 46 test): kart ekstre matematiği (kesim günü sınırları, kısa aylar, taksit bölünmesi), kredi kalan taksit, ağırlıklı ortalama maliyet (pozisyon kapanıp yeniden açılma), projeksiyon uçları. Bu testler Faz 1'deki model değişiminin güvenlik ağıdır.
- `apps/web/src` bölündü: `features/` (butce, nakit, borc, kart, portfoy, ozet — tab başına klasör), `ui/` (Field, Money, Row, Empty, Center), `theme.ts` (css/T tema).
- Kök `pnpm build` = `pnpm -r build` (her paket kendi `tsc --noEmit`/`vite build`'ini çalıştırır) — CI kapısı bu.
- `apps/server/db.ts`: `DATA_DIR` verilmemişse veri dizini `import.meta.dirname` ile repo köküne göre bulunuyor (cwd'den bağımsız).

## Faz 1 — Kategorili Gerçekleşen Harcama Defteri ✅

Yapılanlar (`apps/server/db.ts`, `CREATE TABLE IF NOT EXISTS` ile — yeni tablolar, mevcut şemaya dokunulmadı):

```sql
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  color TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,              -- işaretli: gelir +, gider −
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL  -- opsiyonel, sadece bilgi amaçlı
);
```

Model kuralları (daraltılmış kapsam — kullanıcı onayıyla):
- **`accounts.balance` değişmedi.** Elle güncelleme akışı, projeksiyon (`project()`), kart/kredi matematiği tamamen aynı kaldı — bu defter onlara bağlı değil, onları etkilemiyor.
- **`transactions` bağımsız bir defter**: sadece "ne harcadım/kazandım, hangi kategoride" sorusuna cevap verir. `recurring`/`loans`/`cards`'tan otomatik satır üretimi (cron ile "generated" kayıt) **yapılmıyor** — kapsam dışı bırakıldı, gelecekte istenirse ayrı bir iyileştirme olarak eklenebilir.
- `oneoffs` tablosu değişmedi, `transactions`'a taşınmadı — o hâlâ projeksiyon sisteminin parçası.
- Kategori silinirse (`ON DELETE SET NULL`) o kategorideki işlemler "Kategorisiz" altında kalır, silinmez.

API (`apps/server/index.ts`): mevcut `crud()` fabrikasıyla `transactions` ve `categories` CRUD; `GET /api/all` yeni alanları da döner.

Engine (`packages/engine/src/ledger.ts`, 6 vitest testi): `categoryTotals(transactions, categories, ym)` — bir ay için kategori bazlı toplam/adet (mutlak değere göre sıralı); `transactionsInMonth` — bir ayın işlemlerini yeniden-eskiye sıralar.

UI (`apps/web/src/features/butce/index.tsx`, `GercekHarcamalar` bileşeni): Bütçe sekmesine 4. kart olarak eklendi — ay seçici, kategori bazlı toplamlar, işlem ekleme/silme, kategori yönetimi (ekle/sil).

Doğrulama: `pnpm build` temiz, 52 engine testi yeşil, gerçek `data/finans.db` üzerinde prod sunucu ile uçtan uca test edildi (kategori/işlem ekle-listele-sil, eski veri MD5 değişmedi).

## Faz 2 — Mobil-Öncelikli Arayüz + PWA ✅

Yapılanlar:
- **Responsive geçiş** (`apps/web/src/App.tsx`): `max-width:720px` kırılım noktası. Masaüstünde üst sekmeler (`.top-tabs`), mobilde sabit alt sekme çubuğu (`.bottom-nav`, `position:fixed`, `env(safe-area-inset-bottom)` ile iOS notch payı, kısa etiketler: "Nakit Akışı"→"Nakit" vb.). Mevcut inline-style tema (`T`, `css`) korundu; kartlar zaten `flexWrap`/`auto-fit` grid ile tek kolona düşüyordu, ek değişiklik gerekmedi. Mobilde `input/select/button` için `min-height:40px` dokunma hedefi.
- **`vite-plugin-pwa`** (`apps/web/vite.config.ts`): manifest (ad "Finans", `tr` dil, `#0D1322` tema/arka plan rengi, 192/512/512-maskable ikonlar), `generateSW` modu — statikler precache (14 girdi, ~636 KiB), `/api/all` `NetworkFirst` (5sn timeout, sonra son başarılı kopya — offline'da salt-okunur gösterim).
- İkonlar `apps/web/public/` altında SVG kaynağından (`icon.svg`, `icon-maskable.svg`) `rsvg-convert` ile üretildi (192/512/maskable-512/apple-touch-icon/favicon). `index.html`'e `apple-mobile-web-app-*` meta etiketleri ve `viewport-fit=cover` eklendi.
- Playwright (geçici, proje bağımlılığı değil) ile masaüstü (1280px, üst sekmeler) ve mobil (390px, alt nav) görünümleri gerçek `data/finans.db` ile ekran görüntüsü alınarak doğrulandı; konsol hatası yok, manifest doğru içerikle 200 dönüyor.

## Faz 3 — Portföy Derinleştirme

- **Fiyat geçmişi**: `price_history (symbol, asset_type, date, price)` tablosu; `refreshAll()` her başarılı tazelemede günün kaydını yazar (günde bir upsert). Özet sekmesine net varlık zaman grafiği (recharts zaten bağımlılıkta).
- Temettü + bedelli/bedelsiz kayıtları: `trades.side`'a `TEMETTU` / sermaye olayı türleri ya da ayrı `corporate_actions` tablosu; `engine.positions` maliyet hesabına işler. Temettü aynı zamanda deftere gelir işlemi düşer (ledger tutarlılığı).
- İşlem → hesap bağlantısı: alışta hesaptan düşen, satışta hesaba giren işlem (opsiyonel `account_id` trades'e; README yol haritasındaki madde).
- Fon fiyatı: elle giriş ana yol (mevcut rozet/sıfırla korunur); istenirse anahtarlı sağlayıcı adaptörü (`apps/server/prices.ts`'e tek fonksiyon, anahtar `.env`) — kaynak başına izole fonksiyon deseni korunur.

## Faz 4 — Dosya Importu (banka + Midas)

- Genel import altyapısı: dosya yükleme ucu (`POST /api/import`), önizleme-onay akışı (parse → eşleştirilmiş işlemler listesi → kullanıcı onaylar → deftere yazılır).
- Mükerrer koruması: (hesap, tarih, tutar, normalize edilmiş ad) parmak izi; `import_batches` tablosu ile geri alınabilir import.
- Parser'lar kaynak başına izole modül (prices.ts deseni gibi): önce 1-2 banka CSV/Excel formatı + Midas hesap ekstresi (Excel). Kategori önerisi: geçmiş işlemlerdeki ad→kategori eşleşmesinden basit kural tabanı.

## Faz 5 — Auth + Yayınlama (en son)

- Tek kullanıcılı basit auth: parola (env/settings), cookie session, tüm `/api` middleware ile korunur; login ekranı. (Çok kullanıcılı yapı bilinçli kapsam dışı.)
- Docker imajı pnpm monorepo'ya göre; mevcut Traefik/Tailscale notları geçerli kalır. PWA için HTTPS gereksinimi belgelenir (service worker şartı).
- README + CLAUDE.md güncellenir (yeni komutlar, yeni model).

---

## Doğrulama

- **Faz 0**: ✅ `pnpm build` temiz; 46 engine vitest testi yeşil; gerçek `data/finans.db` ile prod sunucu smoke test edildi (API verisi + derlenmiş arayüz doğrulandı).
- **Faz 1**: ✅ `pnpm build` temiz; 52 engine vitest testi yeşil (6 yeni ledger testi dahil); gerçek `data/finans.db`'nin yedeği alındıktan sonra prod sunucu ile kategori/işlem CRUD uçtan uca test edildi, eski veri (accounts/recurring/loans/trades/cards) değişmeden kaldı.
- **Faz 2**: ✅ `pnpm build` temiz (PWA precache üretimi dahil); Playwright ile masaüstü/mobil ekran görüntüsü + konsol hatası kontrolü yapıldı. Henüz yapılmadı: gerçek telefonda "ana ekrana ekle" kurulumu ve Lighthouse PWA denetimi (kullanıcının kendi cihazında denemesi gerekir).
- **Her faz sonunda**: `data/finans.db` yedeği alınmış olmalı; commit fazın sonunda tek parça.

## Sıralama

Fazlar sıralı; her faz kendi başına çalışan uygulama bırakır. Sıradaki: Faz 3 (portföy derinleştirme — fiyat geçmişi, temettü/sermaye olayları).
