# Finans — Kişisel Finans Paneli

Tek ekrandan: nakit hesapları, düzenli gelir/giderler (tarih aralıklı), kredi taksitleri, kredi kartları (ekstre/taksit takibi), günlük nakit akışı takvimi ve canlı fiyatlı çok varlıklı portföy (BIST, TEFAS fonları, altın/kıymetli maden, döviz, kripto).

**Mimari:** Node.js (Hono API) + React/Vite + SQLite (Node yerleşik `node:sqlite`, native bağımlılık yok). Tek süreç, tek konteyner. Tüm veri `data/finans.db` dosyasında — yedeklemek için bu dosyayı kopyalamak yeterli.

## Lokal çalıştırma

Gereksinim: Node.js 22+ (`node --version`).

```bash
npm install
npm run dev        # API: 8787, arayüz: http://localhost:5173
```

Üretim modu (tek port):

```bash
npm run build
npm start          # http://localhost:8787
```

## Sunucuya taşıma (Docker)

```bash
docker compose up -d --build
```

Veri `./data` klasöründe kalır; imajı silsen de veri durur. Traefik ile dışarı açacaksan `docker-compose.yml` içindeki label örneğini kullan — **uygulamanın kendi kimlik doğrulaması yok**, ya sadece Tailscale ağından eriş ya da Traefik basic-auth koy.

## Canlı fiyat kaynakları ve dürüst kısıtlar

Fiyatlar 15 dakikada bir otomatik ve "Fiyatları Yenile" butonuyla manuel tazelenir. Kaynaklar resmî API değildir; **best-effort** çalışır ve her sembolün fiyatını arayüzden elle de girebilirsin (elle girilen fiyat `manual` olarak işaretlenir, bir sonraki otomatik tazelemede güncellenir).

| Tür    | Sembol örneği           | Kaynak                                  |
|--------|-------------------------|-----------------------------------------|
| BIST   | `THYAO`, `ASELS`        | Yahoo Finance (`THYAO.IS`), ~15 dk gecikmeli |
| FON    | TEFAS kodu, örn. `AFT`  | TEFAS BindHistoryInfo (son işlem günü fiyatı) |
| ALTIN  | `GRAM`, `CEYREK`, `ONS`, `GUMUS` | truncgil kur servisi (satış fiyatı) |
| DOVIZ  | `USD`, `EUR`, `GBP`     | Yahoo Finance (`USDTRY=X`)              |
| KRIPTO | `BTC`, `ETH`            | Yahoo (`BTC-USD`) × USDTRY              |

Kaynaklardan biri format değiştirirse sadece `server/prices.ts` içindeki ilgili fonksiyon güncellenir; uygulamanın geri kalanı etkilenmez. Banka hesap entegrasyonu Türkiye'de bireysel kullanıcıya açık olmadığından hesap bakiyeleri manuel güncellenir.

## Modelin mantığı

- **Nakit projeksiyonu:** Hesap bakiyeleri toplamı bugünden başlar; düzenli gelir/giderler ayın belirtilen gününde (kısa aylarda ay sonuna kayarak), krediler ilk taksit tarihinden itibaren toplam taksit sayısı kadar, kredi kartı ekstreleri son ödeme tarihinde, tek seferlik kalemler kendi tarihinde işlenir. Kredilerin kalan taksidi tarihten hesaplanır — elle güncelleme gerekmez, biten kredi projeksiyondan kendiliğinden düşer.
- **Nakit takvimi:** Nakit Akışı sekmesinde "takvim" görünümü her günü kutu olarak gösterir: gün sonu nakit, altında Σ ile o günkü toplam varlık (nakit + portföy), eksi günler kırmızı. Bir güne tıklayınca o günün nakit / portföy / toplam varlık kırılımı ve o gün gerçekleşen hareketler açılır. "Liste" görünümü sadece hareketli günleri gösterir.
- **Düzenli gelir/gider değişimi:** Her kalemin opsiyonel başlangıç ve bitiş ayı (YYYY-AA) vardır. Maaşın veya kiran değiştiğinde kalemin yanındaki **Değiştir**'e bas, yeni tutarı ve geçerli olacağı ayı gir: sistem eski kaydı bir önceki ayda otomatik bitirir, yeni kaydı o aydan başlatır. Böylece geçmiş projeksiyon eski tutarla kalır, gelecek yeni tutarla hesaplanır.
- **Kredi kartları:** Kart tanımı (limit, hesap kesim günü, son ödeme günü) + harcamalar (tek çekim veya N taksit). Her harcama kesim gününe göre doğru ekstreye düşer; kesim gününü geçen harcama bir sonraki ekstreye kayar. Taksitler ardışık ekstrelere bölünür. Kart başına güncel borç (bugünden sonra vadesi gelen paylar), kullanılabilir limit ve sıradaki ekstreler gösterilir; toplam kart borcu net varlıktan düşülür. Geçmiş vadeli ekstreler ödendi kabul edilir.
- **Portföy:** Ağırlıklı ortalama maliyet. Satışta gerçekleşen K/Z = adet × (satış − ortalama) − komisyon. Pozisyon tamamen kapanıp yeniden açılırsa maliyet doğru sıfırlanır.
- **Net varlık:** nakit toplamı + Σ(pozisyon adedi × güncel TRY fiyatı) − toplam kart borcu.

> Not: Fiyat geçmişi tutulmadığından takvimdeki geçmiş günlerin portföy değeri de bugünkü fiyatla değerlenir. Gerçek tarihsel değer grafiği için `prices` tablosuna gün gün kayıt eklemek gerekir (yol haritasında).

## Yedekleme

```bash
cp data/finans.db yedek/finans-$(date +%F).db   # hepsi bu
```

Sunucuda cron ile günlük kopya + istersen başka makineye rsync önerilir.

## Yol haritası (henüz yok, bilinçli olarak)

- Hisse işlemlerinin hesap bakiyesini otomatik düşürmesi (şimdilik ayrık: bakiyeyi sen güncelliyorsun)
- Temettü ve bedelli/bedelsiz sermaye artırımı kayıtları
- Gerçekleşen harcamaların kategori bazlı takibi (şu an plan/projeksiyon odaklı)
- CSV içe/dışa aktarma, kayıt düzenleme (şimdilik sil + yeniden ekle)
- Fiyat geçmişi saklayıp portföy değer grafiği çizme (prices tablosuna history eklemek yeterli)
