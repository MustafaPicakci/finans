# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kişisel finans paneli: nakit hesapları, düzenli gelir/gider, kredi taksitleri, kredi kartı ekstreleri, nakit akışı takvimi ve canlı fiyatlı çok varlıklı portföy. Kod tek kullanıcı içindir, uygulama düzeyinde kimlik doğrulama **yoktur** (dışarı açarken Traefik basic-auth / Tailscale şart). UI dili Türkçe; kod içi yorumlar ve enum değerleri de Türkçe (`'ALIŞ'`, `'SATIŞ'`).

pnpm workspace monorepo'dur: `apps/server` (Hono API + SQLite), `apps/web` (React/Vite SPA), `packages/engine` (saf finans matematiği, ikisinin de bağımlı olduğu). Bu yapı bilinçli bir evrimin ilk adımı — hedef roadmap için [docs/PLAN.md](docs/PLAN.md)'a bakın (ledger veri modeli, mobil PWA, dosya importu, auth).

## Komutlar

```bash
pnpm install
pnpm dev            # concurrently: API (tsx watch, :8787) + Vite (:5173, /api proxy'li)
pnpm build          # pnpm -r build — her paket kendi build'ini çalıştırır (web: vite build + tsc; server/engine: tsc --noEmit)
pnpm test           # packages/engine vitest testleri (finans matematiği)
pnpm start          # prod: tek süreç, apps/server apps/web/dist statiklerini de sunar (:8787)
```

Tek bir paketi hedeflemek için `pnpm --filter @finans/server dev`, `pnpm --filter @finans/web build`, `pnpm --filter @finans/engine test` gibi filtreler kullanılır. `pnpm build` CI kapısıdır — her paket temiz geçmeli.

Node.js 22+ gerekir. SQLite native değil, Node yerleşik `node:sqlite` ile gelir; bu yüzden dev/start script'leri `NODE_OPTIONS=--experimental-sqlite` ile çalışır (kaldırma). `apps/web`'de linter yok; `packages/engine`'de vitest var, başka yerde test yok.

Docker: `docker compose up -d --build`. Veri `./data` (konteynerde `/data`, `DATA_DIR` ile) volume'ünde kalır.

## Mimari

pnpm workspace: backend = `apps/server` (Hono + SQLite), frontend = `apps/web` (React/Vite SPA), paylaşılan finans matematiği = `packages/engine` (saf TS, React'e ve Hono'ya bağımlı değil). `apps/web` bu paketi `@finans/engine` olarak import eder (TS kaynağı doğrudan derlenir, ayrı build adımı gerekmez); `apps/server` şu an için tüketmiyor.

### `packages/engine` — saf finans matematiği + tipler
Asıl karmaşıklık burada; React'ten/Hono'dan bağımsız, 46 vitest testiyle korunuyor (`pnpm --filter @finans/engine test`). Yeni bir hesaplama kuralı eklerken önce burada test yaz.
- [types.ts](packages/engine/src/types.ts) — domain tipleri (`AllData`, `Recurring`, `Trade`, ...); `apps/web/src/api.ts` bunları re-export eder.
- [date.ts](packages/engine/src/date.ts) — `hits` (ödeme günü kısa aylarda ay sonuna kayar), `ymOf`/`normYm` (ay biçimi ayrıştırma/doğrulama).
- [projection.ts](packages/engine/src/projection.ts) — `project(data, months)` → günlük `Day[]` nakit projeksiyonu. Hesap bakiyeleri bugünden başlar; recurring/loan/oneoff/kart-ekstresi hareketleri ilgili günlere işlenir.
- [cards.ts](packages/engine/src/cards.ts) — `cardInfos`/`txShares`/`firstCutoff`/`dueOf`: kredi kartı ekstre matematiği. Harcama kesim gününe göre doğru ekstreye düşer, taksitler ardışık ekstrelere bölünür, geçmiş vadeli ekstreler ödenmiş sayılır.
- [loans.ts](packages/engine/src/loans.ts) — `loanRemaining`/`loanActiveOn`: kredinin kalan taksidi tarihten hesaplanır (elle güncelleme yok).
- [portfolio.ts](packages/engine/src/portfolio.ts) — `positions(trades, prices)` → ağırlıklı ortalama maliyetli portföy; pozisyon kapanıp yeniden açılınca maliyet sıfırlanır.
- [recurring.ts](packages/engine/src/recurring.ts) — `recActiveOn`: `from_month`/`to_month` aralığına göre aktiflik.

### Backend (`apps/server/`)
- [db.ts](apps/server/db.ts) — Tüm şema `CREATE TABLE IF NOT EXISTS` ile burada. Migrasyon deseni: dosya sonunda `PRAGMA table_info` ile kolon var mı diye bakıp `ALTER TABLE ... ADD COLUMN` çalıştır. Yeni kolon eklerken bu deseni izle, mevcut DB'ler bozulmasın. Tek `db` instance export edilir. `DATA_DIR` verilmemişse veri dizini `import.meta.dirname` ile repo köküne göre bulunur (cwd'den bağımsız — pnpm filter/Docker/doğrudan çalıştırma hepsinde aynı `data/finans.db`'yi bulur).
- [index.ts](apps/server/index.ts) — Hono rotaları. Tüm okuma **tek** `GET /api/all` ucundan (frontend her mutasyon sonrası hepsini yeniden çeker). Yazma tarafı `crud(route, table, cols)` fabrikasıyla üretilir — yeni bir tablo için CRUD eklemek çoğu zaman tek `crud(...)` çağrısıdır. Fiyat ve ayar uçları elle yazılmıştır. Prod'da `serveStatic` ile `apps/web/dist` sunulur (yol `apps/server`'a göre relatif — server her zaman pnpm filter ile kendi dizininden çalıştırılmalı). `node-cron` her 15 dk `refreshAll()` çağırır.
- [prices.ts](apps/server/prices.ts) — Best-effort fiyat çekme. Her varlık türü (`BIST`/`FON`/`ALTIN`/`DOVIZ`/`KRIPTO`/`ETF`) için ayrı fonksiyon; bir kaynak formatını değiştirirse **sadece** ilgili fonksiyon güncellenir. `refreshAll()` yalnızca `trades` tablosunda tutulan sembolleri tazeler, `prices` tablosuna `source='auto'` ile upsert eder. Elle girilen fiyatlar `source='manual'`. `ETF` (VOO, QQQ... yurt dışı borsa) Yahoo'dan sorunsuz çekilir. **`FON` (TEFAS)**: resmi API bot-koruması arkasında olduğundan RapidAPI'deki resmi olmayan bir aracı (`RAPIDAPI_KEY` env değişkeni, `.env.example`'a bakın) kullanılır — tek fon sorgusu yok, fon türü başına (1-5) tüm liste çekilip filtrelenir; NAV günde bir hesaplandığından `settings.tefas_last_fetch` ile günde bir kez çağrılır (ücretsiz kota sınırlı). Anahtar yoksa/kota dolarsa fonlar elle fiyatlanır (Portföy sekmesinde rozet+sıfırla).

### Frontend (`apps/web/src/`)
- [App.tsx](apps/web/src/App.tsx) — Kabuk: tab yönetimi + üst net varlık özeti. Finans matematiğini `@finans/engine`'den import eder.
- [theme.ts](apps/web/src/theme.ts) — `T` tema tokenları, `css` stil nesnesi, `tl`/`tl2` para formatlayıcıları, `TYPE_COLORS`/`TYPE_HINT`.
- [ui/](apps/web/src/ui/index.tsx) — Küçük paylaşılan bileşenler: `Field`, `Money`, `Row`, `Empty`, `Center`.
- [features/](apps/web/src/features/) — Tab başına klasör: `ozet`, `nakit` (liste + takvim görünümü), `butce`, `borc`, `kart`, `portfoy`. Her biri kendi `index.tsx`'i, `@finans/engine`'den saf fonksiyonları/tipleri import eder.
- [api.ts](apps/web/src/api.ts) — HTTP istemcisi; domain tipleri `@finans/engine`'den re-export eder.

### Veri modeli notları
- **Fiyat geçmişi tutulmaz.** `prices` her sembol için tek güncel satır (`PRIMARY KEY (symbol, asset_type)`). Takvimdeki geçmiş günlerin portföy değeri de bugünkü fiyatla değerlenir.
- **Düzenli gelir/gider değişimi** `from_month`/`to_month` (`'YYYY-MM'`, dahil) ile modellenir: tutar değişince eski kayıt bir önceki ayda bitirilir, yeni kayıt o aydan başlatılır — geçmiş projeksiyon bozulmaz.
- **Kredinin kalan taksidi** `first_date` + `total`'dan tarihe göre hesaplanır; biten kredi projeksiyondan kendiliğinden düşer.
- Net varlık = nakit toplamı + Σ(pozisyon × güncel TRY fiyat) − toplam kart borcu.
- Kayıt düzenleme çoğunlukla yok; sil + yeniden ekle modeli. Hisse işlemleri hesap bakiyesini otomatik düşürmez (bakiye elle güncellenir).

Kapsamlı iş kuralları ve yol haritası için [README.md](README.md) (Türkçe) tek gerçek kaynaktır.
