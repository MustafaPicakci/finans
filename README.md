# Finans — Kişisel Finans Paneli

Tek ekrandan: nakit hesapları, düzenli gelir/giderler (tarih aralıklı), kredi taksitleri, kredi kartları (ekstre/taksit takibi), günlük nakit akışı takvimi ve canlı fiyatlı çok varlıklı portföy (BIST, TEFAS fonları, altın/kıymetli maden, döviz, kripto, yurt dışı borsa ETF'leri).

**Mimari:** pnpm monorepo — `apps/server` (Hono API), `apps/web` (React/Vite), `packages/engine` (paylaşılan finans matematiği) + **PostgreSQL** (Faz 5.0'da `node:sqlite`'tan geçildi; SaaS'a evrim için — bkz. [docs/PLAN.md](docs/PLAN.md)). Bağlantı `DATABASE_URL` ile verilir (`apps/server/.env.example`). Hedef roadmap için [docs/PLAN.md](docs/PLAN.md).

## Lokal çalıştırma

Gereksinim: Node.js 22+ (`node --version`), pnpm (`corepack enable` ile gelir), erişilebilir bir PostgreSQL (yerelde en kolayı Docker: `docker run -d --name pg -e POSTGRES_PASSWORD=1 -e POSTGRES_DB=finans -p 5432:5432 postgres:16`).

`apps/server/.env` içine `DATABASE_URL` yaz (`.env.example`'ı kopyala). Eski SQLite verin varsa bir kez taşı: `pnpm --filter @finans/server migrate`.

```bash
pnpm install
pnpm dev        # API: 8787, arayüz: http://localhost:5173
```

Üretim modu (tek port):

```bash
pnpm build
pnpm start      # http://localhost:8787
```

## Sunucuya taşıma (Docker)

```bash
docker compose up -d --build
```

Compose iki servis çalıştırır: `db` (PostgreSQL, veri `./data/pg` volume'ünde — imajı silsen de veri durur) + `finans` (uygulama, `db`'ye bağlanır). Uygulamanın **kendi kimlik doğrulaması var** (scrypt + server-side session; tüm `/api` giriş ister).

### Kayıt / giriş (çok-kullanıcı)

Kayıt herkese açıktır ve **e-posta doğrulaması zorunludur**:

- **İlk kullanıcı = owner**: otomatik doğrulanır, mevcut (sahipsiz) veriyi devralır ve doğrudan giriş yapar.
- **Sonraki kullanıcılar**: kayıt sonrası e-postalarına gönderilen aktivasyon bağlantısına tıklamalıdır; doğrulanana kadar giriş engellenir. Bağlantı gelmediyse giriş ekranından **"Doğrulama e-postasını tekrar gönder"** ile yenisi istenebilir (24 saat geçerli).
- Her kullanıcının verisi `user_id` ile izole; piyasa fiyatları (`prices`) global paylaşılır.

> **Önemli:** Çok-kullanıcı için **çalışan SMTP** şarttır (`apps/server/.env.example`'daki `SMTP_HOST/PORT/USER/PASS` + `APP_URL`). SMTP yapılandırılmazsa aktivasyon e-postası gönderilemez ve owner dışındaki kullanıcılar giriş yapamaz (uygulama açılışta uyarı loglar). Geliştirmede SMTP boşsa aktivasyon bağlantısı sunucu konsoluna yazılır.
>
> **Prod'da Gmail SMTP yeterli değil:** Gmail gönderimi kabul etse de (`250 OK`), aktivasyon postası "hesabını aktive et + buton + başka siteye link" kalıbında olduğundan alıcı sunucular tarafından phishing sayılıp sessizce düşürülebilir — pratikte kurumsal alan adlarına ulaşmadı. Gerçek kullanıcı almadan önce bir transactional sağlayıcıya geç (**Resend / Brevo / Postmark**), kendi domain'ini doğrula (**SPF + DKIM**, tercihen DMARC) ve `MAIL_FROM`'u o domain'den ver (`no-reply@<domain>`). Kod değişmez — [mail.ts](apps/server/mail.ts) generic SMTP olduğu için yalnız env değişir.

## Canlı fiyat kaynakları ve dürüst kısıtlar

Fiyatlar 15 dakikada bir otomatik ve "Fiyatları Yenile" butonuyla manuel tazelenir. Kaynaklar resmî API değildir; **best-effort** çalışır ve her sembolün fiyatını arayüzden elle de girebilirsin (elle girilen fiyat `manual` olarak işaretlenir, bir sonraki otomatik tazelemede güncellenir).

| Tür    | Sembol örneği           | Kaynak                                  |
|--------|-------------------------|-----------------------------------------|
| BIST   | `THYAO`, `ASELS`        | Yahoo Finance (`THYAO.IS`), ~15 dk gecikmeli |
| FON    | TEFAS kodu, örn. `AFT`  | RapidAPI `tefas-api` (resmi değil — TEFAS'ın kendi API'si bot korumasının arkasında). `RAPIDAPI_KEY` env değişkeni gerekir (bkz. `apps/server/.env.example`), opsiyonel `RAPIDAPI_KEY_2` kota dolunca otomatik devreye girer. Anahtar yoksa/kota dolarsa elle girilir. NAV günde bir hesaplandığından günde bir kez çekilir. |
| ALTIN  | `GRAM`, `CEYREK`, `ONS`, `GUMUS` | truncgil kur servisi (satış fiyatı) |
| DOVIZ  | `USD`, `EUR`, `GBP`     | Yahoo Finance (`USDTRY=X`)              |
| KRIPTO | `BTC`, `ETH`            | Yahoo (`BTC-USD`), USD birimliyse ham USD saklanır |
| ETF    | `VOO`, `QQQ`, `AAPL`… (ABD/global borsa hisse & ETF) | Yahoo Finance (doğrudan sembol), USD birimliyse ham USD saklanır |

Kaynaklardan biri format değiştirirse sadece `apps/server/prices.ts` içindeki ilgili fonksiyon güncellenir; uygulamanın geri kalanı etkilenmez. Banka hesap entegrasyonu Türkiye'de bireysel kullanıcıya açık olmadığından hesap bakiyeleri manuel güncellenir.

**Para birimi (TRY + USD):** Her portföy işlemi bir para biriminde girilir (varsayılan: KRIPTO/ETF → USD, diğerleri → TRY); USD varlıkların maliyeti/değeri/kâr-zararı kendi biriminde (native) tutulur, TRY'ye çevrilmez. Üst çubuktaki **₺ / $** düğmesiyle net varlık özeti ve KPI kartları seçili para biriminde gösterilir (güncel USD/TRY kuruyla; Nakit Akışı ve Rapor TRY kalır). TRY tabandır; kur her fiyat tazelemesinde güncellenir.

## Modelin mantığı

- **Nakit projeksiyonu:** Hesap bakiyeleri toplamı bugünden başlar; düzenli gelir/giderler ayın belirtilen gününde (kısa aylarda ay sonuna kayarak), krediler ilk taksit tarihinden itibaren toplam taksit sayısı kadar, kredi kartı ekstreleri son ödeme tarihinde, tek seferlik kalemler kendi tarihinde işlenir. Kredilerin kalan taksidi tarihten hesaplanır — elle güncelleme gerekmez, biten kredi projeksiyondan kendiliğinden düşer.
- **Nakit takvimi:** Nakit Akışı sekmesinde "takvim" görünümü her günü kutu olarak gösterir: **etkin nakit** (nakit + para piyasası fonu), altında Σ ile o günkü toplam varlık, eksi günler kırmızı. Para piyasası (likit) fonları nakit kadar erişilebilir olduğundan nakit gibi sayılır; bir fonu bu kapsama almak için **Portföy** sekmesinde o fonun satırındaki **"nakit say"** düğmesine bas (opt-in — uygulama bir fonun likit mi hisse mi olduğunu bilemez). Bir güne tıklayınca etkin nakit / gün sonu nakit / para piyasası fonu / diğer portföy / toplam varlık kırılımı ve o gün gerçekleşen hareketler (günün neden eksi/artı olduğu) açılır. "Liste" görünümü sadece hareketli günleri gösterir.
- **Düzenli gelir/gider değişimi:** Her kalemin opsiyonel başlangıç ve bitiş ayı (YYYY-AA) vardır. Maaşın veya kiran değiştiğinde kalemin yanındaki **Değiştir**'e bas, yeni tutarı ve geçerli olacağı ayı gir: kayıt bölünmez — kalem tek satır kalır, yeni tutar seçilen aydan itibaren geçerli olacak şekilde kalemin tutar zaman çizelgesine eklenir. Geçmiş projeksiyon eski tutarla kalır, gelecek yeni tutarla hesaplanır; planlı bir değişiklik listede "↗ … itibarıyla …" ipucuyla görünür ve ✕ ile geri alınabilir.
- **Kredi kartları:** Kart tanımı (limit, hesap kesim günü, son ödeme günü) + harcamalar (tek çekim veya N taksit). Her harcama kesim gününe göre doğru ekstreye düşer; kesim gününü geçen harcama bir sonraki ekstreye kayar. Taksitler ardışık ekstrelere bölünür. Kart başına güncel borç (bugünden sonra vadesi gelen paylar), kullanılabilir limit ve sıradaki ekstreler gösterilir; toplam kart borcu net varlıktan düşülür. Geçmiş vadeli ekstreler ödendi kabul edilir.
- **Portföy:** Ağırlıklı ortalama maliyet, her pozisyon kendi para biriminde. Satışta gerçekleşen K/Z = adet × (satış − ortalama) − komisyon. Pozisyon tamamen kapanıp yeniden açılırsa maliyet doğru sıfırlanır. İşlemi girerken **opsiyonel olarak bir nakit hesap** seçebilirsin: seçersen ALIŞ o hesaptan düşer, SATIŞ ekler (kayıt silinince geri alınır); seçmezsen portföy ve nakit ayrık kalır, bakiyeyi sen güncellersin.
- **Değer grafiği:** Portföy değerinin seyri, üstteki **1H / 1A / 3A / 6A / 1Y / Tümü** düğmeleriyle istediğin pencerede görünür; başlıkta o dönemin değişimi hem tutar hem yüzde olarak yazar (yükselişte yeşil, düşüşte kırmızı — grafik de o renge boyanır). Aynı grafik Özet'te tüm portföy için, Portföy sekmesinde ise **seçili portföy grubu** için gösterilir. Dürüst kısıt: fiyat geçmişi günde bir anlık görüntü tuttuğundan en küçük çözünürlük **gündür** — aralık düğmeleri pencereyi daraltır, gün içi veri üretmez; fiyat çekmeye başlamadan önceki günler grafikte hiç yoktur (geriye dönük uydurma veri yok).
- **Hareketler (işlem geçmişi):** Portföy sekmesinin altındaki liste her alış/satışı, o işlemin **pozisyona etkisiyle** birlikte gösterir: adet 10 → 20, ortalama maliyet ₺100 → ₺150; satışlarda gerçekleşen K/Z ve pozisyon tamamen kapandıysa "pozisyon kapandı" işareti. Sembol, varlık türü, alış/satış ve dönem (3 ay / 6 ay / 1 yıl / tümü) filtrelenebilir; üstteki özet seçili aralık için toplam alış, satış, komisyon ve gerçekleşen K/Z'yi verir (TRY ve USD ayrı toplanır — işlem anındaki kur bilinmediğinden karıştırmak yanıltıcı olurdu). Bir pozisyon satırındaki sembole tıklayınca yalnız o varlığın hareketleri süzülür. Filtreler yalnız *görünen* satırları kısar; ortalama maliyet her zaman tüm geçmişten hesaplanır.
- **Portföy grupları:** Varlıklarını mantıksal kaplara ayırabilirsin (ör. *Alfa Portföy*, *Emeklilik*, *Büyüme*). Gruplama **işlem düzeyindedir**: her alış/satış bir portföye (ya da hiçbirine — *Gruplanmamış*) aittir, bu yüzden **aynı sembolü iki portföyde ayrı ortalama maliyetle** tutabilirsin (farklı kurum/strateji). Portföy sekmesinin üstündeki şeritten grup seçince pozisyonlar, K/Z ve işlem geçmişi yalnız o grup için hesaplanır; "Tümü" birleşik görünümdür. Mevcut bir işlemi geçmiş listesindeki açılır menüden başka gruba taşıyabilirsin (yalnız gruplama değişir, tutar/bakiye etkilenmez). Grubu silmek işlemleri silmez — *Gruplanmamış*'a döner. **Net varlık, alokasyon ve nakit projeksiyonu gruplardan etkilenmez**; bu tamamen takip/raporlama katmanıdır.
- **Gelir/gider girişi (tek "+ Ekle" akışı):** Tarih bugün veya geçmişse *gerçekleşen* kayıt olur — bir hesap seçtiysen o hesabın bakiyesi anında değişir (gider düşer, gelir artar; kayıt silinince geri alınır), kategori seçtiysen Rapor'a girer. Hesap seçmezsen kayıt yalnızca Rapor'a girer, bakiyeye dokunmaz. Tarih ileriyse *plan* kalemi olur ve nakit projeksiyonuna girer; günü gelince Plan'daki **Gerçekleşti** ile tek tıkla deftere geçirip bakiyeye işlersin.
- **Toplu içe aktarma:** Banka ekstreni/tablonu (Excel'den kopyala-yapıştır, CSV, sekmeyle ayrılmış metin) "+ Ekle → İçe aktar" ekranına yapıştır: satırlar tarih/açıklama/tutar olarak çözülür (TR ve US tutar biçimi, bakiye sütunu varsa tutarın işareti bakiye yönünden çıkarılır), önizlemede her satırı düzeltebilir/çıkarabilirsin, kategori geçmişindeki benzer kayıtlardan tahmin edilir ve aynı gün+tutar zaten defterdeyse satır **olası kopya** diye işaretlenir. Onaylayınca tamamı tek atomik işlemde yazılır (en fazla 500 satır) — hepsi geçer ya da hiçbiri.
- **Hesap hareketleri:** Her nakit hesabın bir **hareket defteri** vardır: bakiyeyi oynatan her şey (gelir/gider kaydı, kart ekstresi ödemesi, düzenli kalem gerçekleştirme, portföy alış-satışı, vadeli mevduat açılışı, hatta bakiyeyi elle düzeltmen) oraya bir satır yazar. Hesaplar sekmesinde bir hesabın **Hareketler** düğmesine basınca tarih, açıklama, tutar ve **o hareketten sonraki bakiye** görünür. Değişmez kural: **hesabın bakiyesi = hareketlerinin toplamı** (açılış bakiyesi de bir harekettir) — bu yüzden "bakiyem neden tuttu/tutmadı" sorusunun cevabı artık listede duruyor. Defter bakiyeyi açıklayamazsa uygulama farkı gizlemez, uyarı olarak gösterir. Hareketler kaynaklarından yönetilir (silme/düzenleme ilgili kayıttan yapılır); bir kaydı silmek veya düzenlemek hareketini de düzeltir.
- **Kayıt düzenleme:** Gerçekleşen gelir/gider (Rapor), plan kalemi (Plan), kart harcaması (Kartlar) ve portföy işlemi (Portföy → Hareketler) satırlarındaki **✎** ile düzenlenir; form "+ Ekle"dekinin aynısıdır, önden dolu gelir. Hesaba bağlı bir kaydı düzenlersen **bakiye otomatik düzeltilir**: eski tutarın etkisi eski hesaptan geri alınır, yenisi yeni hesaba işlenir — hepsi tek atomik işlemde, yani hesabı da değiştirebilirsin. Düzenleme kaydın türünü değiştirmez: gerçekleşen kayıt gerçekleşen kalır, plan kalemi plan kalemi (plan → defter geçişi Plan'daki "Gerçekleşti" düğmesidir). Tanım kayıtları (hesap, kart, kredi, kategori, düzenli kalem) ve vadeli mevduat hâlâ sil + yeniden ekle ile değişir — düzenli kalemin tutarı için "Değiştir" akışı vardır.
- **Net varlık:** nakit toplamı + Σ(pozisyon adedi × güncel TRY fiyatı) − toplam kart borcu − kalan kredi borcu (Σ aylık taksit × kalan taksit sayısı).

> Not: Fiyat geçmişi tutulmadığından takvimdeki geçmiş günlerin portföy değeri de bugünkü fiyatla değerlenir. Gerçek tarihsel değer grafiği için `prices` tablosuna gün gün kayıt eklemek gerekir (yol haritasında).

## Yedekleme

```bash
pg_dump "$DATABASE_URL" > yedek/finans-$(date +%F).sql        # tek dosya döküm
# Docker compose ile: docker exec finans-db pg_dump -U postgres finans > yedek/finans-$(date +%F).sql
```

Geri yükleme: `psql "$DATABASE_URL" < yedek/finans-YYYY-AA-GG.sql`. Sunucuda cron ile günlük `pg_dump` + istersen başka makineye rsync önerilir.

## Yol haritası (henüz yok, bilinçli olarak)

- Temettü ve bedelli/bedelsiz sermaye artırımı kayıtları
- Tanım kayıtlarının (hesap/kart/kredi/kategori/mevduat) düzenlenmesi — işlem kayıtları düzenlenebiliyor, bunlar hâlâ sil + yeniden ekle
- Dışa aktarma (içe aktarma var; dışa aktarım şimdilik yalnız KVKK veri indirme ucundan)
- Portföy işlemlerinin hesap bakiyesini **otomatik** düşürmesi (şu an isteğe bağlı: işlemi bir nakit hesaba bağlarsan işler, bağlamazsan bakiyeyi sen güncellersin)
- Gün içi (intraday) fiyat geçmişi — şu an günde bir anlık görüntü alınır, grafiğin çözünürlüğü gündür
