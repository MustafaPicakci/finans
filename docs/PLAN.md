# Finans — Kişisel Finans Uygulamasına Evrim Planı

## Durum

- ✅ **Faz 0 tamamlandı** — pnpm monorepo iskeleti (`apps/server`, `apps/web`, `packages/engine`), finans matematiğinin `packages/engine`'e çıkarımı + 46 vitest testi, `apps/web`'in tab başına `features/` klasörlerine bölünmesi. Davranış değişikliği yok; gerçek `data/finans.db` ile doğrulandı.
- ✅ **Faz 1 tamamlandı (kapsamı daraltılmış)** — Faz 1'e başlarken kullanıcıyla "hesap bakiyesi türetilir" (orijinal plan) vs "ek defter" seçeneği tekrar değerlendirildi; kullanıcı **ek defter**i seçti: `accounts.balance` ve tüm projeksiyon/kart/kredi matematiği **hiç değişmedi**. Sadece kategorili *gerçekleşen harcama* takibi için ayrı `categories`+`transactions` tabloları ve Bütçe sekmesinde yeni bir bölüm eklendi. Aşağıdaki "Faz 1" planı bu yüzden orijinal haliyle değil, gerçekleşen (daraltılmış) haliyle güncellendi.
- ✅ **Faz 2 tamamlandı** — `vite-plugin-pwa` ile manifest + service worker (statikler precache, `/api/all` network-first), mobil ikonlar (`apps/web/public/`), mobilde alt sekme çubuğu (bottom nav) + masaüstünde üst sekmeler arası responsive geçiş (`max-width:720px`). Playwright ile hem masaüstü hem mobil görünüm görsel olarak doğrulandı (konsol hatası yok, gerçek veriyle).
- ✅ **Faz 3 tamamlandı (kapsamı daraltılmış)** — "fiyat geçmişi + portföy değer grafiği" yapıldı. Temettü/sermaye olayları ve işlem→hesap bağlantısı kullanıcıya soruldu, ikisi de **şimdilik atlandı/mevcut akış korundu** — bilinçli kapsam dışı, ihtiyaç olursa yeniden gündeme gelebilir.
- ✅ **Faz 3.5 tamamlandı (Faz 4'ten önce araya eklendi)** — Fon (TEFAS) ve yurt dışı ETF fiyatlarının otomatik çekilmesi. Bkz. aşağıdaki bölüm.
- ⬜ Faz 4–5 henüz başlamadı.

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

## Faz 3 — Portföy Derinleştirme (daraltılmış kapsam) ✅

### Fiyat geçmişi + portföy değer grafiği ✅

Yapılanlar:
- `price_history (symbol, asset_type, date, price)` tablosu (`PRIMARY KEY (symbol, asset_type, date)` — günde bir satır, aynı gün tekrar tazeleme üzerine yazar).
- `refreshAll()` (`apps/server/prices.ts`) ve elle fiyat girişi (`PUT /api/prices`, `apps/server/index.ts`) artık `prices` ile birlikte `price_history`'e de upsert yapıyor.
- `packages/engine/src/portfolio.ts`: `portfolioValueHistory(trades, priceHistory)` — sadece fiyat kaydı olan günler için, sembol başına forward-fill ile portföy değeri serisi üretir (5 vitest testi, toplam **57 test**).
- Özet sekmesine "Portföy Değeri Geçmişi" kartı: `recharts` ile alan grafiği; 2'den az veri noktası varsa "yeterli geçmiş birikince dolar" mesajı gösterilir (uydurma/geriye dönük veri yok).
- **Kapsam netliği**: bu grafik *net varlık* değil, *portföy değeri* geçmişidir — nakit bakiyesinin geçmişi hiç tutulmadığından (bkz. Faz 1 kararı) gerçek net varlık geçmişi bu veri modeliyle hesaplanamaz. README'deki mevcut not ("gerçek tarihsel değer grafiği için prices tablosuna gün gün kayıt eklemek gerekir") tam olarak bunu işaret ediyordu.

Doğrulama: `pnpm build` temiz, 57 engine testi yeşil, gerçek sunucuda elle fiyat girişi + otomatik tazeleme uçtan uca test edildi (`price_history` doğru dolduruyor), Playwright ile Özet ekranı görsel doğrulandı (boş durum mesajı doğru, konsol hatası yok).

### Kapsam dışı bırakılan alt maddeler (kullanıcı kararı)

- **Temettü + bedelli/bedelsiz sermaye artırımı**: kullanıcıya soruldu, **şimdilik atlanmasına** karar verildi (gerçek P&L matematiğini değiştiren hassas bir alan, aktif ihtiyaç yok). İstenirse yeniden gündeme gelebilir — `trades.side` enum'unu genişletmek ya da ayrı `corporate_actions` tablosu tasarım seçenekleri kalıcı not olarak duruyor.
- **İşlem → hesap bağlantısı**: kullanıcıya soruldu, **mevcut akış (elle bakiye güncelleme) bilinçli olarak korunuyor** — CLAUDE.md'deki "Hisse işlemleri hesap bakiyesini otomatik düşürmez" kararı değişmedi.
- **Fon fiyatı anahtarlı sağlayıcı**: bu oturumda araştırıldı — TEFAS'ın açık API'si F5 bot-koruması arkasında, global sağlayıcılar (TwelveData/EODHD/collectapi) Türk fon NAV'ı taşımıyor, tek anahtarlı yol RapidAPI'deki resmî olmayan bir aracı. O an kullanıcı "resmî/güvenilir" tercih ettiği için uygulanmadı — **ancak Faz 4'ten önce kullanıcı fikrini değiştirdi ve bu yol Faz 3.5'te uygulandı** (bkz. aşağı).

**Faz 3 bu haliyle kapatıldı.**

## Faz 3.5 — Fon (TEFAS) ve Yurt Dışı ETF Fiyatları ✅

Faz 4'e geçmeden önce kullanıcı fon/hisse fiyatlarının otomatik gelmemesini engel olarak gördü ve bunu çözmeyi öncelikli hale getirdi.

### Araştırma süreci
- **Headless tarayıcı (Playwright) denendi ve elendi**: TEFAS'ın F5 WAF'ı otomasyonu doğrudan reddediyor ("Request Rejected") — hem bundled Chromium hem gerçek Chrome binary'siyle, `navigator.webdriver` yaması ve gerçekçi header'larla bile. Aynı anda düz `curl` normal (JS-challenge) yanıtı alıyor — yani IP engeli değil, özellikle Playwright'ın CDP kontrol protokolünü tespit edip engelliyor. Daha ileri gitmek (CDP izlerini gizleyen "undetected" yamalar) bir güvenlik sistemini bilinçli atlatmaya kayıyordu, o noktada durup kullanıcıya bildirildi.
- **~30 alternatif kaynak denendi**: Takasbank (aynı F5 koruması), TEFAS'ın Excel/CSV dışa aktarma ucu (devre dışı), Yahoo/Google/TradingView/investing.com (Türk fonu yok veya engelli), banka/kurucu şirket API'leri (403/404), Türk finans portalları (JS ile render ediliyor). Sonuç: ücretsiz+pratik bir kaynak yok; gerçek uygulamalar ya kurumsal veri anlaşmalarıyla (banka/aracı kurum) ya da ücretli lisanslı sağlayıcılarla (Foreks/Matriks) bu veriye erişiyor.
- **Karar**: Kullanıcı RapidAPI'deki `tefas-api` (serifcolakel) aracısını kendi araştırıp uygun buldu, ücretsiz kotalı BASIC plana kaydolup anahtar aldı.

### TEFAS entegrasyonu (RapidAPI `tefas-api`)
- Playwright ile (JS render edilen) playground sayfası incelenerek endpoint şeması çıkarıldı: `/api/v1/funds/historical/{page}?fundType=1-5&startDate&endDate&size` — **tek fon kodu sorgusu yok**, fon türü başına (1: Menkul Kıymet, 2: Emeklilik, 3: Borsa, 4: Gayrimenkul, 5: Girişim Sermayesi) tüm fonların listesini (`fund_code`, `price`, `date`) döner.
- `apps/server/prices.ts`: `fetchTefasSnapshot()` — 5 fon türünü sırayla çeker (aralarında küçük bekleme), tüm fonlar için en güncel tarihli fiyatı tutan bir `Map<fund_code, price>` döner. `RAPIDAPI_KEY` yoksa boş döner (elle girişe düşer). Opsiyonel `RAPIDAPI_KEY_2`: birinci anahtar 429 (kota/hız sınırı) alırsa aynı istek ikinci anahtarla tekrar denenir, kalan tüm istekler de ikinciyle devam eder (kullanıcının önerisiyle eklendi).
- **Verimli kota kullanımı**: API zaten fon türü başına TÜM fonların listesini döndürdüğünden, `refreshAll()` sadece tuttuğumuz sembolleri değil `tefasMap`'teki **her fonu** `prices`/`price_history`'e yazar (tek transaction içinde). Aynı istek maliyetiyle veri israf edilmez; aynı gün içinde yeni bir fon eklenirse fiyatı zaten hazır bulunur. Kullanıcının önerisiyle eklendi.
- **Günde bir çekme throttle'ı**: NAV günde bir hesaplandığından ve ücretsiz kota sınırlı olduğundan, `settings.tefas_last_fetch` bugüne eşitse `fetchTefasSnapshot()` hiç çağrılmaz — tutulan her FON sembolü doğrudan `prices` tablosundan okunur (taze çekilmiş ya da önbellekten, fark etmez). Bu olmadan cron (15 dk'da bir) günde ~480 istek atardı; throttle ile günde sadece 5.
- **429 (kota/hız sınırı) ele alınışı**: birinci anahtar 429 alırsa ikinciye geçilir (varsa); ikincisi de 429 alırsa (ya da tanımlı değilse) o andaki döngüden çıkılır — sessizce `map` boş/kısmi döner, elle girilmiş fiyatlar korunur.
- **`.env` güvenliği**: `dotenv` eklendi (`apps/server/index.ts`'in en başında yüklenir), `apps/server/.env.example` (placeholder, repoya gider), `.env` `.gitignore`'a eklendi. Kullanıcının isteğiyle `.claude/settings.local.json`'a `.env` için Read/Edit/Write/Bash-cat deny kuralları eklendi — Claude gerçek anahtarı hiç görmüyor, sadece kodun `process.env.RAPIDAPI_KEY` okumasını sağlıyor.

### ETF (yurt dışı borsa) desteği
- Yeni `AssetType`: `ETF` (VOO, QQQ, VTI...) — Yahoo Finance'ten doğrudan (ek son ek gerekmez), USD→TRY çevrimi KRIPTO ile aynı desende.
- `trades.asset_type` CHECK kısıtı SQLite'ta ALTER edilemediğinden tablo güvenli şekilde yeniden oluşturuldu (id'ler + AUTOINCREMENT sırası korunarak); gerçek veride doğrulandı.

### Doğrulama
`pnpm build` temiz, 57 engine testi yeşil. Gerçek `.env` ile uçtan uca test edildi: ilk denemede 3 gerçek fon fiyatı başarıyla geldi (MAC, AFA, KHA), sonrasında test sırasında RapidAPI BASIC planın **günlük** kotası tükendi (429: "You have exceeded the DAILY quota") — bu bir kod hatası değil, aynı gün içinde çok fazla manuel test isteği atılmasından kaynaklandı. Throttle mantığı ayrıca doğrulandı: aynı gün içinde tekrar tazeleme denendiğinde API'ye hiç istek gitmeden önbellekteki fiyat döndü.

Verimli kota kullanımı (tüm fonları saklama) değişikliği `pnpm build` ile tip kontrolünden geçti ama kota tükendiği için henüz canlı doğrulanmadı. **Bekleyen**: kota sıfırlanınca (1) tüm 5 fon türünün de kotayı aşmadan tam çekilip çekilemediği, (2) `prices` tablosunda tutulanların çok ötesinde (yüzlerce) fon satırının biriktiği, (3) daha önce boş kalan TP2/PHE/TLY'nin de gelip gelmediği doğrulanacak.

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
- **Faz 3 (kısmi)**: ✅ `pnpm build` temiz; 57 engine testi yeşil (5 yeni `portfolioValueHistory` testi dahil); gerçek sunucuda elle fiyat girişi + otomatik tazeleme test edildi (`price_history` doğru yazıyor), Playwright ile Özet ekranı doğrulandı.
- **Her faz sonunda**: `data/finans.db` yedeği alınmış olmalı; commit fazın sonunda tek parça.

## Sıralama

Fazlar sıralı; her faz kendi başına çalışan uygulama bırakır. Sıradaki: Faz 4 (dosya importu — banka + Midas).
