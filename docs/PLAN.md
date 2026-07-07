# Finans — Kişisel Finans Uygulamasına Evrim Planı

## Durum

- ✅ **Faz 0 tamamlandı** — pnpm monorepo iskeleti (`apps/server`, `apps/web`, `packages/engine`), finans matematiğinin `packages/engine`'e çıkarımı + 46 vitest testi, `apps/web`'in tab başına `features/` klasörlerine bölünmesi. Davranış değişikliği yok; gerçek `data/finans.db` ile doğrulandı.
- ⬜ Faz 1–5 henüz başlamadı.

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

## Faz 1 — Ledger Veri Modeli (çekirdek değişim)

Yeni şema (`apps/server/db.ts`, mevcut migrasyon deseniyle — `PRAGMA table_info` + `ALTER/CREATE IF NOT EXISTS`):

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  color TEXT
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,                -- gelecek tarihli = planlı kalem
  name TEXT NOT NULL,
  amount REAL NOT NULL,              -- işaretli: gelir +, gider −
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'  -- manual | generated | import (ileride)
    CHECK (source IN ('manual','generated','import')),
  recurring_id INTEGER,              -- üretildiyse hangi şablondan (dedup için)
  UNIQUE (recurring_id, date)        -- aynı şablon aynı güne iki kez düşmesin
);
```

Model kuralları:
- **Bakiye türetilir**: hesap bakiyesi = açılış işlemi + Σ(o hesabın `date ≤ bugün` işlemleri). `accounts.balance` kolonu kalkar (geçiş süresince okunmaz).
- **Şablonlar üretir**: `recurring`, `loans`, `cards` tabloları "planlama nesnesi" olarak kalır. Sunucuda günlük job (mevcut `node-cron` altyapısı): vadesi gelen recurring/kredi taksidi/kart ekstresini `source='generated'` işlem olarak deftere yazar (`recurring_id` + `UNIQUE` ile idempotent). Kullanıcı üretilen kaydı düzenleyebilir/silebilir (gerçek tutar farklıysa).
- **Projeksiyon** (`engine.project` yeniden yazılır): bugünkü türetilmiş nakit + gelecek şablon oluşları (recurring/kredi/kart) + gelecek tarihli işlemler. Geçmiş günler artık defterdeki gerçek işlemlerden hesaplanır.
- `oneoffs` tablosu `transactions`'a erir (tek seferlik = kategorisiz/kategorili tek işlem, gelecek tarihli olabilir).

Veri geçişi (tek seferlik migrasyon, `db.ts` içinde sürüm anahtarıyla — `settings.schema_version`):
1. Her hesap için mevcut `balance` → bugün tarihli "Açılış bakiyesi" işlemi.
2. `oneoffs` satırları → `transactions` (geçmiş + gelecek tarihli olduğu gibi).
3. Geçmişte kalmış recurring/kredi/kart oluşları **geriye dönük üretilmez** (bakiye zaten açılış işleminde içkin); üretim bugünden ileri başlar.
4. Migrasyon öncesi otomatik yedek: `data/finans.db` → `data/finans-backup-<tarih>.db` kopyası.

API (`apps/server/index.ts`):
- Mevcut `crud()` fabrikasıyla `transactions` ve `categories` CRUD (PUT zaten var → **düzenleme artık her yerde gerçek edit**, sil+yeniden-ekle biter).
- `GET /api/all` yeni tabloları da döner (tek-okuma-ucu deseni korunur).

UI:
- **Bütçe sekmesi** yeniden: aylık görünüm — kategori bazlı gerçekleşen toplamlar, işlem listesi (tarih/ad/kategori/hesap/tutar), hızlı işlem ekleme, kategori yönetimi.
- Hesaplar: bakiye artık salt-okunur türetilmiş değer + "düzeltme işlemi ekle" kısayolu (elle bakiye senkronu için).
- Nakit takvimi: geçmiş günler defterden, gelecek şablondan — görsel davranış aynı kalır.

## Faz 2 — Mobil-Öncelikli Arayüz + PWA

- Responsive geçiş: sekme çubuğu mobilde alta (bottom nav), kartlar tek kolon, dokunma hedefleri büyütülür. Mevcut inline-style tema (`T`, `css`) korunur; sadece kırılım noktaları eklenir.
- `vite-plugin-pwa`: manifest (ad, ikon, tema rengi), service worker — statikler cache-first, `/api/all` network-first + son kopya offline gösterim (salt-okunur offline).
- iOS/Android "Ana ekrana ekle" ile tam ekran uygulama hissi.

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
- **Faz 1**: migrasyon gerçek verinin **kopyasında** test edilir (`cp data/finans.db` → test DATA_DIR); türetilmiş bakiyeler eski `balance` değerleriyle birebir karşılaştırılır; cron üretimi idempotentliği (iki kez tetikle → tek kayıt) test edilir; engine projeksiyon testleri yeni modele uyarlanır.
- **Faz 2**: Lighthouse PWA denetimi; telefonda kurulum + offline açılış elle test.
- **Her faz sonunda**: `data/finans.db` yedeği alınmış olmalı; commit fazın sonunda tek parça.

## Sıralama

Fazlar sıralı; her faz kendi başına çalışan uygulama bırakır. Sıradaki: Faz 1 (ledger veri modeli).
