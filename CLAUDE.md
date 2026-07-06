# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kişisel finans paneli: nakit hesapları, düzenli gelir/gider, kredi taksitleri, kredi kartı ekstreleri, nakit akışı takvimi ve canlı fiyatlı çok varlıklı portföy. Kod tek kullanıcı içindir, uygulama düzeyinde kimlik doğrulama **yoktur** (dışarı açarken Traefik basic-auth / Tailscale şart). UI dili Türkçe; kod içi yorumlar ve enum değerleri de Türkçe (`'ALIŞ'`, `'SATIŞ'`).

## Komutlar

```bash
npm install
npm run dev      # concurrently: API (tsx watch, :8787) + Vite (:5173, /api proxy'li)
npm run build    # vite build → dist/, ardından tsc --noEmit ile tip kontrolü
npm start        # prod: tek süreç, API dist/ statiklerini de sunar (:8787)
npm run build    # test/lint yok — CI kapısı budur: tsc temiz geçmeli
```

Node.js 22+ gerekir. SQLite native değil, Node yerleşik `node:sqlite` ile gelir; bu yüzden hem dev hem prod script'i `NODE_OPTIONS=--experimental-sqlite` ile çalışır (kaldırma). Test framework'ü, linter yoktur.

Docker: `docker compose up -d --build`. Veri `./data` (konteynerde `/data`, `DATA_DIR` ile) volume'ünde kalır.

## Mimari

Tek süreç, tek konteyner. Backend = Hono API + SQLite; frontend = React/Vite SPA. İkisi arasında paylaşılan kod yok — tipler her iki tarafta ayrı tanımlı ([src/api.ts](src/api.ts) ve DB şeması).

### Backend (`server/`)
- [server/db.ts](server/db.ts) — Tüm şema `CREATE TABLE IF NOT EXISTS` ile burada. Migrasyon deseni: dosya sonunda `PRAGMA table_info` ile kolon var mı diye bakıp `ALTER TABLE ... ADD COLUMN` çalıştır. Yeni kolon eklerken bu deseni izle, mevcut DB'ler bozulmasın. Tek `db` instance export edilir.
- [server/index.ts](server/index.ts) — Hono rotaları. Tüm okuma **tek** `GET /api/all` ucundan (frontend her mutasyon sonrası hepsini yeniden çeker). Yazma tarafı `crud(route, table, cols)` fabrikasıyla üretilir — yeni bir tablo için CRUD eklemek çoğu zaman tek `crud(...)` çağrısıdır. Fiyat ve ayar uçları elle yazılmıştır. Prod'da `serveStatic` ile `dist/` sunulur. `node-cron` her 15 dk `refreshAll()` çağırır.
- [server/prices.ts](server/prices.ts) — Best-effort fiyat çekme. Her varlık türü (`BIST`/`FON`/`ALTIN`/`DOVIZ`/`KRIPTO`) için ayrı fonksiyon; bir kaynak formatını değiştirirse **sadece** ilgili fonksiyon güncellenir. `refreshAll()` yalnızca `trades` tablosunda tutulan sembolleri tazeler, `prices` tablosuna `source='auto'` ile upsert eder. Elle girilen fiyatlar `source='manual'`.

### Frontend (`src/App.tsx`, ~1000 satır tek dosya)
Tüm uygulama tek dosyada. Yapı önemli:

1. **Saf finans matematiği (dosyanın üst yarısı, React'ten bağımsız fonksiyonlar)** — asıl karmaşıklık burada, değiştirirken dikkat:
   - `project(data, months)` → günlük `Day[]` nakit projeksiyonu üretir. Hesap bakiyeleri bugünden başlar; recurring/loan/oneoff/kart-ekstresi hareketleri ilgili günlere işlenir.
   - `cardInfos` / `txShares` / `firstCutoff` / `dueOf` — kredi kartı ekstre matematiği. Harcama kesim gününe göre doğru ekstreye düşer, taksitler ardışık ekstrelere bölünür, geçmiş vadeli ekstreler ödenmiş sayılır.
   - `positions(trades, prices)` — ağırlıklı ortalama maliyetli portföy; pozisyon kapanıp yeniden açılınca maliyet sıfırlanır.
   - `recActiveOn` / `loanRemaining` — kredinin kalan taksidi ve recurring'in geçerlilik ayı tarihten hesaplanır (elle güncelleme yok).
2. **Tab bileşenleri** — `Ozet`, `Nakit` (liste + takvim görünümü), `Butce`, `Borc`, `Kart`, `Portfoy`. Küçük paylaşılan UI parçaları (`Field`, `Money`, `Row`, `Empty`) ve `T` tema nesnesi de aynı dosyada.

### Veri modeli notları
- **Fiyat geçmişi tutulmaz.** `prices` her sembol için tek güncel satır (`PRIMARY KEY (symbol, asset_type)`). Takvimdeki geçmiş günlerin portföy değeri de bugünkü fiyatla değerlenir.
- **Düzenli gelir/gider değişimi** `from_month`/`to_month` (`'YYYY-MM'`, dahil) ile modellenir: tutar değişince eski kayıt bir önceki ayda bitirilir, yeni kayıt o aydan başlatılır — geçmiş projeksiyon bozulmaz.
- **Kredinin kalan taksidi** `first_date` + `total`'dan tarihe göre hesaplanır; biten kredi projeksiyondan kendiliğinden düşer.
- Net varlık = nakit toplamı + Σ(pozisyon × güncel TRY fiyat) − toplam kart borcu.
- Kayıt düzenleme çoğunlukla yok; sil + yeniden ekle modeli. Hisse işlemleri hesap bakiyesini otomatik düşürmez (bakiye elle güncellenir).

Kapsamlı iş kuralları ve yol haritası için [README.md](README.md) (Türkçe) tek gerçek kaynaktır.
