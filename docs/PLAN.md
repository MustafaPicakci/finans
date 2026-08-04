# Finans — Kişisel Finans Uygulamasına Evrim Planı

## Durum

- ✅ **Faz 0 tamamlandı** — pnpm monorepo iskeleti (`apps/server`, `apps/web`, `packages/engine`), finans matematiğinin `packages/engine`'e çıkarımı + 46 vitest testi, `apps/web`'in tab başına `features/` klasörlerine bölünmesi. Davranış değişikliği yok; gerçek `data/finans.db` ile doğrulandı.
- ✅ **Faz 1 tamamlandı (kapsamı daraltılmış)** — Faz 1'e başlarken kullanıcıyla "hesap bakiyesi türetilir" (orijinal plan) vs "ek defter" seçeneği tekrar değerlendirildi; kullanıcı **ek defter**i seçti: `accounts.balance` ve tüm projeksiyon/kart/kredi matematiği **hiç değişmedi**. Sadece kategorili *gerçekleşen harcama* takibi için ayrı `categories`+`transactions` tabloları ve Bütçe sekmesinde yeni bir bölüm eklendi. Aşağıdaki "Faz 1" planı bu yüzden orijinal haliyle değil, gerçekleşen (daraltılmış) haliyle güncellendi.
- ✅ **Faz 2 tamamlandı** — `vite-plugin-pwa` ile manifest + service worker (statikler precache, `/api/all` network-first), mobil ikonlar (`apps/web/public/`), mobilde alt sekme çubuğu (bottom nav) + masaüstünde üst sekmeler arası responsive geçiş (`max-width:720px`). Playwright ile hem masaüstü hem mobil görünüm görsel olarak doğrulandı (konsol hatası yok, gerçek veriyle).
- ✅ **Faz 3 tamamlandı (kapsamı daraltılmış)** — "fiyat geçmişi + portföy değer grafiği" yapıldı. Temettü/sermaye olayları ve işlem→hesap bağlantısı kullanıcıya soruldu, ikisi de **şimdilik atlandı/mevcut akış korundu** — bilinçli kapsam dışı, ihtiyaç olursa yeniden gündeme gelebilir.
- ✅ **Faz 3.5 tamamlandı ve tam canlı doğrulandı (Faz 4'ten önce araya eklendi)** — Fon (TEFAS) ve yurt dışı ETF fiyatlarının otomatik çekilmesi. Bkz. aşağıdaki bölüm.
- ✅ **Faz 4 tamamlandı (kapsamı değişti)** — banka/Midas dosya importu **şimdilik gerekli görülmedi** (kullanıcı kararı, dosya importu fikri terk edilmedi, sadece kapsam dışı — istenirse ayrı bir faz olarak yeniden gündeme gelebilir), yerine **raporlama/analiz sekmesi** yapıldı: aylık gelir/gider trendi + kategori dağılımı. Bkz. aşağıdaki Faz 4 bölümü.
- ✅ **Faz 4.5 tamamlandı** — tüm ekranların tasarım/UX yenilemesi: "temiz neobank" yönü (açık tema varsayılan, indigo marka vurgusu, nötr gri/beyaz yüzeyler), claude Artifact ile önce mockup onaylatıldı, sonra `apps/web`'in tamamına uygulandı + açık/koyu tema geçişi eklendi. Bkz. aşağıdaki Faz 4.5 bölümü.
- ✅ **Faz 4.6 tamamlandı** — bilgi mimarisi yeniden dizimi + global "+ Ekle" akışı: Bütçe/Borçlar sekmeleri kaldırılıp **Plan** (projeksiyonu besleyenler) ve **Harcamalar** (gerçekleşen defter) sekmeleri kuruldu; tüm işlem girişleri tek "+ Ekle" modal akışına toplandı. Bkz. aşağıdaki Faz 4.6 bölümü.
- ✅ **Faz 4.7 tamamlandı** — gerçekleşen işlem artık hesap bakiyesini etkiliyor: Harcamalar sekmesi de kaldırıldı (Rapor'a birleşti), tek gelir/gider formu tarihe göre defter/plan'a yönleniyor, hesaba bağlı işlem bakiyeyi atomik oynatıyor, Plan kalemleri "Gerçekleşti" ile deftere geçiyor. Faz 1'in "bakiye defterden bağımsız" kararının yerini aldı. Bkz. aşağıdaki Faz 4.7 bölümü.
- ✅ **Faz 4.8 tamamlandı** — çok para birimi (TRY + USD): portföy işlemleri döviz cinsinden girilebilir (kripto/ABD hisse/ETF USD), pozisyonlar native hesaplanır, üstte ₺/$ görüntü seçici net varlık özetini/KPI'ları çevirir. Bkz. aşağıdaki Faz 4.8 bölümü.
- ✅ **Faz 4.9 tamamlandı** — para piyasası fonları nakit gibi değerlenir: Nakit Akışı takvimi gün rengini artık **etkin nakit (nakit + para piyasası fonu)** ile belirler, güne tıklayınca nakit/PPF/diğer portföy kırılımı + gün içi hareketler açılır; fonlar Portföy sekmesinde "nakit say" ile opt-in işaretlenir. Bkz. aşağıdaki Faz 4.9 bölümü.
- ✅ **Faz 5 tamamlandı (SaaS dönüşümü, Temmuz 2026)** — kendi auth'umuz + düz Postgres (taşınabilirlik öncelikli, Supabase Auth bilinçli elendi), `user_id` ile çok-kiracılık, global fiyat tazeleme, KVKK, yayınlama (5.0–5.5 ✅). Billing yok. Bkz. aşağıdaki Faz 5 bölümü.
- ✅ **Faz 6–9 tamamlandı (Temmuz 2026)** — yayın sonrası ürün derinleşmesi: portföy işlemini nakit hesaba bağlama + şifre sıfırlama/aktivasyon e-postaları (6), vadeli mevduat + Hesaplar sekmesi (7), düzenli kalem & kart ekstresi gerçekleştirme (8), düzenli kalem tutar zaman çizelgesi (9). Araya iki UI işi girdi: Nakit Haritası (likit nakit + runway) ve kenar çubuğu kabuğu + gizlilik modu.
- ✅ **Faz 10–13 tamamlandı (Temmuz–Ağustos 2026)** — çok-kullanıcı onboarding (10) + giriş sürtünmesini azaltma (10.1) + toplu içe aktarma (10.2), portföy grupları (11), hareket geçmişi (12), değer grafiği aralıkları (13). Bkz. aşağıdaki bölümler.
- ✅ **Faz 14 tamamlandı (Ağustos 2026)** — işlem kayıtlarının düzenlenmesi (gerçekleşen gelir/gider, plan kalemi, kart harcaması, portföy işlemi); bakiye etkisi atomik olarak düzeltilir.
- ✅ **Faz 15 tamamlandı (Ağustos 2026)** — hesap hareket defteri (`account_entries`): bakiyeyi oynatan her şey iz bırakır, `balance = Σ hareketler` değişmez kuralı, Hesaplar sekmesinde yürüyen bakiyeli hareket listesi.
- ✅ **Faz 16 tamamlandı (Ağustos 2026)** — virman (`transfers`) + hesap türleri (banka/nakit/aracı/fon) + mutabakat: kendi hesapların arası para hareketi tek kayıtta iki bacak yazar, nakit ve aracı kurum da hesap olduğundan para sistemden çıkmaz, "Doğrula" ile gerçek bakiye deftere sabitlenir.
- ⏳ **Açık iş (prod engelleyici): e-posta teslim edilebilirliği** — çok-kullanıcı kayıt açık ama prod'da SMTP = Gmail, aktivasyon postaları kurumsal alan adlarına ulaşmıyor (phishing sayılıp düşüyor). Gerçek kullanıcı almadan önce transactional sağlayıcı + kendi domain (SPF/DKIM/DMARC) şart; kod değişmiyor, yalnız env. Bkz. Faz 10 bölümü.

## Context (Neden)

Başlangıç durumu: tek süreçli Hono + SQLite API, tek dosyalık React arayüz (`src/App.tsx`, ~1000 satır), projeksiyon-odaklı model (hesap bakiyeleri elle güncellenir, `recurring`/`loans`/`oneoffs`/`card_txs` gelecek nakit akışını üretir). Portföy `trades` defteriyle zaten ledger mantığında.

Hedef vizyon (kullanıcının tarifi): tüm yatırımlar + bütçe/nakit akışını ilgilendiren her gelir-gider tek uygulamada; arayüzden takip; sonunda web + mobil uygulama; auth en sonda. (Banka/Midas ekstre importu ilk vizyonun parçasıydı; Faz 4 planlamasında kullanıcı bunun şimdilik gerekli olmadığına karar verdi — bkz. Faz 4.)

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

### TEFAS entegrasyonu (RapidAPI `tefas-api`) — tasarım evrimi
Playwright ile (JS render edilen) playground sayfası incelenerek API şeması çıkarıldı. Üç iterasyon geçirdi, her biri canlı veriyle ortaya çıkan yanlış varsayımı düzeltti:

1. **İlk deneme — `funds/historical/{page}` (tarih aralığı, sayfalı), "hepsini çek"**: `fontip` filtresi yok, fon türü başına (1-5) tüm listeyi dönüyor sanıldı; "API zaten hepsini döndürüyor, tutulanları değil hepsini saklayalım" denendi (kullanıcı önerisiyle). Gerçekte tek bir tür (Menkul Kıymet) tek başına **8500+ satır / 35 sayfa** çıktı — çünkü `historical` uç noktası tarih **aralığındaki her gün için ayrı satır** dönüyormuş. İki RapidAPI anahtarı da ilk türü bitiremeden tükendi.
2. **İkinci deneme — aynı uç, erken çıkış**: `fetchTefasSnapshot(neededCodes)` aranan fon kodlarının (tutulan FON sembolleri) tamamını bulduğu an taramayı durduracak şekilde değiştirildi. Doğru yönde ama hâlâ "büyük samanlıkta iğne arama" — API'nin sayfa sırası bilinmediğinden kaç istekte bulunacağı garantisizdi.
3. **Nihai tasarım — `funds/returns-by-date` (tek gün)**: Bu uç `lastBusinessDay=true` ile hafta sonu/tatili otomatik son iş gününe çevirir ve **TÜM 5 fon türünü TEK istekte**, gruplu olarak döner (`data: [{fund_type, funds: [{fund_code, price, date}]}]`). Tek günlük sorguda toplam fon sayısı makul (~150-160) — `historical`'ın "her gün ayrı satır" sorunu yok. `apps/server/prices.ts`: `fetchTefasSnapshot(neededCodes)` artık tek bir `returns-by-date` isteği atıyor (gerekirse ikinci anahtarla 429'da tekrar).

- **Günde bir çekme throttle'ı**: NAV günde bir hesaplandığından ve ücretsiz kota sınırlı olduğundan, `settings.tefas_last_fetch` bugüne eşitse `fetchTefasSnapshot()` hiç çağrılmaz.
- **Dürüst başarısızlık raporlama**: Canlı testte önemli bir hata bulundu — `fetchTefasSnapshot()` o gün gerçekten denenip başarısız olduğunda (iki anahtar da 429), kod `prices` tablosundaki **bir önceki günden kalma bayat fiyatı** "başarılı" (`ok:true`) olarak gösteriyordu (MAC/AFA/KHA dünkü fiyatla birebir aynı döndü, hiçbir şey tazelenmemişti). Düzeltildi: `tefasAttemptFailed` bayrağıyla, o gün gerçekten denenip başarısız olan FON'lar diğer varlık türleriyle tutarlı şekilde `ok:false` döner — bayat veriyi başarı gibi göstermez. "Bugün zaten başarıyla çekildi, tekrar denemeye gerek yok" (throttle) durumu bundan ayrı tutulur, o zaman `ok:true` doğru.
- **429 (kota/hız sınırı) ele alınışı**: birinci anahtar 429 alırsa (varsa) ikinciyle tekrar denenir; ikincisi de başarısız olursa `tefasAttemptFailed` devreye girer.
- **`.env` güvenliği**: `dotenv` eklendi (`apps/server/index.ts`'in en başında yüklenir), `apps/server/.env.example` (placeholder, repoya gider) `RAPIDAPI_KEY`+`RAPIDAPI_KEY_2` alanlarını belgeler, `.env` `.gitignore`'a eklendi. Kullanıcının isteğiyle `.claude/settings.local.json`'a `.env` için Read/Edit/Write/Bash-cat deny kuralları eklendi — Claude gerçek anahtarı hiç görmüyor.

### ETF (yurt dışı borsa) desteği
- Yeni `AssetType`: `ETF` (VOO, QQQ, VTI...) — Yahoo Finance'ten doğrudan (ek son ek gerekmez), USD→TRY çevrimi KRIPTO ile aynı desende.
- `trades.asset_type` CHECK kısıtı SQLite'ta ALTER edilemediğinden tablo güvenli şekilde yeniden oluşturuldu (id'ler + AUTOINCREMENT sırası korunarak); gerçek veride doğrulandı.

### Doğrulama
`pnpm build` temiz, 57 engine testi yeşil. Kota sıfırlandıktan sonra `returns-by-date` tasarımı gerçek veride **tam** doğrulandı:
- **Tek istekte 3489 fon fiyatı** toplandı (`prices` + aynı gün `price_history`'de tam senkron) — tahmin edilenin (~150-160) çok üzerinde, TEFAS'ta pay sınıfı/alt kategori dahil gerçekten binlerce fon var.
- **Tutulan 6 fonun hepsi geldi**: MAC/AFA/KHA (daha önce de gelmişti) + **TP2/PHE/TLY (daha önce hiç gelmeyen 3 fon, artık geliyor)**.
- Fiyatlar önceki günden farklı (gerçekten taze çekildiği, bayat önbellek olmadığı doğrulandı — dürüst-hata-raporlama düzeltmesinin de dolaylı kanıtı).

Faz 3.5 bu haliyle tamamen kapatıldı.

## Faz 4 — Raporlama/Analiz Sekmesi ✅

Faz 4 başlangıçta banka/Midas dosya importu olarak planlanmıştı; kullanıcı bunun şimdilik gerekli olmadığına karar verdi (dosya importu fikri terk edilmedi, sadece kapsam dışı — istenirse ayrı bir faz olarak yeniden gündeme gelebilir). Yerine, Faz 1'de eklenen kategorili `transactions` defterini analiz eden yeni bir sekme yapıldı.

Kapsam (kullanıcı önceliği): **aylık gelir/gider trendi + kategori dağılımı**. Kapsam dışı bırakılan alternatif — recurring (planlanan) vs transactions (gerçekleşen) karşılaştırması — kullanıcıya soruldu, seçilmedi; istenirse sonraki bir iyileştirme olarak eklenebilir.

Yapılanlar:
- `packages/engine/src/date.ts`: `monthsBack(n, from?)` — verilen aydan geriye `n` ayı eskiden yeniye sıralı üretir (3 yeni vitest testi).
- `packages/engine/src/ledger.ts`: `monthlyTotals(transactions, months)` — verilen ay listesi için gelir/gider/net toplamları; işlemi olmayan aylar 0 döner (3 yeni vitest testi). Kategori kırılımı için mevcut `categoryTotals` doğrudan yeniden kullanıldı, ayrı bir `categoryTrend` fonksiyonu gerekmedi. Toplam **63 engine testi**.
- Backend'de yeni uç açılmadı — `transactions`/`categories` zaten `GET /api/all` ile geliyor, hesaplama tamamen `packages/engine`'de.
- `apps/web/src/theme.ts`: `CATEGORY_PALETTE` — kategoriler için sabit sıralı (id bazlı, ay filtresi değişince kaymayan) 8 renkli kategorik palet; `dataviz` beceri kılavuzuyla koyu tema yüzeyine (`T.panel`) karşı doğrulandı (`validate_palette.js` — lightness/chroma/CVD/contrast tüm kontroller geçti).
- `apps/web/src/features/rapor/index.tsx` (yeni `Rapor` bileşeni, yeni "Rapor" sekmesi — üst sekmeler + mobil alt nav): (1) aylık gelir/gider/net grafiği — gruplu bar (gelir yeşil `T.pos`, gider kırmızı `T.neg`, mevcut Money/ReferenceLine renk kuralıyla tutarlı) + net çizgisi (`T.acc`), 3/6/12/24 aylık aralık seçici; (2) seçili ay için kategori dağılımı — sadece **gider** kategorileri pasta grafiğinde (gelir+gider'i aynı pastada karıştırmak yanıltıcı olacağından ayrıştırıldı), gelir kaynakları ayrı bir liste olarak altında; her ikisi de veri yoksa (Faz 3'teki portföy grafiği kartıyla aynı dürüstlük ilkesiyle) "veri birikince görünecek" boş durumu gösterir.

Doğrulama: `pnpm build` temiz; 63 engine testi yeşil (6 yeni: 3 `monthsBack` + 3 `monthlyTotals`); gerçek `data/finans.db` üzerinde prod dev sunucusuyla uçtan uca test edildi — geçici test kategorileri/işlemleri eklenip (trend grafiği ve pasta grafiği gerçek veriyle görsel olarak Playwright'la doğrulandı, tam donut/bar render'ı teyit edildi) sonra API üzerinden silindi, `GET /api/all` ile 0 transaction/0 category'e döndüğü, yani eski verinin bozulmadığı doğrulandı. Konsol hatası yok.

## Faz 4.5 — Tasarım/UI Yenileme (Faz 5'ten önce araya eklendi) ✅

Kullanıcı mevcut ekranların tasarım ve kullanıcı deneyiminden memnun değildi ("ekranlar korkunç durumda"). Faz 4 bittikten sonra ekran yapısı stabildi; auth'tan (Faz 5) önce cilalanarak hem mevcut 7 sekme hem de Faz 5'te gelecek login/ayarlar ekranlarının doğrudan yeni tasarım diliyle inşa edilmesi hedeflendi (iki kez tasarlama önlendi). Tasarım backend mimarisinden bağımsız kaldı — SaaS kararı ayrı ve sonraya bırakıldı (bkz. Context notu).

Mevcut durum tespiti (Playwright ekran görüntüleriyle): koyu lacivert (`#0D1322`) + amber fintech teması yetkindi ama sorunluydu — zayıf görsel hiyerarşi, net varlık kırılımının sağ üstte minik gri metne sıkışması, kullanılmayan amber vurgu, sıkışık spacing, belirsiz tipografi hiyerarşisi.

**Süreç**: Önce claude Artifact ile bağımsız bir HTML mockup'ı (Özet ekranı + form kartı, açık/koyu tema, gerçek veriyle) hazırlanıp kullanıcı onayına sunuldu; üç iterasyon geçirdi:
1. İlk yön seçimi (4 seçenekli önizleme) → kullanıcı **"temiz neobank, açık-öncelikli, ferah"** yönünü seçti (rafine koyu fintech ve premium private-banking seçeneklerine karşı).
2. İlk mockup teal marka rengiyle yapıldı; kullanıcı "yeşili sevmedim" dedi. Kök neden: marka rengi (teal) + kazanç göstergesi (yeşil) + donut'taki FON rengi hepsi aynı hue ailesindeydi, ekran tek notaya düşüyordu. Kullanıcı **indigo**yu seçti (kobalt mavi ve amber alternatiflerine karşı) — kazanç yeşili/kayıp kırmızısı semantik olarak korunarak marka rengi bunlardan tamamen ayrıştırıldı.
3. İndigo'ya geçince kullanıcı koyu temada kart içlerinin hâlâ koyu yeşil kaldığını fark etti — kök neden: nötr tonlar (kart/zemin/çizgi) başta teal'e bias'lı seçilmişti, marka değişince güncellenmemişti. Nötrler indigo-bias'lı gerçek gri tonlarına çevrildi (`ground/surface/surface-2/ink/line`), kazanç/kayıp renklerine dokunulmadı.

**Uygulama** (`apps/web/src/`):
- `theme.ts` tamamen yeniden yazıldı: renkler artık JS hex sabiti değil, `themeCSS` içinde tanımlı **CSS custom property**'ler (`--ground`, `--surface`, `--ink`, `--brand`, `--pos`, `--neg`, `--type-*`, `--cat-*`...) — `T`/`TYPE_COLORS`/`CATEGORY_PALETTE` bunlara `var(--x)` string'leriyle işaret eder. Üç katman: `:root` (varsayılan = açık tema), `@media (prefers-color-scheme: dark)`, `:root[data-theme="light"|"dark"]` (manuel toggle override eder). Bu sayede `T.pos`/`T.acc` vb. kullanan **tüm mevcut bileşen kodu değişmeden** tema-duyarlı hale geldi (`ui/index.tsx` hiç dokunulmadı).
- Kategori paleti (8 renk) ve varlık türü renkleri (7 tür) `dataviz` beceri kılavuzuyla hem açık hem koyu yüzeye karşı yeniden doğrulandı (`validate_palette.js` — lightness/chroma/CVD/contrast) ve dataviz'in referans kategorik paletinden (blue/aqua/yellow/green/violet/red/magenta/orange) sabit kimlik ataması yapıldı (Nakit→mavi, FON→yeşil, BIST→turuncu, ALTIN→sarı/altın, DOVIZ→mor, KRIPTO→pembe, ETF→aqua; kırmızı sadece kayıp semantiği için ayrıldı, kimlik rengi olarak kullanılmadı).
- `App.tsx`: kabuk yeniden kuruldu — ince sticky üst bar (logo + sekmeler + tema toggle) ayrıştırıldı; büyük "Net Varlık" hero + 3 KPI kartı (Nakit/Portföy/Kart Borcu, her biri gerçek veriyle: hesap sayısı, varlık türleri, bekleyen ekstre sayısı — **uydurma yüzde/delta yok**, çünkü net varlık geçmişi tutulmuyor). Tema durumu `useState` + `localStorage` (`finans-theme`) ile kalıcı, `data-theme` attribute `<html>`'e yazılır; varsayılan **açık tema**.
- `index.html`: `theme-color` ve önyükleme arka planı açık temaya (`#F5F5FA`) çevrildi (koyu flaş önlendi).
- 5 sabit (tema-bağımsız) hex kodu token'a bağlandı: `nakit` (aktif ay çipi metni, eksi-bakiye gün arka planı), `portfoy` (ALIŞ/SATIŞ toggle metni, işlem geçmişi pilleri), `ozet` (en-düşük-gün çipi arka planı).
- Diğer tüm ekranlar (Bütçe, Borçlar, Kartlar, Rapor) hiç değişmeden, sadece `css.card`/`css.input`/`css.btn`/`T.*` token dolaylılığı sayesinde otomatik olarak yeni tasarımı aldı.

Doğrulama: `pnpm build` temiz, 63 engine testi yeşil (değişmedi — bu tamamen sunum katmanı). Gerçek `data/finans.db` ile prod dev sunucusunda Playwright ile hem açık hem koyu temada tüm sekmeler (Özet, Nakit takvim, Bütçe form, Portföy pozisyonlar, Rapor) + mobil görünüm (390px) ekran görüntüsüyle doğrulandı; konsol hatası yok. Varlık türü renkleri (`FON`/`ALTIN`/`BIST`) `getComputedStyle` ile pixel-doğru teyit edildi (küçük rozetlerde göz yanıltabiliyor, computed style güvenilir referans).

### Veri girişi formlarının kullanılabilirlik yenilemesi (Faz 4.5'e ek, aynı oturumda) ✅

Tasarım yenilemesinden sonra kullanıcı veri girişi formlarının ("Ekle" formları — Bütçe/Borçlar/Kartlar/Portföy) hâlâ kullanıcı dostu olmadığını belirtti. İnceleme sırasında tasarımdan bağımsız **gerçek bir bug** bulundu ve düzeltildi:

- **`num()` binlik ayracı bug'ı** (`packages/engine/src/date.ts`): eski hâli virgülü noktaya çeviriyordu ama Türkçe binlik ayracı olan noktayı hesaba katmıyordu — "1.234,56" girişi sessizce **1234** (ondalık ve ~1000x büyüklük kaybıyla) olarak okunuyordu. Yeni ayrıştırıcı, noktayı yalnızca tam 3 haneli bir grubun hemen ardından bir rakam-olmayan karakter/son geldiğinde binlik ayracı sayıp siliyor (düz ondalık "1234.56" girişini bozmadan); virgül her zaman ondalık ayracı. 4 yeni vitest testi. Gerçek formda uçtan uca doğrulandı: "1.234,56" girişi API'de `-1234.56` olarak kaydedildi (önce bug'lı haliyle test edilip düzeltmenin gerçekten fark yarattığı teyit edildi).
- **Canlı tutar önizlemesi**: yeni `AmountField` bileşeni (`apps/web/src/ui/index.tsx`) her tutar girişinin altında anında "₺1.234,56" formatında ayrıştırılmış değeri gösterir — yanlış yorumlama sessizce geçmez, kullanıcı anında görür. Bütçe/Borçlar/Kartlar/Portföy'deki 10 tutar alanına uygulandı (miktar/adet gibi para olmayan sayısal alanlar hariç).
- **Native ay seçiciler**: Bütçe'deki düzenli gelir/gider formunun `from_month`/`to_month` alanları ve "Değiştir" mini-formunun ay alanı, serbest metin ("YYYY-AA yaz") yerine `<input type="month">` oldu — uygulamanın başka yerinde (Rapor, Gerçekleşen Harcamalar) zaten kullanılan desenle tutarlı. `normYm` tabanlı format-hata mesajı ve doğrulaması gereksizleşip kaldırıldı (native input her zaman doğru biçimde ya da boş döner) — engine'de `normYm` hâlâ export/test edilir durumda kalıyor, sadece UI'da kullanılmıyor.
- **Enter ile gönderme + odak akışı**: her "Ekle" formu gerçek bir `<form onSubmit>` içine alındı (buton `type="submit"`); bir kayıt eklendikten sonra odak otomatik olarak ilk alana (genelde "Ad") döner — art arda çok sayıda işlem/harcama girerken fareye dönmeye gerek kalmaz. Portföy'ün ALIŞ/SATIŞ toggle butonlarına `type="button"` eklendi (form içine girince yanlışlıkla erken submit olmasınlar diye).
- **Devre dışı buton yerine neden mesajı**: yeni `Hint` bileşeni; her formda spesifik eksik/geçersiz alanı söyleyen bir metin (örn. "Tutar 0'dan büyük olmalı", "Kart seçilmeli") artık devre dışı "Ekle" butonunun altında görünür.
- **Küçük sürtünme düzeltmesi**: Kartlar'da tek kart varsa "Kart Harcaması Ekle" formunun kart seçici otomatik o kartı seçer (birden fazla kartta "Seç…" olarak kalır).

Doğrulama: `pnpm build` temiz, 67 engine testi yeşil (4 yeni `num()` testi dahil). Gerçek `data/finans.db` üzerinde Playwright ile uçtan uca test edildi: Türkçe biçimli tutar girişi → canlı önizleme doğru → Enter ile gönderildi → odağın ilk alana döndüğü + API'de doğru ayrıştırılmış tutarla kaydedildiği doğrulandı → test kaydı silinip eski veri korunarak temizlendi. Tüm formlarda hint mesajları ve native ay seçiciler görsel olarak teyit edildi, konsol hatası yok.

### Net varlığa kredi borcu dahil edildi (Faz 4.5'e ek, aynı oturumda) ✅

Kullanıcı "neden ekstradan Borçlar sekmemiz var" diye sorunca ortaya çıktı: yeni hero/KPI tasarımı (ve öncesindeki eski üst özet de) net varlığı yalnızca `nakit + portföy − kart borcu` olarak hesaplıyordu, kredi/taksit borcunu (Borçlar sekmesi) hiç düşmüyordu — `CLAUDE.md`'de de böyle belgeliydi. Kullanıcı bunun bilinçli bir kapsam daralması değil, düzeltilmesi gereken bir eksiklik olduğuna karar verdi.

- `App.tsx`: `loanRemaining` ile hesaplanan toplam kalan kredi borcu (`Σ loan.amount × loanRemaining(loan, bugün)`) artık net varlıktan düşülüyor: `netWorth = cash + portValue − cardDebt − loanDebt`.
- Hero'ya 4. bir KPI kartı eklendi: **Kredi Borcu** (aktif kredi sayısı alt bilgiyle) — `.kpis` grid'i masaüstünde 4, mobilde 2×2 sütuna güncellendi.
- `CLAUDE.md` ve `README.md`'deki net varlık tanımları güncellendi (artık kredi borcunu da içeriyor).

Doğrulama: `pnpm build` temiz, 67 engine testi değişmeden yeşil (formül değişikliği sadece `App.tsx`'te, engine dokunulmadı). Gerçek veride (1 aktif kredi, kalan ₺11.298) net varlığın ₺145.547'den ₺134.249'a doğru düştüğü API + ekran görüntüsüyle doğrulandı; masaüstü (4 sütun) ve mobil (2×2) düzenler Playwright'la kontrol edildi, konsol hatası yok.

## Faz 4.6 — Bilgi Mimarisi Yeniden Dizimi + Global "+ Ekle" Akışı ✅

Kullanıcı şikayeti: "gider girişi kontrolden çıkmış" — Bütçe ekranı 5 farklı işi (hesap tanımı, düzenli gelir/gider, tek seferlik, gerçekleşen harcama, kategori) üst üste yığıyordu; ayrıca Borçlar ve Kartlar'da da ayrı gider girişleri vardı. Kök neden: uygulamanın iki dünyası (plan/projeksiyon vs gerçekleşen defter) ekran organizasyonunda hiç görünmüyordu. Kullanıcıya üç seçenek sunuldu (yalnız IA yeniden dizimi / yalnız tek "+" akışı / ikisi birden) — **ikisi birden** seçildi.

**1. Sekme yeniden dizimi (iki dünyaya göre):**
- **Plan** (yeni): düzenli gelir/giderler + tek seferlik kalemler + krediler — nakit projeksiyonunu besleyen her şey tek yerde. Borçlar sekmesi kaldırıldı (krediler buraya taşındı), `features/borc` silindi.
- **Harcamalar** (yeni): gerçekleşen defter + kategori yönetimi (Bütçe'deki `GercekHarcamalar`'ın büyütülmüş hali). Bütçe sekmesi kaldırıldı, `features/butce` silindi.
- **Hesaplar** Özet'e taşındı (bakiye güncelleme + hesap tanımı — dashboard'un en altında).
- Yeni sekme dizisi: Özet · Nakit Akışı · Plan · Harcamalar · Kartlar · Portföy · Rapor.

**2. Global "+ Ekle" akışı (tüm işlem girişlerinin tek kapısı):**
- `AddSheet.tsx`: masaüstünde üst barda "+ Ekle" butonu, mobilde FAB (alt navigasyonun üstünde). Açılınca 6 seçenekli liste; **her seçeneğin altında kaydın hangi dünyaya yazıldığı yazar** ("nakit projeksiyonunu etkilemez" / "nakit akışına girer" / "ekstreye işlenir"...) — kullanıcının "farkı ne, neden 4 yerden gider giriyorum" karışıklığının UI'daki kalıcı cevabı. Kart yoksa "Kart harcaması" seçeneği devre dışı + "önce kart tanımla" notu.
- `features/forms/index.tsx`: 6 form bileşeni (`TransactionForm`, `CardTxForm`, `RecurringForm`, `OneoffForm`, `LoanForm`, `TradeForm`) — Faz 4.5'in form iyileştirmeleri (AmountField canlı önizleme, Hint, Enter-submit) korunarak modal'a taşındı. Her formda "Kaydet" (kapatır) + "Kaydet, yeni ekle" (formu sıfırlar, odak ilk alana — art arda giriş; tarih/tür/kategori korunur).
- `ui/`'ye `Modal` bileşeni eklendi (Escape/overlay kapatır).
- Sekmelerdeki işlem giriş formları kaldırıldı; sekmelerde yalnızca **tanım** formları kaldı (hesap→Özet, kategori→Harcamalar, kart→Kartlar). Bölüm başlıklarındaki "+ Ekle" kısayolları global akışın ilgili formunu seçim adımını atlayarak doğrudan açar (`onAdd(kind)` prop'u).
- Kartlar'daki tek-kart-otomatik-seçim davranışı `CardTxForm`'a taşındı; Rapor/Özet'teki "Bütçe sekmesinden..." boş-durum metinleri yeni sekme adlarına güncellendi.

CLAUDE.md frontend bölümü yeni yapıya göre güncellendi (AddSheet + forms + yeni features listesi + "sekmelerde işlem girişi formu yoktur" kuralı).

Doğrulama: `pnpm build` temiz, 67 engine testi değişmeden yeşil (yalnız sunum katmanı). Gerçek `data/finans.db` ile Playwright uçtan uca: yeni sekmeler render (Plan/Harcamalar ekran görüntüleri), "+ Ekle" → seçim listesi → TransactionForm → Türkçe biçimli tutar ("2.500,75") → Kaydet → modal kapandı + kayıt listede + API'de `-2500.75` doğru ayrıştırılmış → test kaydı silindi (0 transaction'a dönüldü). Plan'daki bölüm "+ Ekle"sinin doğru formu direkt açtığı, mobilde FAB+alt nav düzeni doğrulandı; konsol hatası yok.

## Faz 4.7 — Gerçekleşen İşlem Hesap Bakiyesini Etkiliyor + Tek Kalem Formu ✅

Kullanıcı sordu: "bir harcama girdiysem neden toplam bakiyemiz azalmıyor?" — Faz 1'de bilinçle seçilen "defter bakiyeden bağımsız" kararı, uygulama gerçekten kullanılırken beklentiyle çelişti. Kullanıcı **tüm gelir/gider girişinin sahip olduğuna göre bakiyeyi etkilemesini** ve Harcamalar sekmesinin kaldırılıp girişlerin tek yerden yapılmasını istedi.

**Bakiye etkisi (backend, `apps/server/index.ts`):**
- `transactions` jenerik `crud()`'dan çıkarıldı, elle POST/DELETE yazıldı: `account_id` doluysa INSERT hesabın bakiyesini `amount` kadar oynatır (gider işaretli −, gelir +), DELETE geri alır. İkisi de `BEGIN/COMMIT` ile atomik (bakiye ile kayıt hiç ayrık kalmaz). PUT yok — düzenleme = sil + yeniden ekle (bakiye tersinirliği böyle basit kalır). `account_id` boşsa eski davranış: sadece Rapor'a girer, bakiyeye dokunmaz.

**Tek "Gelir / Gider kalemi" formu (`features/forms` → `KalemForm`):**
- `TransactionForm` + `OneoffForm` tek forma birleşti; **tarihe göre otomatik yönlenir**: bugün/geçmiş → `transactions` (gerçekleşen; Hesap + Kategori seçicili, bakiyeye işler), ileri tarih → `oneoffs` (plan; Hesap/Kategori gizlenir, projeksiyona girer). Form altında canlı açıklama hangi yola gittiğini söyler. Hesap seçici varsayılan ilk hesap; "— (bakiyeye işleme)" ile atlanabilir.
- AddSheet seçenekleri 6→5'e indi (tek seferlik ayrı seçenek değil artık); açıklamalar "bakiyeye işler / projeksiyona girer" diline güncellendi.

**Plan'da "Gerçekleşti" akışı:**
- Tek seferlik kalemin yanına **Gerçekleşti** butonu (günü gelmiş kalemler `· günü geldi` + vurgulu). Tıklayınca `KalemForm` ad/tutar/tür önden dolu açılır (`KalemPrefill`); kaydedilince kayıt deftere geçer, bakiyeye işler ve orijinal `oneoff` silinir (`prefill.oneoffId`). Plan→gerçekleşen geçişi tek tık.

**IA sadeleşmesi:**
- Harcamalar sekmesi kaldırıldı (`features/harcamalar` silindi); içeriği (işlem listesi + kategori yönetimi) Rapor'a taşındı — Rapor artık defterin tam görünümü. Sekme dizisi: Özet · Nakit Akışı · Plan · Kartlar · Portföy · Rapor. Rapor'daki işlem satırları bağlı hesabı da gösterir.

CLAUDE.md güncellendi: `transactions`'ın özel (crud dışı, bakiye yan etkili) uç olduğu, `KalemForm` tarih-yönlendirmesi, "gerçekleşen işlem bakiyeyi oynatır (trades hariç, o elle kalır)" veri modeli notu.

Doğrulama: `pnpm build` temiz, 67 engine testi değişmeden yeşil (mantık backend'de + UI'da, engine dokunulmadı). `data/finans.db` yedeği alındı. API testi: hesaba bağlı −1000 gider → bakiye 5467→4467, sil → 5467 (atomik geri alma), hesapsız gider → bakiye değişmez. Playwright: "+ Ekle"de 5 seçenek + yeni açıklamalar, kalem formu bugün→Hesap/Kategori görünür & "bakiyeye işler" notu / ileri tarih→gizli & "plan kalemi" notu; Plan'da "Gerçekleşti" → prefill modal → kaydet → oneoff silindi + `account_id`'li işlem oluştu + bakiye 5467→3967, test kaydı silinince 5467'ye döndü. Tüm test kayıtları temizlendi (0 kalıntı), konsol hatası yok.

## Faz 4.8 — Çok Para Birimi (TRY + USD) ✅

Kullanıcı kripto, ABD hisseleri ve ETF gibi varlıkları **döviz cinsinden** girmek ve ekranda para birimi seçip seçili birimde görmek istedi. Sorun: sistem tamamen TRY-normalize idi (KRIPTO/ETF fiyatı saklanmadan önce `×usdTry` ile TRY'ye çevriliyordu), bu yüzden bir ABD varlığının gerçek USD maliyeti/getirisi kayboluyordu.

Onaylanan kapsam (kullanıcı, 3 soruyla): **TRY + USD**; görüntü seçici **net varlık özeti + KPI'ları** çevirir (detay ekranları TRY kalır); **sadece portföy işlemleri** para birimi alır (hesaplar TRY kalır). Temel ilke: **TRY taban (canonical) para birimi**; pozisyonlar native tutulur, net varlığa toplanırken TRY'ye çevrilir; görüntü birimi saf sunum katmanı.

**Veri modeli** (`db.ts` migrasyonları, hepsi `DEFAULT 'TRY'` → eski satırlar birebir korunur; portföyde USD varlık yoktu):
- `trades.currency`, `prices.currency`, `price_history.currency` (TRY/USD). Migrasyon ETF tablo-yeniden-kurmasından **sonra** çalışır (yeniden kurulan trades de kolonu alsın).
- FX kuru: ayrı tablo değil, `settings.fx_usd_try` (`refreshAll` her tazelemede yazar — portföy boş olsa bile).

**Engine** (`types.ts`, `portfolio.ts`, `projection.ts`): `Currency = "TRY"|"USD"`; `Trade/Price/Position.currency`. `positions()` sembolün birimini işlemden taşır, değer/K/Z native çıkar. Yeni saf yardımcılar: `convert(amount, from, to, rates)`, `portfolioValueTry(pos, rates)`. `portfolioValueHistory` ve `project` imzalarına `rates` eklendi (USD-doğal fiyatlar güncel FX ile TRY'ye çevrilir — "geçmiş bugünkü kurla değerlenir", mevcut yaklaşımla tutarlı). **8 yeni test → 75 test yeşil.**

**Server** (`prices.ts`, `index.ts`): `fetchPrice` native döndürür (USD birimliyse `×usdTry` yok); `refreshAll` currency'yi trade'den okuyup `prices`/`price_history`'e saklar; `settings.fx_usd_try` her koşulda yazılır. `trades` crud'a `currency` kolonu (crud fabrikasına `default` alanı eklendi — gönderilmezse 'TRY'); elle fiyat `PUT /api/prices` currency alır.

**Web**: `theme.ts` `fmtMoney(v, ccy, dec?)`; `AmountField`'a `ccy` prop (canlı önizleme seçili birimde). `App.tsx`: ₺/$ görüntü seçici (başlıkta, localStorage `finans-ccy`, FX yoksa USD pasif), `portfolioValueTry`/`convert` ile net varlık + 4 KPI çevrimi, `project`'e `rates`. `TradeForm`: "Para birimi" seçici (varlık türüne göre varsayılan — KRIPTO/ETF→USD, diğerleri→TRY), fiyat/komisyon etiketleri ₺/$'a göre. `portfoy`: pozisyon satırları native (`$…` + USD rozeti), manuel fiyat native birimde, başlık K/Z toplamları görüntü birimine çevrilir. `ozet`: alokasyon pastası pozisyonları TRY'ye çevirip toplar, değer geçmişi `rates` ile.

Doğrulama: `pnpm build` temiz, 75 engine testi yeşil. `data/finans.db` yedeği alındı. Gerçek veride API: 15 mevcut trade `currency:"TRY"` (migrasyon), `fx_usd_try` doldu (46.98), USD ETF işlemi `currency:"USD"` saklandı, elle USD fiyat native (×yapılmadan) saklandı. Playwright: net varlık ₺183.484 ↔ ₺/$ toggle → $3.906 (KPI'lar da çevrildi, Nakit Haritası TRY kaldı — kapsam doğru); Portföy'de VOO `ETF · USD · ort. $150,00 · $1.080 · açık K/Z +$180` native; TradeForm'da "Para birimi" seçici. Tüm test verisi silinip 15 trade'e dönüldü (0 kalıntı), konsol hatası yok.

## Faz 4.9 — Para Piyasası Fonları Nakit Gibi Değerlenir ✅

Kullanıcı gözlemi: Nakit Akışı takvimi yalnızca nakit bakiyesine bakıp bir günü kırmızıya boyuyordu, oysa para piyasası (likit) fonu nakit kadar erişilebilir — o fonla kapanan bir açık gerçek risk değil. Ayrıca güne tıklayınca sadece nakit/portföy/toplam görünüyor, günün *neden* eksi/artı olduğu (o günün hareketleri) net değildi.

Onaylanan kapsam: para piyasası fonları **nakit gibi** sayılır; takvim gün rengi **etkin nakit = nakit + para piyasası fonu** ile belirlenir; güne tıklayınca kırılım + gün içi hareketler gösterilir. Hangi fonun para piyasası olduğu **opt-in** — uygulama bir FON'un likit mi hisse mi olduğunu bilemez, kullanıcı işaretler.

**Engine** (`projection.ts`): `Day`'e `cashFunds` alanı (o gün elde tutulan para-piyasası fonlarının TRY değeri; `assets`'in bir alt kümesi). Nakit sayılan fon sembolleri `settings.cash_funds`'tan (virgülle ayrık, `FON:SYMBOL` eşlemesi) okunur. `assetsOn` artık hem toplam portföyü hem PPF payını döndürür. **2 yeni test → 77 test yeşil.**

**Web**: `nakit/index.tsx` takvim gün rengi/ana sayısı `bal + cashFunds` (etkin nakit) ile; gün detayında **etkin nakit / gün sonu nakit / para piyasası fonu / diğer portföy / toplam varlık** kırılımı + "gün içi hareketler" başlığıyla o günün olayları. `portfoy/index.tsx`: FON satırlarında **"nakit say"** opt-in düğmesi (yeşil "✓ nakit sayılır" rozeti), `settings.cash_funds`'a yazar. Pür-nakit semantiği takvim dışında (Özet en düşük gün, Nakit Liste) korundu — sessiz anlam kayması yok.

Doğrulama: `pnpm build` temiz, 77 engine testi yeşil. İzole sunucu (`:8799`, ayrı DATA_DIR — gerçek DB'ye dokunulmadı) + Playwright: senaryo nakit ₺2.000, Kira −₺9.000 (20 Tem → nakit −₺7.000), AFA para-piyasası ₺11.000, TTE hisse fonu ₺5.500. İşaretlemeden önce 20–31 Tem kırmızı (−7k); AFA "nakit say" işaretlenince aynı günler yeşile döndü (4k = −7.000 + 11.000); 20 Tem detayı: etkin nakit ₺4.000 · gün sonu nakit −₺7.000 · para piyasası fonu ₺11.000 · diğer portföy ₺5.500 · toplam ₺9.500 · gün içi: Kira −₺9.000. Konsol hatası yok.

## Faz 5 — SaaS Dönüşümü: Auth + Çok-Kiracılık + Yayınlama (planlandı, henüz başlamadı)

Orijinal Faz 5 "tek kullanıcılı basit auth + yayınlama" idi. Temmuz 2026'da kullanıcıyla yeniden değerlendirildi ve kapsam **tam SaaS-MVP**'ye genişletildi. Alınan kararlar (kullanıcı onaylı):

1. **Taşınabilirlik öncelikli — lock-in yok.** Supabase Auth *kullanılmayacak* (asıl bağımlılık oradan geliyordu: `supabase-js` + GoTrue JWT + `auth` şeması); auth'u kendimiz yazıyoruz. Veri **düz Postgres** — sağlayıcı değiştirmek = connection string değiştir + `pg_dump`/restore.
2. **DB = Postgres, izolasyon = `user_id` scoping** (+ istenirse RLS ikinci savunma katmanı olarak). Database-per-tenant (Turso/libSQL) ve shared-SQLite seçenekleri değerlendirildi; kullanıcı Postgres'i seçti.
3. **Hosting kararı deploy anına bırakıldı**: **Neon** (managed, ücretsiz katman, scale-to-zero, duraklatma yok) **veya** **VPS'te self-host Postgres** (docker-compose'a servis, $0 ek maliyet, `pg_dump` cron yedeği bizde). Plan ikisinde de aynı; yalnız Faz 5.5'in yedek/bağlantı detayı değişir. (Supabase da değerlendirildi: ücretsiz projede 7 gün hareketsizlikte duraklatma + elle restore gerekiyor, Auth'u da kullanmayacaksak avantajı kalmıyor — elendi.)
4. **Billing yok** — Stripe kapsam dışı (kullanıcı kararı). Reklam (AdSense) mimari sürücü değil, sonraya park: SPA'ya script eklemek + KVKK cookie onayı ister, düşük trafikte getirisi düşük.
5. **`packages/engine` hiç değişmez** — saf/stateless, kendisine verilen `AllData` üzerinde çalışır. Tüm iş `apps/server` (db/index/prices) + yeni auth katmanı + `apps/web` giriş akışında.
6. **Fiyatlar global, varlıklar kiracıya özel.** `prices`/`price_history` piyasa verisidir (THYAO fiyatı herkes için aynı) — kiracıya bölünmez. `settings` ikiye ayrılır: **global** (`fx_usd_try`, `tefas_last_fetch`) vs **kullanıcı başına** (`horizon`, `cash_funds`).

Alt fazlar sıralı; her biri kendi başına çalışan uygulama bırakır:

### Faz 5.0 — SQLite → Postgres geçişi (davranış değişikliği yok) ✅
Yapılanlar:
- `node:sqlite` (senkron) yerine `pg` (async) sürücüsü; bağlantı `DATABASE_URL` env'inden. `db.ts` yeniden yazıldı: async `db.all/get/run(sql, ...params)` + atomik işler için `db.tx(async t => …)`; `?`→`$n` çevrimi, `INSERT ... RETURNING id` (lastInsertRowid yerine), `datetime/date('now','localtime')` yerine JS `nowLocal()/todayLocal()`. Şema `initDb()`'de Postgres lehçesinde (`GENERATED BY DEFAULT AS IDENTITY`, `REAL`→`double precision` — para hassasiyeti korunur), server başlarken `await initDb()`.
- `index.ts` + `prices.ts` tüm db çağrıları await'lendi; `transactions` yan etkisi ve TEFAS toplu upsert'i `db.tx` ile atomik.
- Tek seferlik taşıma script'i [scripts/migrate-sqlite-to-pg.mjs](../apps/server/scripts/migrate-sqlite-to-pg.mjs) (`pnpm --filter @finans/server migrate`): `data/finans.db` → Postgres, id'ler korunur, identity sequence'ları max+1'e çekilir, satır sayıları karşılaştırılır. Yeniden çalıştırılabilir (TRUNCATE … RESTART IDENTITY CASCADE).
- `docker-compose.yml`: `db` (postgres:16, `./data/pg` volume, healthcheck) + `finans` (depends_on healthy, `DATABASE_URL` ile bağlanır). Dockerfile'dan `DATA_DIR`/`VOLUME /data` çıkarıldı. `package.json`'dan `--experimental-sqlite` kaldırıldı, `migrate` script'i eklendi.
- Henüz auth/user yok — uygulama aynı tek-kullanıcı davranışıyla Postgres üstünde çalışır.

Doğrulama: gerçek `data/finans.db` (2 hesap, 20 trade, 3498 fiyat, 8261 fiyat geçmişi, `cash_funds:TP2` dahil) Postgres'e taşındı — tüm 12 tablonun satır sayıları birebir eşleşti, örnek değerler (float `0.43261478`, id'ler, settings) SQLite ile bit-bit aynı. Postgres-tabanlı server (izole port) + curl: RETURNING id (yeni id sequence'tan), `transactions` bakiye yan etkisi çift yönlü (1000→750→1000), fiyat upsert+delete, `updated_at` biçimi SQLite ile aynı. Playwright: SPA net varlık ₺143.119 + tüm KPI/grafikler gerçek Postgres verisiyle render, sıfır konsol hatası. `pnpm build` temiz.

### Faz 5.1 — Auth temeli ✅
Yapılanlar:
- `users` (email unique, `password_hash`, `created_at`) + `sessions` (token PK, server-side, revoke edilebilir, `expires_at` 30 gün) tabloları ([db.ts](../apps/server/db.ts) `initDb`).
- [auth.ts](../apps/server/auth.ts): parola hash'i **Node yerleşik `crypto.scrypt`** ("salt:key" hex; argon2 native bağımlılığından kaçınıldı), `verifyPassword` sabit-zaman karşılaştırma; session oluştur/oku(join+expiry)/sil.
- Rotalar ([index.ts](../apps/server/index.ts)): `POST /auth/register|login|logout`, `GET /auth/me`; guard'tan önce tanımlanır. `api.use("*")` guard'ı sonraki tüm `/api/*`'ı korur (geçerli oturum yoksa 401), context'e `user` koyar. Cookie `httpOnly + SameSite=Lax + Secure(prod)`, e-posta küçük harfe indirgenir.
- **Kayıt yalnız ilk kullanıcıya (owner) açık** — `users` boşsa izin, doluysa 403. Çok-kullanıcı kaydı Faz 5.2'de (tenant scoping gelince) açılacak. Veri şimdilik paylaşımlı (henüz `user_id` yok).
- Web: [features/auth](../apps/web/src/features/auth/index.tsx) giriş/kayıt ekranı (Faz 4.5 tasarım dili, kendi `themeCSS`'i); [api.ts](../apps/web/src/api.ts) `ApiError(status)` + `me/login/register/logout`; [App.tsx](../apps/web/src/App.tsx) açılışta `me` kontrolü, oturum yoksa `<Auth>`, 401'de (oturum düşünce) otomatik giriş ekranına dönüş, header'da ⏻ çıkış.
- **Ertelendi**: parola sıfırlama e-postası (Resend anahtarı yok — e-posta Faz 5.4'te kurulunca).

Doğrulama: `pnpm build` temiz. Postgres API (izole port) + cookie jar: oturumsuz `/all`→401, register(owner)→200+cookie, oturumla `/all`→200 (gerçek veri), ikinci register→403, yanlış parola→401, case-insensitive login→200, logout→sonra `/all`→401. Playwright: giriş ekranı render → login → dashboard (net varlık ₺143.113) → ⏻ logout → tekrar giriş ekranı, sıfır konsol hatası. Test kullanıcısı silindi (owner slotu boş).

### Faz 5.2 — Çok-kiracılık (en kritik alt faz) ✅
Yapılanlar:
- Kiracıya özel 9 tabloya `user_id integer REFERENCES users(id) ON DELETE CASCADE` (mevcut DB'lere `ALTER ADD COLUMN IF NOT EXISTS`, fresh'te de) — [db.ts](../apps/server/db.ts) `TENANT_TABLES`. `prices/price_history` **global** (piyasa verisi). `categories` benzersizliği `name` → `(user_id, name)` (kullanıcı başına).
- `settings` ikiye bölündü: **global** (`fx_usd_try`, `tefas_last_fetch` — `GLOBAL_SETTING_KEYS`) vs **kullanıcı** (`horizon`, `cash_funds`) yeni `user_settings (user_id, key, value)` tablosunda. `GET /api/all` ikisini birleştirip tek düz `settings` objesi döner (frontend sözleşmesi değişmedi); `PUT /settings` anahtara göre doğru tabloya yazar.
- `crud()` fabrikası tek noktadan scope'lar: POST `user_id` enjekte, PUT/DELETE `WHERE id=? AND user_id=?`. Elle yazılan `transactions` POST/DELETE de scope'lu (bakiye yan etkisi dahil `WHERE id=? AND user_id=?`). `GET /api/all` her tenant sorgusuna `WHERE user_id=?`.
- **Owner bootstrap devri**: ilk kullanıcı kaydında (register) `user_id IS NULL` olan tüm sahipsiz satırlar o owner'a devredilir + per-user ayarlar global settings'ten user_settings'e taşınır (Faz 5.0/5.1'den kalan tek-kullanıcı verisi böyle sahiplenilir). Yeni kurulumda 0 satır — zararsız.
- `refreshAll()` zaten `SELECT DISTINCT ... FROM trades` (tüm kullanıcılar) → global fiyat tazeleme; değişiklik gerekmedi (Faz 5.3 davranışı hazır geldi).

Doğrulama (ayrı `finans_test` DB'de, gerçek veriye dokunmadan — `ON DELETE CASCADE` nedeniyle owner silme riski): sahipsiz veri (1 hesap+1 trade+global horizon/cash_funds) tohumlandı → owner register → **adoption**: satırlar user_id=1'e geçti, horizon/cash_funds user_settings'e taşındı, global settings sadece fx/tefas kaldı. İkinci kullanıcı (B, DB'ye elle) ile **çapraz erişim**: B'nin `/all`'ı 0 kayıt + sadece global settings (A'nın verisi/ayarı sızmadı); B → A'nın hesabını sil/düzenle → 0 satır (A dokunulmadı); B, A'nın account_id'siyle işlem → A'nın bakiyesi (5000) oynamadı, işlem A'ya sızmadı. Playwright: owner girişi → dashboard ₺8.335, projeksiyon horizon=6 (user_settings'ten), 0 konsol hatası. `pnpm build` temiz.

**Not:** RLS ikinci savunma katmanı şimdilik eklenmedi (uygulama katmanı scoping + tek owner yeterli); açık kayıt Faz 5.2 sonrası hâlâ kapalı (owner-only) — çok-kullanıcı kaydı ileride onboarding ile açılacak.

### Faz 5.2.1 — Elle fiyat override'ı kullanıcıya özel ✅
Açık: elle girilen fiyat global `prices` tablosuna yazılıyordu → bir kullanıcının manuel fiyatı **tüm kullanıcıların değerlemesini** değiştiriyordu. Çözüm: yeni `user_prices (user_id, symbol, asset_type, price, updated_at, currency)` tablosu — global `prices` yalnızca **otomatik (piyasa)** fiyat; elle override kullanıcıya özel. `GET /api/all` global auto + kullanıcının override'ını **merge** eder (override kazanır, `source='manual'`); `PUT /api/prices` → `user_prices`, `DELETE` (sıfırla) → kullanıcının override'ını siler (global auto'ya döner). Elle fiyat artık global `price_history`'e de yazılmaz (bir kullanıcının eli global geçmişi kirletmesin). Owner bootstrap'ında mevcut `source='manual'` satırlar owner'ın `user_prices`'ına taşınır, global `prices` auto-only kalır.

Doğrulama (finans_test): global auto THYAO=100 + orphan manual GARAN=50 → owner register → adoption: GARAN owner user_prices'a, global sadece THYAO(auto). Owner elle THYAO=999 → **global THYAO hâlâ 100(auto)**; owner 999 görür, **kullanıcı B global 100 görür** (owner'ın 999'u/GARAN'ı B'ye sızmaz); owner sıfırla → global auto'ya döner. `pnpm build` temiz.

### Faz 5.3 — Global fiyat tazeleme ✅ (5.2 mimarisiyle hazır geldi)
- `refreshAll()` zaten `SELECT DISTINCT asset_type, symbol, currency FROM trades` (kullanıcı filtresi yok) → **tüm kullanıcıların tuttuğu sembollerin birleşimini** tazeler; `prices`/`price_history` global, `fx_usd_try`/`tefas_last_fetch` global settings'te (`GLOBAL_SETTING_KEYS`). Ek kod gerekmedi.
- TEFAS zaten tür başına tüm listeyi günde bir çeker → RapidAPI kotası kullanıcı sayısıyla **artmaz**. Doğrulandı: 5.2 testinde owner'ın THYAO'su global fiyat tablosundan değerlendi.

### Faz 5.4 — Sertleştirme + KVKK ✅
Yapılanlar ([index.ts](../apps/server/index.ts)):
- **Güvenlik başlıkları** tüm yanıtlara (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, **CSP** ve prod'da **HSTS** — deploy-öncesi turda eklendi, aşağı bkz).
- **Rate-limit** (in-memory, IP başına) `/auth/login` + `/auth/register` için (10/5dk → 429) — brute-force koruması. CSRF: cookie `SameSite=Lax` (Faz 5.1) modern standart korumayı sağlıyor, ek token eklenmedi.
- **KVKK**: `GET /api/export` — kullanıcının tüm verisi JSON indirme (`Content-Disposition`); `POST /api/account/delete` — parola onaylı hesap+veri silme (`ON DELETE CASCADE` ile tenant verisi + oturumlar + user_settings). Frontend: Özet altında **"Hesap & Veri"** kartı (e-posta, "Verilerini indir", parola onaylı "Hesabı sil").

Doğrulama (finans_test): başlıklar mevcut; login 10×401 → 11. **429**; export doğru içerik + Content-Disposition; hesap silme yanlış parola→401, doğru→200 + oturum düştü (`/all`→401) + DB cascade wipe (users/accounts/sessions=0). Playwright: "Hesap & Veri" kartı + silme onay kutusu render, 0 konsol hatası. `pnpm build` temiz.

**Ertelendi (bilinçli):** girdi doğrulama zod şemaları (mevcut required-field kontrolü + owner-only kayıt yeterli, değeri düşük); Sentry/yapısal log (harici, DSN gerekir); parola sıfırlama e-postası (Resend). `pg_dump` yedeği README'de belgeli.

#### Deploy-öncesi güvenlik turu (5.4 üstüne) ✅
`index.ts`'e eklenenler:
- **CSP** tüm yanıtlara (`script-src 'self'`, `style-src 'self' 'unsafe-inline' + fonts.googleapis`, `font-src + fonts.gstatic`, `frame-ancestors 'none'`, `object-src 'none'`) — XSS/clickjacking; SPA'da 0 ihlal doğrulandı. Prod'da **HSTS** (`max-age=180g; includeSubDomains`).
- **Genel API rate-limit** tüm `/api`'ye (IP başına 300/dk → 429); `/prices/refresh` kullanıcı başına 6/dk (harici API/TEFAS kotası koruması).
- **E-posta başına login brute-force**: 5 başarısız → 15dk 429 (IP-spoof'tan bağımsız hesap koruması); **zamanlama-güvenli login** (kullanıcı yoksa da dummy scrypt → e-posta enumerasyonu engellenir).
- **İstek gövdesi sınırı** 256KB (413); **global hata yakalayıcı** (`app.onError` → jenerik 500, stack sızmaz); **güvenli JSON parse** tüm yazma uçlarında (bozuk gövde → 400, 500 değil). Rate-limit sayaçları periyodik temizlenir (bellek).

Doğrulama (finans_test, prod+dev mod): tüm başlıklar (CSP+HSTS) API+statik yanıtta; bozuk JSON→400, 300KB gövde→413, e-posta brute-force 5×401→429; Playwright CSP aktifken SPA tam render, **0 CSP ihlali, 0 konsol hatası**. `pnpm build` temiz.

Kalan artık riskler (kabul edildi, deploy-blocker değil): gövde sınırı Content-Length tabanlı (chunked'ı önündeki reverse proxy sınırlar); IP rate-limit güvenilir proxy XFF'ine dayanır (e-posta limiti telafi eder); owner-bootstrap kayıt teorik yarış (tek-owner'da düşük risk).

### Faz 5.5 — Yayınlama ✅
Karar (planlanan "Fly.io/VPS" yerine): **Render (app, ücretsiz Docker web service) + Neon (Postgres, PG17, eu-central-1)** — `render.yaml` blueprint repoda ama servis elle kurulduğu için **autoDeploy kapalı**, deploy Render konsolundan **Manual Deploy** ile tetiklenir. `db.ts` uzak (localhost olmayan) bağlantıda SSL'i otomatik açar. Ücretsiz katman 15 dk atıllıkta uyur (soğuk başlangıç ~30 sn + cron durur) — tek kullanıcı için kabul edildi.

Deploy sırasında öğrenilenler:
- **Docker build**: temiz frozen install'da her paket `@types/node`'u açıkça bildirmeli (engine `types:[]`, `apps/web`'e açık bağımlılık) — yerel pnpm hoisting Docker'da yok.
- **PWA**: `/api/all` network-first cache timeout 5→30 sn (soğuk başlangıçta eski veri gösteriyordu).
- **Ağ tuzağı**: kullanıcının ISP'si giden 5432'yi engelliyor — yerelden Neon'a `psql`/`pg_dump` çalışmıyor, migration için mobil hotspot gerekti. Render'ın kendi sunucuları etkilenmez.

CI/CD (GitHub Actions) yapılmadı — manuel deploy tek kullanıcı için yeterli görüldü; ihtiyaç olursa ayrı iş.

Kapsam dışı (bilinçli, ileride ayrı faz olabilir): Stripe/billing ve plan kapıları, AdSense, Google ile giriş (OAuth).

---

## Faz 6 — Portföy↔nakit bağlantısı + e-posta akışları ✅

- **Portföy işlemi opsiyonel nakit hesaba bağlanır**: `trades.account_id` doluysa ALIŞ hesaptan düşer, SATIŞ ekler, kayıt silinince geri alınır (sunucu tarafında atomik, `tradeBalanceDelta`). Boş bırakılırsa eski davranış (portföy ve nakit ayrık) korunur — Faz 3'te "atlandı" denen madde böylece opt-in olarak geldi.
- **Şifre sıfırlama + hesap aktivasyonu**: generic SMTP ([mail.ts](apps/server/mail.ts)) — env değişince sağlayıcı değişir, kod değişmez. `email_tokens` tablosu (`verify`/`reset`, 24s/1s geçerlilik).

## Faz 7 — Vadeli mevduat + Hesaplar sekmesi ✅

`deposits` tablosu (anapara, faiz, vade, stopaj); açılışta anapara opsiyonel olarak bir hesaptan düşer, vade sonunda net getiriyle birlikte projeksiyona girer. Hesap yönetimi Özet'ten ayrılıp kendi sekmesine taşındı. **7.1**: TEFAS başarısız denemede 1 saat geri-çekilme (kota israfını önler).

## Faz 8 — Gerçekleştirme (elle + otonom) ✅

Düzenli gelir/gider ve kredi kartı ekstresi **plan**dan **deftere** geçirilebilir: elle "Gerçekleşti" düğmesiyle veya `auto` işaretliyse cron ile. **8.2**: kart ekstresi tutarı artık sunucuda `txShares` ile hesaplanır — istemciden gelen tutara güvenilmez (`apps/server` da `@finans/engine` tüketir).

## Faz 9 — Düzenli kalem tutar zaman çizelgesi ✅

Tutar kimlikten ayrıldı: `recurring` = kalıcı kimlik, tutar `recurring_amounts (recurring_id, from_month, amount)` çizelgesinde yaşar (`'0000-01'` = "baştan"). "Değiştir" artık kaydı bölmez — tek atomik upsert; geçmiş projeksiyon eski tutarla korunur, planlı değişiklik "↗ … itibarıyla …" ipucuyla görünür ve geri alınabilir. Bu, önceki istemci-taraflı PUT+POST akışının bayrak kopyalama/çift satır/atomik olmama sorunlarını çözdü.

### Araya giren UI işleri ✅
- **Nakit Haritası**: Özet'teki grafik/rozet/uyarı çıplak nakit yerine **likit nakit** (bakiye + "nakit say" fonları) kullanır; kör "N gün eksi" uyarısı yerine **runway** (nakitin tükeneceği tarih).
- **Tasarım skin'i**: sol kenar çubuğu + üst çubuk kabuğu, sıcak nötr palet, net varlık hero + KPI kartları. (İki gerçek regresyon da burada yakalandı: grid çocuklarının `min-width:auto`'su mobil düzeni taşırıyordu; Schibsted Grotesk ₺ glifini £ basıyordu → para simgeleri mono fontta.)
- **Gizlilik modu**: tek global anahtar tüm tutarları maskeler; para biçimleyicilerinin içinde çözüldüğü için 38+ çağrı yeri prop geçmeden gizlenir.
- **Portföy pozisyonları varlık sınıfına göre gruplanır** (Kıymetli Maden / BIST / ABD & ETF / Kripto / Döviz).

---

## Faz 10 — Çok-kullanıcı onboarding ✅ (+ açık iş)

Owner-only kayıt kapısı kaldırıldı: **herkese açık kayıt + zorunlu e-posta doğrulama**. İlk kullanıcı owner (oto-doğrulanır, sahipsiz veriyi devralır, oto-giriş); sonrakiler `email_verified=false` + aktivasyon e-postası + `pending` (oturum açılmaz, doğrulanana dek login 403). `POST /auth/resend-verify` (rate-limited, daima 200). E-posta gönderimi `await` edilmez — SMTP yavaşsa bile `/auth/register` anında döner.

Aynı turda kapatılan güvenlik açıkları:
- `sessions.token` artık **SHA-256 hash** olarak saklanır (cookie'de ham, DB'de hash); süre 30g→7g.
- `PUT /api/settings` global anahtar yazımını (`fx_usd_try`, `tefas_*`) 403 ile reddeder — önceden herhangi bir kullanıcı herkesin değerlemesini bozabilir veya global fiyat tazelemeyi durdurabilirdi.
- E-posta linkleri artık tarayıcı `Origin` header'ına güvenmiyor (`APP_URL` || istek host'u) — saldırgan kontrolündeki Origin ile geçerli token sızdırılıp hesap ele geçirilebilirdi. Prod'da `APP_URL` yoksa açılışta uyarı.
- `hono/logger` + kritik olaylara `[audit]` satırları (kayıt, giriş/çıkış, şifre sıfırlama, gerçekleştirme, borsa işlemi, mevduat, ekstre ödeme, KVKK export/silme).

**⏳ Açık iş — e-posta teslim edilebilirliği (gerçek kullanıcı almadan önce şart):** prod SMTP'si Gmail. Gmail `250 OK` dönüyor ve Gmail adreslerine ulaşıyor, ama "hesabını aktive et + buton + başka siteye link" kalıbı kurumsal alan adlarında phishing sayılıp sessizce düşüyor (`@phexum.com`'a ulaşmadı; düz test maili ulaşmıştı). Çözüm: transactional sağlayıcı (**Resend/Brevo/Postmark**) + kendi domain'inde **SPF/DKIM(+DMARC)** + `MAIL_FROM=no-reply@<domain>`. [mail.ts](apps/server/mail.ts) generic SMTP olduğundan **yalnız env değişir**; Render env'ine `SMTP_*` + `APP_URL` de eklenmeli.

### Faz 10.1 — Giriş sürtünmesini azaltma ✅
[recall.ts](apps/web/src/features/forms/recall.ts): geçmişten öneri (sıklık × tazelik), tamamı istemcide `AllData`'dan türetilir (yeni uç yok). Ada göre autocomplete — seçilince tutar/kategori/hesap (kartta kart/taksit) son kayıttan dolar; TradeForm'da sembolden tür/para birimi/portföy hatırlanır + "güncel fiyat" ve "tümünü sat" kısayolları. "+ Ekle" üstünde sık girilenler çipleri (düzenli kalemler ve kart ekstresi ödemeleri elenir — onlar otomatik üretilir).

### Faz 10.2 — Toplu içe aktarma ✅
Faz 4'te "gerekli görülmedi" denen dosya importu, **dosyasız** biçimde geri geldi: metin yapıştır → [statement.ts](packages/engine/src/statement.ts) ayrıştırıcısı (sekme/CSV/boşluk, TR+US tutar biçimi, bakiye sütunundan işaret çıkarımı; ayırıcı ve sütunlar satırların çoğunluğuna bakılarak seçilir) → düzeltilebilir önizleme (kategori tahmini geçmişten, olası kopya işareti) → tek atomik `POST /api/transactions/bulk` (≤500 satır, hesap/kategori sahipliği önden doğrulanır).

## Faz 11 — Portföy grupları ✅

`portfolios` tanım tablosu + `trades.portfolio_id` (`ON DELETE SET NULL` → grup silinince işlem "Gruplanmamış"a düşer). Gruplama **işlem düzeyinde** bilinçli tercih: aynı sembol iki portföyde ayrı ortalama maliyet olabilsin (farklı kurum/strateji). Mevcut işlemi taşımak için dar uç: `PUT /api/trades/:id/portfolio` (sil+ekle bakiyeyi iki kez oynatırdı). **Net varlık/alokasyon/projeksiyon etkilenmez** — saf raporlama katmanı.

## Faz 12 — Hareket geçmişi ✅

`tradeLedger(trades)`: her işlemin öncesi/sonrası adet + ortalama maliyet, satışta gerçekleşen K/Z, "pozisyon kapandı" işareti — `positions()` ile aynı matematik, ara adımları verir. [Hareketler.tsx](apps/web/src/features/portfoy/Hareketler.tsx): sembol/tür/yön/dönem filtreleri, aya göre gruplama, **para birimi başına** dönem özeti (TRY+USD toplanmaz — işlem anındaki kur bilinmiyor). Filtreler yalnız görünen satırları kısar; ortalama maliyet hep tüm geçmişten hesaplanır.

## Faz 13 — Değer grafiği aralıkları ✅

engine: `sliceValueHistory` (1H/1A/3A/6A/1Y/TÜM) + `bucketValueHistory` (uzun pencerede kova başına SON nokta = kapanış; ilk/son korunur) + `historyChange` (dönem değişimi mutlak + %). [DegerGrafigi.tsx](apps/web/src/features/portfoy/DegerGrafigi.tsx) Özet'te tüm portföye, Portföy sekmesinde seçili gruba kapsamlı. **Dürüst kısıt**: `price_history` günde bir anlık görüntü tuttuğundan çözünürlük **gündür** — aralık düğmeleri pencereyi daraltır, veriyi sıklaştırmaz.

## Faz 14 — Kayıt düzenleme ✅

Kapsam kararı: **işlem kayıtları** (`transactions`, `oneoffs`, `card_txs`, `trades`) — yani yanlış tutar/tarih girmenin gerçekten olduğu yerler. Tanım kayıtları (hesap/kart/kredi/kategori/mevduat) bilinçli olarak dışarıda; onlar nadiren değişir ve düzenli kalemin tutarı için zaten Faz 9 akışı var.

- **Sunucu**: `oneoffs`/`card_txs` jenerik `crud` PUT'unu kullanır (zaten vardı, arayüz kullanmıyordu). Yan etkili ikisi için yeni uç: `PUT /api/transactions/:id` ve `PUT /api/trades/:id` — tek `db.tx` içinde **eski bakiye etkisini geri al → satırı güncelle → yeni etkiyi uygula**. Hesap değiştirmek de bu yüzden serbest: iki UPDATE de kendi satırının `account_id`'sini hedefler. Sil+ekle bunu iki ayrı istekte yapardı; arada hata olsa bakiye tutarsız kalırdı. Kayıt yoksa/başkasınınsa 404.
- **Arayüz**: [EditSheet.tsx](apps/web/src/EditSheet.tsx) — "+ Ekle" formlarını `edit` prop'uyla düzenle modunda açar. Ayrı düzenleme formu yazılmadı: doğrulama/ipucu/autocomplete mantığı iki yerde bakım demek olurdu. Düzenlemede "Kaydet, yeni ekle" gizlenir, kaydın etkisini anlatan ipucu satırı düzenlemeye özel metne döner. Giriş noktası: listelerde ✕'in yanındaki ✎ (Rapor, Plan, Kartlar, Portföy→Hareketler).
- **Kural**: düzenleme kaydın türünü değiştirmez — gerçekleşen kaydın tarihini ileri almak onu plan kalemine çevirmez (plan→defter geçişi "Gerçekleşti" düğmesidir).

Doğrulama: izole test DB'de (finans_edit_test) uçtan uca — tutar değişimi, hesap A→B taşıma, hesabı kaldırma, gider→gelir çevirme, silme; trade'de adet/yön/para birimi değişimi (TRY→USD'de eski TRY etkisi geri alınır, yenisi uygulanmaz) — bakiye her adımda beklenen değerde. Negatifler: yok olan id 404, eksik alan/bozuk JSON/NaN tutar 400, geçersiz portföy 400, **başka kullanıcının kaydı 404 + veri değişmiyor**. Playwright ile Rapor'da ✎ → önden dolu modal → tutar değişimi → API'de doğrulandı (konsol hatası yok). `pnpm build` temiz, 125 engine testi yeşil (engine'e dokunulmadı).

## Faz 15 — Hesap hareket defteri ✅

Sorun: `accounts.balance` tek bir sayıydı ve **altı ayrı akış** onu yerinde değiştiriyordu (işlem ekle/düzenle/sil/toplu içe aktar, portföy işlemi, mevduat açılışı, düzenli kalem gerçekleştirme, kart ekstresi ödemesi, elle bakiye düzeltmesi). Hiçbiri iz bırakmıyordu: bakiye gerçekle tutmadığında nerede kaydın kaçtığını bulmanın yolu yoktu, elle düzeltme ise tamamen görünmezdi.

Karar: **gerçek defter** (türetilmiş görünüm değil). Yeni `account_entries` tablosu; değişmez kural **balance = Σ entries** (açılış bakiyesi de bir satır).

- **Tek geçit**: bakiye yalnız `applyEntry` / `revertEntries` üzerinden değişir; hiçbir uçta doğrudan `UPDATE accounts SET balance` kalmadı. `revertEntries` eski tutarı yeniden hesaplamaz, **yazılmış** hareketi okur — düzenle/sil yollarındaki kayma sınıfı böyle kapanır. Düzenleme = revert + apply.
- **accounts artık elle CRUD**: POST açılış bakiyesini 'acilis' hareketi yazar; PUT elle bakiye düzeltmesini **fark kadar** 'duzeltme' hareketi olarak deftere geçirir (eskiden izsiz sayı değişimiydi).
- **Geriye dönük dolum** (`initDb`, bir kez, `settings.account_entries_backfilled` ile idempotent): mevcut transactions/trades/deposits'ten hareketler üretilir, **açıklanamayan kalan** hesabın açılış satırına yazılır → hiçbir bakiye değişmez ve kural ilk günden sağlanır. Dolum olmadan eski kayıtların silinmesi bakiyeyi kaydırırdı (geri alma artık deftere bakıyor).
- **Engine** [accounts.ts](packages/engine/src/accounts.ts): `accountLedger` (yürüyen bakiye, yeniden eskiye), `ledgerDrift`, `ledgerSummary`. Aynı tarihte **açılış önce** gelir — dolumda açılışın id'si en büyük olduğundan id sırası "açılış = son bakiye" gibi saçma bir satır üretiyordu (Playwright'ta yakalandı).
- **Arayüz**: Hesaplar sekmesinde hesap başına "Hareketler" — tarih, açıklama, tür rozeti, tutar ve o hareketten sonraki bakiye; giren/çıkan özeti; drift varsa uyarı (gizlenmez). Liste salt okunur: hareket kaynağından düzenlenir.

Doğrulama: izole test DB'sinde her akış (açılış, işlem ekle/düzenle/sil, elle düzeltme, portföy alış + silme, mevduat açılış + silme) sonrası **balance = Σ entries** doğrulandı; dolum senaryosu (defter silinip sunucu yeniden başlatıldı) bakiyeleri birebir korudu ve yeniden başlatmada satır sayısı değişmedi (idempotent); çok-kiracılıkta başka kullanıcının hesabı 404 ve hareketleri görünmüyor. Playwright ile Hesaplar ekranı doğrulandı (konsol hatası yok). 134 engine testi (9 yeni), `pnpm build` temiz.

## Faz 16 — Virman, hesap türleri, mutabakat ✅

Sorun (kullanıcının tarifi): maaş → para piyasası fonu → ödeme öncesi kısmi fon satışı → başka bankaya transfer → o bankanın kart borcu → ATM'den nakit → Midas'ta hisse. Bu akışın **çoğu hareketi iki bacaklıydı ve net varlığı değiştirmiyordu**, ama modelde virman primitifi yoktu: bakiyeyi oynatan her şey (`transactions`, `trades`, `deposits`, kart ödemesi) **tek bacaklıydı**. Sonuç:

- Banka A → Banka B transferi **iki ayrı sahte `transaction`** olarak giriliyordu — Rapor'da olmayan bir gider + olmayan bir gelir; biri unutulunca bakiye kayıyordu ve hiçbir şey uyarmıyordu.
- **Nakit ve aracı kurum hesap değildi** → ATM'den çekilen ve Midas'a atılan para sistemden çıkıyordu; hem bakiye hem net varlık yanlış kalıyordu.
- Bakiye gerçekle tutmadığında yapılacak tek şey elle düzeltmeydi; **"gerçekte ne kadar var"ı sisteme söyleyip farkı bulduran bir akış yoktu**.

"Eksik/hatalı işleme müsait olma" bir disiplin sorunu değil, modelin kullanıcıyı her transferde **birbirine bağlı olmayan iki kayıt** girmeye zorlamasıydı.

- **`transfers` (virman)**: tek kayıt, `db.tx` içinde **iki** `account_entries` satırı (kaynak −, hedef +, `kind='virman'`). Rapor'a girmez (gelir/gider değil), net varlığı değiştirmez. Yarım virman yazmak artık **yapısal olarak imkânsız**. Düzenle/sil deseni diğer yan etkili uçlarla aynı: `revertEntries(…, "transfers", id)` iki bacağı birden geri alır, sonra yenisi uygulanır — hesap değişse bile doğru satırlar hedeflenir. Doğrulamalar: aynı hesap 400, tutar ≤ 0 400, iki hesabın da kullanıcıya ait olması şart (`ownsAccounts`).
- **`accounts.kind`** (`banka|nakit|araci|fon`, mevcut hesaplar `banka`): nakit cüzdanı ve aracı kurum da birer hesap. Tür yalnız gruplama/ikon içindir — dördü de aynı defter kurallarına tabidir; matematik değişmez. Böylece ATM çekimi ve Midas'a aktarım "kaybolan para" olmaktan çıkıp virman olur.
- **Mutabakat** (`POST /api/accounts/:id/reconcile` + `accounts.last_recon_date/balance`): kullanıcı gerçek bakiyeyi girer, fark 'duzeltme' hareketi olarak **deftere yazılır** (gizlenmez). Fark 0 ise hareket yazılmaz, yalnız damga atılır — "doğruladım, tutuyor" da bilgidir. Arayüzde fark gösterilirken **son doğrulamadan bu yanaki hareketler** listelenir: unutulan kayıt orada yakalanır. Soru "bakiyem tutuyor mu"dan "en son ne zaman doğruladım"a döner.
- **Engine** [accounts.ts](packages/engine/src/accounts.ts): `reconcileDiff`, `reconStatus` (hic/guncel/bayat, eşik 30 gün), `entriesSinceRecon`, `accountKindOf`, `ACCOUNT_KIND_LABEL`.
- **Arayüz**: "+ Ekle → Transfer (virman)" formu (yön değiştirme düğmesi, iki hesabın kayıt-sonrası bakiye önizlemesi, eksiye düşme uyarısı); Hesaplar sekmesinde tür rozeti + tür seçici + "Doğrula" paneli + "Transferler" listesi (düzenle/sil). `ledgerDrift` uyarısı ile **karıştırılmamalı**: drift defter-içi tutarsızlığı, mutabakat dış dünyayla farkı yakalar.
- **Sınır**: başkasına gönderilen para virman **değil giderdir** (net varlıktan çıkar) — `transactions`'ta kalır. Bu ayrım hem form hem liste metninde açıkça yazılı.

Doğrulama: izole test DB'sinde (`finans_faz16_test`) uçtan uca — virman ekle (50000/0/0 → 45000/5000/0), **düzenle** (tutar 5000→7000 + hedef Cüzdan→Midas → 43000/0/7000, yani eski bacaklar tam geri alındı), sil (→ 50000/0/0 birebir başlangıç). Negatifler: aynı hesap 400, negatif tutar 400, olmayan hesap 400, oturumsuz 401. Mutabakat: kayıt 50000 iken gerçek 48750 → `diff:-1250`, 'duzeltme' hareketi yazıldı, `balance = Σ entries` korundu; fark 0 ile tekrar doğrulama hareket **yazmadı**, yalnız damgayı güncelledi. Göç: Faz 15 şemalı gerçek yerel DB'de `ALTER TABLE ... IF NOT EXISTS` sonrası bakiyeler ve defter toplamları birebir aynı (fark 0). `pnpm build` temiz, 140 engine testi yeşil (6 yeni).

---

## Doğrulama

- **Faz 0**: ✅ `pnpm build` temiz; 46 engine vitest testi yeşil; gerçek `data/finans.db` ile prod sunucu smoke test edildi (API verisi + derlenmiş arayüz doğrulandı).
- **Faz 1**: ✅ `pnpm build` temiz; 52 engine vitest testi yeşil (6 yeni ledger testi dahil); gerçek `data/finans.db`'nin yedeği alındıktan sonra prod sunucu ile kategori/işlem CRUD uçtan uca test edildi, eski veri (accounts/recurring/loans/trades/cards) değişmeden kaldı.
- **Faz 2**: ✅ `pnpm build` temiz (PWA precache üretimi dahil); Playwright ile masaüstü/mobil ekran görüntüsü + konsol hatası kontrolü yapıldı. Henüz yapılmadı: gerçek telefonda "ana ekrana ekle" kurulumu ve Lighthouse PWA denetimi (kullanıcının kendi cihazında denemesi gerekir).
- **Faz 3 (kısmi)**: ✅ `pnpm build` temiz; 57 engine testi yeşil (5 yeni `portfolioValueHistory` testi dahil); gerçek sunucuda elle fiyat girişi + otomatik tazeleme test edildi (`price_history` doğru yazıyor), Playwright ile Özet ekranı doğrulandı.
- **Faz 4**: ✅ `pnpm build` temiz; 63 engine testi yeşil (6 yeni: `monthsBack` + `monthlyTotals`); gerçek `data/finans.db` üzerinde geçici test kategorisi/işlemleriyle uçtan uca test edildi (trend grafiği + kategori pastası Playwright'la görsel doğrulandı), sonra API'den silinip eski verinin (0/0'a döndüğü doğrulanarak) bozulmadığı teyit edildi.
- **Faz 4.5**: ✅ `pnpm build` temiz; 63 engine testi değişmeden yeşil (sunum katmanı, hesaplama dokunulmadı); Playwright ile gerçek `data/finans.db` üzerinde açık+koyu tema × Özet/Nakit/Bütçe/Portföy/Rapor sekmeleri + mobil (390px) görsel doğrulandı, konsol hatası yok; varlık türü renkleri `getComputedStyle` ile pixel-doğru teyit edildi.
- **Faz 4.6**: ✅ `pnpm build` temiz; 67 engine testi değişmeden yeşil; Playwright ile gerçek veride yeni sekmeler + global "+ Ekle" akışı uçtan uca doğrulandı (kayıt oluşturma→API teyidi→temizlik), mobil FAB dahil; konsol hatası yok.
- **Her faz sonunda**: `data/finans.db` yedeği alınmış olmalı; commit fazın sonunda tek parça.

## Sıralama

Fazlar sıralı; her faz kendi başına çalışan uygulama bırakır. Faz 0–13 tamamlandı (Faz 5 yayına, 10–13 ürün derinleşmesine kadar).

**Sıradaki iş — numaralı faz değil, açık kalan kalemler (öncelik sırasıyla):**
1. **E-posta teslim edilebilirliği** (prod engelleyici, bkz. Faz 10) — Resend/Brevo + kendi domain + SPF/DKIM/DMARC; sadece env değişikliği. Bu bitmeden çok-kullanıcı kâğıt üzerinde kalır.
2. **Deploy disiplini** — Render'da autoDeploy kapalı; her commit sonrası Manual Deploy unutulmamalı (ya da Blueprint'e geçilip otomatikleştirilmeli).
3. Sonraki ürün fikirleri (henüz seçilmedi): temettü/sermaye olayları, tanım kayıtlarının düzenlenmesi, gün içi fiyat geçmişi, GitHub Actions CI/CD.
