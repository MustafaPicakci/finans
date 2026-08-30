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

> **Önemli:** Çok-kullanıcı için **çalışan bir e-posta yolu** şarttır (+ `APP_URL`). Yapılandırılmazsa aktivasyon e-postası gönderilemez ve owner dışındaki kullanıcılar giriş yapamaz (uygulama açılışta uyarı loglar). Geliştirmede yol boşsa aktivasyon bağlantısı sunucu konsoluna yazılır.

### E-posta gönderim yolu (Faz 28)

Yol **açıkça** seçilir: `MAIL_PROVIDER` = `smtp` (varsayılan) · `gmail` · `resend`. Seçilen yolun env'leri eksikse sunucu açılışta hangi değişkenin eksik olduğunu söyler. Ayrıntılı env örnekleri: [`apps/server/.env.example`](apps/server/.env.example).

| Yol | Port | Domain ister mi | Kime ulaşır |
|---|---|---|---|
| `smtp` | 587/465 | hayır | herkese — **ama PaaS'te port kapalı olabilir** |
| `gmail` | 443 | hayır | herkese |
| `resend` | 443 | evet (domainsiz kullanılabilir ama…) | domain varsa herkese; **yoksa yalnız kendi adresine** |

> **PaaS'te SMTP çalışmaz — bu bir ayar hatası değildir.** Render, **ücretsiz** web servislerinde giden SMTP portlarını (25/465/587) Eylül 2025'ten beri engelliyor (port 25 tüm planlarda kapalı, EC2 üzerinde çalıştıkları için). Log'da yalnız `connection timeout` görünür ve saatlerce parola/host denenir — hiçbiri çözmez. Kod bu ipucunu artık açıkça loglar. Çözüm: `MAIL_PROVIDER=gmail` ya da `resend` (ikisi de 443), veya ücretli Render planı (465/587 açılır).

**Hangisini seçmeli:**

- **Kendi domain'in varsa → `resend`.** En iyi teslim edilebilirlik. Domain'i Resend'de doğrula (DKIM + SPF, tercihen DMARC), `MAIL_FROM="Finans <no-reply@<domain>>"` ver. Ücretsiz katman 3.000 posta/ay, 100/gün.
- **Domain'in yoksa → `gmail`.** Posta Google'ın kendi sunucusundan çıkar, DKIM/SPF hizalanır, **herkese ulaşır**. Kurulum: [`scripts/gmail-token.mjs`](apps/server/scripts/gmail-token.mjs) başındaki yorum → `pnpm --filter @finans/server gmail-token`.
  - Yetki `gmail.send` ile sınırlıdır: uygulama posta kutusunu **okuyamaz**. Uygulama parolasından (tüm kutuya SMTP+IMAP erişimi) daha dar bir yetkidir.
  - ⚠️ OAuth ekranını Google Cloud'da **"In Production"a al**. "Testing"de kalırsa Google refresh token'ı **7 günde bir** iptal eder ve gönderim sessizce durur. Yayınlamak, doğrulanmış bir domain üzerinde ana sayfa + gizlilik politikası + kullanım koşulları ister (uygulama bu iki sayfayı `/gizlilik` ve `/kosullar` adreslerinde sunar).
  - ⚠️ Bedeli: şahsi adresin kaydolan herkese görünür, günlük sınır 500 alıcı, ve şahsi Gmail transactional gönderim için tasarlanmadığından hesap işaretlenebilir.
- **`resend`'i domainsiz kullanma tuzağı:** `MAIL_FROM` boşken Resend'in paylaşımlı test göndereni (`onboarding@resend.dev`) devreye girer ve postalar **yalnız Resend hesabının kendi adresine** ulaşır. Şifre sıfırlama için yeter, **başka kullanıcıyı aktive etmeye yetmez** — "çalışıyor" görünüp çok-kullanıcılı akışı sessizce bozar. Uygulama bunu açılışta uyarı olarak söyler.

> **Şahsi Gmail'den gönderimin bilinen riski:** aktivasyon postası "hesabını aktive et + buton + başka siteye link" kalıbında olduğundan alıcı sunucular phishing sayıp sessizce düşürebilir — pratikte kurumsal bir alan adına ulaşmadı. Gerçek kullanıcı almadan önce kendi domain'ine geçmek en sağlamı; kod değişmez, yalnız `MAIL_PROVIDER` + `MAIL_FROM` değişir.

### Yasal sayfalar (Faz 28)

`/gizlilik` ve `/kosullar` — [`apps/web/public/`](apps/web/public/) altında duran, React'ten bağımsız statik sayfalar. **Auth guard'ının dışındadırlar**: gizlilik politikası giriş yapmadan okunabilmeli (Google OAuth doğrulaması da anonim çeker). Temiz URL için [index.ts](apps/server/index.ts)'te açık rota tanımlıdır — `serveStatic({root})` uzantısız yolu bulamaz ve istek SPA catch-all'una düşerdi. Ayrıca `navigateFallbackDenylist` ile service worker'ın bu adreslere `index.html` döndürmesi engellenir (yoksa PWA yüklemiş kullanıcıda sayfalar görünmez olurdu).

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
- **Grafiğin iki modu (kâr mı, para ekleme mi?):** `Değer` modunda değer eğrisinin altında kesikli bir **"yatırdığın para"** çizgisi vardır (alışlar ekler; satış ve temettü çıkarır). Eğri bunun üstündeyse kârdasın, altındaysa zarardasın — yani grafiğin yükselmesi tek başına kazandığın anlamına gelmez, o ay para da eklemiş olabilirsin. Dönem özeti bunu ayırır: **kâr/zarar** ve **yatırdığın/çektiğin para**. `Getiri %` modunda her seri pencerenin ilk gününde 0'dan başlar; portföy çizgisi **TWR**'dir (para giriş-çıkışının etkisi arındırılır, geriye yalnız yatırım kararlarının getirisi kalır), varlık çizgileri ise **saf fiyat getirisidir** (üstüne alım yapman o çizgiyi yükseltmez). Grafiğin üstündeki çiplerden varlıkları ve **referansları** (BIST 100, S&P 500, NASDAQ, gram altın, dolar) tek tek açıp kapatabilirsin; referanslar kesikli çizilir ve **hepsi TL cinsindendir** (dolar bazlı endeksler o günün kuruyla çevrilir), çünkü portföyün TL tabanlı — soru "S&P 500 yerine TL'mi orada tutsaydım ne olurdu"dur. Dürüst kısıt: fiyatı bilinmeyen açık pozisyonun olduğu günler hiç çizilmez (eksik değerlenmiş bir toplam ertesi gün sahte bir sıçrama gibi okunurdu); kaç günün düştüğü grafiğin altında yazar.
- **Geçmişi geriye doldurma:** Fiyat geçmişi normalde yalnız uygulama çalıştığı günden itibaren birikir; bu yüzden uygulama **açılışta ve günde bir kez** tuttuğun **BIST / ETF / kripto / döviz** sembollerinin ve referans endekslerin 2 yıllık günlük geçmişini Yahoo'dan kendiliğinden doldurur — yeni bir sunucuya kurduğunda elle bir şey yapman gerekmez, sonradan aldığın bir sembolün geçmişi de ertesi gün tamamlanır. (İstersen hemen tetiklemek için: `POST /api/prices/backfill`, gövde `{"range":"2y"}`.) **TEFAS fonları ve altın kapsam dışıdır** (kaynakları geçmiş vermiyor), bu yüzden portföy *toplamı* yine kısa kalır — uzayan şey tek tek varlık serileri ve referans karşılaştırmasıdır.
- **Değer grafiği:** Portföy değerinin seyri, üstteki **1H / 1A / 3A / 6A / 1Y / Tümü** düğmeleriyle istediğin pencerede görünür; başlıkta o dönemin değişimi hem tutar hem yüzde olarak yazar (yükselişte yeşil, düşüşte kırmızı — grafik de o renge boyanır). Aynı grafik Özet'te tüm portföy için, Portföy sekmesinde ise **seçili portföy grubu** için gösterilir. Dürüst kısıt: fiyat geçmişi günde bir anlık görüntü tuttuğundan en küçük çözünürlük **gündür** — aralık düğmeleri pencereyi daraltır, gün içi veri üretmez; fiyat çekmeye başlamadan önceki günler grafikte hiç yoktur (geriye dönük uydurma veri yok).
- **Hareketler (işlem geçmişi):** Portföy sekmesinin altındaki liste her alış/satışı, o işlemin **pozisyona etkisiyle** birlikte gösterir: adet 10 → 20, ortalama maliyet ₺100 → ₺150; satışlarda gerçekleşen K/Z ve pozisyon tamamen kapandıysa "pozisyon kapandı" işareti. Sembol, varlık türü, alış/satış ve dönem (3 ay / 6 ay / 1 yıl / tümü) filtrelenebilir; üstteki özet seçili aralık için toplam alış, satış, komisyon ve gerçekleşen K/Z'yi verir (TRY ve USD ayrı toplanır — işlem anındaki kur bilinmediğinden karıştırmak yanıltıcı olurdu). Bir pozisyon satırındaki sembole tıklayınca yalnız o varlığın hareketleri süzülür. Filtreler yalnız *görünen* satırları kısar; ortalama maliyet her zaman tüm geçmişten hesaplanır.
- **Portföy grupları:** Varlıklarını mantıksal kaplara ayırabilirsin (ör. *Alfa Portföy*, *Emeklilik*, *Büyüme*). Gruplama **işlem düzeyindedir**: her alış/satış bir portföye (ya da hiçbirine — *Gruplanmamış*) aittir, bu yüzden **aynı sembolü iki portföyde ayrı ortalama maliyetle** tutabilirsin (farklı kurum/strateji). Portföy sekmesinin üstündeki şeritten grup seçince pozisyonlar, K/Z ve işlem geçmişi yalnız o grup için hesaplanır; "Tümü" birleşik görünümdür. Mevcut bir işlemi geçmiş listesindeki açılır menüden başka gruba taşıyabilirsin (yalnız gruplama değişir, tutar/bakiye etkilenmez). Grubu silmek işlemleri silmez — *Gruplanmamış*'a döner. **Net varlık, alokasyon ve nakit projeksiyonu gruplardan etkilenmez**; bu tamamen takip/raporlama katmanıdır.
- **Gelir/gider girişi (tek "+ Ekle" akışı):** Tarih bugün veya geçmişse *gerçekleşen* kayıt olur — bir hesap seçtiysen o hesabın bakiyesi anında değişir (gider düşer, gelir artar; kayıt silinince geri alınır), kategori seçtiysen Rapor'a girer. Hesap seçmezsen kayıt yalnızca Rapor'a girer, bakiyeye dokunmaz. Tarih ileriyse *plan* kalemi olur ve nakit projeksiyonuna girer; günü gelince Plan'daki **Gerçekleşti** ile tek tıkla deftere geçirip bakiyeye işlersin.
- **Toplu içe aktarma:** Banka ekstreni/tablonu (Excel'den kopyala-yapıştır, CSV, sekmeyle ayrılmış metin) "+ Ekle → İçe aktar" ekranına yapıştır: satırlar tarih/açıklama/tutar olarak çözülür (TR ve US tutar biçimi, bakiye sütunu varsa tutarın işareti bakiye yönünden çıkarılır), önizlemede her satırı düzeltebilir/çıkarabilirsin, kategori geçmişindeki benzer kayıtlardan tahmin edilir ve aynı gün+tutar zaten defterdeyse satır **olası kopya** diye işaretlenir. Onaylayınca tamamı tek atomik işlemde yazılır (en fazla 500 satır) — hepsi geçer ya da hiçbiri.
- **Hesap hareketleri:** Her nakit hesabın bir **hareket defteri** vardır: bakiyeyi oynatan her şey (gelir/gider kaydı, kart ekstresi ödemesi, düzenli kalem gerçekleştirme, portföy alış-satışı, vadeli mevduat açılışı, hatta bakiyeyi elle düzeltmen) oraya bir satır yazar. Hesaplar sekmesinde bir hesabın **Hareketler** düğmesine basınca tarih, açıklama, tutar ve **o hareketten sonraki bakiye** görünür. Değişmez kural: **hesabın bakiyesi = hareketlerinin toplamı** (açılış bakiyesi de bir harekettir) — bu yüzden "bakiyem neden tuttu/tutmadı" sorusunun cevabı artık listede duruyor. Defter bakiyeyi açıklayamazsa uygulama farkı gizlemez, uyarı olarak gösterir. Hareketler kaynaklarından yönetilir (silme/düzenleme ilgili kayıttan yapılır); bir kaydı silmek veya düzenlemek hareketini de düzeltir.
- **Kayıt düzenleme:** Gerçekleşen gelir/gider (Rapor), plan kalemi (Plan), kart harcaması (Kartlar) ve portföy işlemi (Portföy → Hareketler) satırlarındaki **✎** ile düzenlenir; form "+ Ekle"dekinin aynısıdır, önden dolu gelir. Hesaba bağlı bir kaydı düzenlersen **bakiye otomatik düzeltilir**: eski tutarın etkisi eski hesaptan geri alınır, yenisi yeni hesaba işlenir — hepsi tek atomik işlemde, yani hesabı da değiştirebilirsin. Düzenleme kaydın türünü değiştirmez: gerçekleşen kayıt gerçekleşen kalır, plan kalemi plan kalemi (plan → defter geçişi Plan'daki "Gerçekleşti" düğmesidir). Tanım kayıtları (hesap, kart, kredi, kategori, düzenli kalem) ve vadeli mevduat hâlâ sil + yeniden ekle ile değişir — düzenli kalemin tutarı için "Değiştir" akışı vardır.
- **Net varlık:** nakit toplamı + Σ(pozisyon adedi × güncel TRY fiyatı) − toplam kart borcu − kalan kredi borcu (Σ aylık taksit × kalan taksit sayısı).

> Not: Fiyat geçmişi tutulmadığından takvimdeki geçmiş günlerin portföy değeri de bugünkü fiyatla değerlenir. Gerçek tarihsel değer grafiği için `prices` tablosuna gün gün kayıt eklemek gerekir (yol haritasında).

**Kurulumunu tamamla:** Bazı yetenekler opt-in'dir (nakit/aracı hesap türleri, mutabakat, "nakit sayılan fon") — kurmazsan sessizce çalışmazlar. Özet'in en üstündeki kart, **verinin ihtiyaç duyduğu** eksikleri gösterir ve ilgili sekmeye götürür: nakit hesabın yoksa ATM çekiminin neden gider göründüğünü, hiç mutabakat yapmadıysan "bakiyem tutuyor mu"nun neden cevapsız kaldığını yazar. İlgilenmiyorsan × ile kalıcı kapatırsın. Portföy işlemi olmayana aracı kurum hesabı, fon tutmayana "nakit say" önerilmez.

## AI Asistan (Faz 22)

**Asistan** sekmesinde işlemlerini cümleyle anlatırsın, asistan bunları senin adına kayda çevirir:

> "11 temmuzda 12,71 TL'den 20 adet ASELS aldım"
> "TP2 fonundan 2 TL'den 20.000 TL'lik sattım, para Garanti hesabıma geçti ve Akbank ekstresini ödedim"

İkinci cümlede olduğu gibi bir mesajda birden fazla olay olabilir; her biri ayrı bir işleme çevrilir.

**Hiçbir şey onayın olmadan yazılmaz.** Asistan yalnız *plan* üretir: ne oluşturulacağı insan-okur satırlar hâlinde önüne gelir ("`ASELS ALIŞ · 20 adet × 12,71 TRY · 2026-07-11 · Garanti`"), istemediğin satırı ✕ ile çıkarırsın, **Onayla ve uygula** dedikten sonra kayıt oluşur. Yanlış anlaşılan bir cümle böylece deftere değil ekrana düşer.

Tutarı senin değil **sistemin** hesapladığı işlemlerde (kart ekstresi ödemesi, düzenli kalemin gerçekleştirilmesi, hesap mutabakatı) onay satırı o tutarı da önizler — "`Ekstre ödemesi: Akbank · vade 2026-08-14 · Garanti · tutar: 3.200,00 ₺`" — ve ekstre zaten ödenmişse ya da o vadede ekstre yoksa bunu söyler. Uygulama anında tutar yine sunucuda hesaplanır (arada yeni bir harcama girmişse güncel tutar yazılır); onaydaki sayı önizlemedir.

**Sesle yaz.** Metin kutusunun yanındaki 🎙 düğmesi cihazın **kendi** konuşma tanımasını (Web Speech API, `tr-TR`) çalıştırır: söylediğin kutuya yazılır, konuşurken canlı önizlenir, bittiğinde düğmeye tekrar basarsın. Yazıya dökülen metin **gönderilmez** — okur, gerekirse düzeltir, sen "Gönder"e basarsın; yani ses de her şey gibi onay akışının dışına çıkmaz. Ses uygulamanın sunucusuna gitmez (tarayıcı tanımayı kendi yapar ya da kendi servisine gönderir). Tarayıcı desteklemiyorsa (Firefox) düğme hiç görünmez; mikrofon izni yoksa düğme bunu söyler. Güvenli bağlam (https) şarttır.

**Harcama SMS'ini paylaş (Faz 23).** Kart harcaması yapınca bankadan gelen SMS zaten bir kaydın bütün alanlarını içerir. Android'de o SMS'i **Paylaş → Finans** ile uygulamaya at: asistan metni çözer, onay kartını hazır getirir, tek dokunuşla kaydolur — hiçbir şey yazman gerekmez. (Uygulamayı önce ana ekrana eklemelisin; paylaş menüsünde ancak yüklü PWA görünür.) iPhone'da `share_target` desteklenmediğinden aynı iş Kısayollar'dan `https://<adres>/?ekle=<metin>` açılarak yapılır; `?ekle=` parametresi her tarayıcıda çalışır.

Asistan bu metinleri şöyle ayırır: banka/kart adı kartlarınla eşleşiyorsa **kart harcaması**, hesaptan çıkan tutar **gider**, gelen havale **gelir**, **ATM çekimi** ise gider değil nakit hesabına **virman** (nakit hesabın yoksa bunu söyler). Bakiye bildirimi/kampanya gibi mesajlardan kayıt üretmez. Yine de her şey onaydan geçer — SMS yanlış okunduysa deftere değil ekrana düşer.

**Geri al.** Sekmenin altındaki **"Asistanın uyguladıkları"** listesi son 10 planı zaman damgasıyla gösterir; her birinin yanında **↩ Geri al** vardır (geri alınmışsa "geri alındı" yazar). Bu liste sunucudan gelir — sayfayı yenilesen, tarayıcıyı kapatsan ya da telefondan baksan da geri alma imkânı kaybolmaz. Geri alma, asistanın o planda *yarattığı* kayıtları ters sırada siler (önce işlem, sonra onu tutan hesap). Düzenleme, silme ve mutabakat geri alınamaz — eski hâlleri saklanmıyor, o yüzden onları düğme hiç önermez. Zaten var olan bir kaydı ("bu ekstre zaten ödenmişti") asistan yaratmadığı için ona da dokunmaz.

**Yetkisi = senin yetkin.** Onaylanan her işlem, senin kendi oturumunla, arayüzün kullandığı **aynı API uçlarına** iç istek olarak gider: aynı doğrulama, aynı çok-kiracılık izolasyonu, aynı bakiye/defter kuralları. Asistana özel bir yazma yolu yoktur, başka kullanıcının verisine erişemez; hesap silme, toplu içe aktarma, ayar değiştirme gibi uçlar ise bilinçli olarak asistana kapalıdır (tam liste ve gerekçeleri [ai/tools.ts](apps/server/ai/tools.ts) içindeki `SKIPPED`).

**API değişince asistan da bilir.** Asistanın araç kaydı ([ai/tools.ts](apps/server/ai/tools.ts)) uçların tarifidir; iş mantığı orada tekrarlanmaz. `pnpm build` bir kapı çalıştırır ([check-ai-routes.ts](apps/server/scripts/check-ai-routes.ts)): her `/api` yazma ucunun ya bir aracı ya da gerekçeli bir atlama kaydı olmalıdır — yeni bir uç eklendiğinde ya da var olan biri silindiğinde build "karar ver" diyerek durur. Prompt'a elle yazılmış bir API dokümanı güncel kalmazdı; bu kalır.

**Model bağımsızdır (ve ücretsiz olabilir).** Sağlayıcı [ai/provider.ts](apps/server/ai/provider.ts) arkasında soyutlanmıştır; model değiştirmek = env değiştirmek:

| Sağlayıcı | Env | Not |
|---|---|---|
| Google Gemini (varsayılan) | `AI_PROVIDER=gemini`, `AI_MODEL=gemini-3.6-flash`, `AI_API_KEY=<AI Studio anahtarı>` | Ücretsiz kotalı, Türkçesi iyi. Google eski sürümleri yeni anahtarlara kapatabiliyor; açık modelleri `curl -H "x-goog-api-key: $AI_API_KEY" https://generativelanguage.googleapis.com/v1beta/models` ile listele |
| Groq | `AI_PROVIDER=openai`, `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_MODEL=llama-3.3-70b-versatile` | Ücretsiz kotalı, çok hızlı |
| OpenRouter / Together / yerel Ollama / OpenAI | `AI_PROVIDER=openai` + kendi `AI_BASE_URL`'i | `/chat/completions` uyumlu her servis |

Seçilen model **function calling** desteklemek zorundadır (asistanın tek işi araç çağırmak). Anahtar tanımlı değilse sekme "kapalı" görünür, uygulamanın geri kalanı etkilenmez. Kullanıcı başına 5 dakikada 30 istek sınırı vardır.

**Birden fazla anahtar (kota dayanıklılığı).** Ücretsiz katmanların günlük kotası dar; tek anahtarla asistan gün ortasında susar. `AI_API_KEY_2`, `AI_API_KEY_3`… tanımlarsan (ya da `AI_API_KEY=anahtar1,anahtar2` yazarsan) kota dolduğunda (429) veya anahtar geçersizse sıradaki denenir ve **çalışan anahtarda kalınır** — dolmuş anahtara her istekte yeniden çarpılmaz. Yalnız anahtara bağlı hatalar geçişe yol açar: ağ hatası ya da hatalı model adı ikinci anahtarla da patlayacağı için boşuna kota harcanmaz. Sekmedeki model rozetinde kaç anahtar yüklü olduğu yazar.

**Dürüst kısıtlar:**
- Dil modeli tarih ve tutar çıkarımında hata yapabilir — onay ekranı tam da bunun için var, uygulamadan önce satırları oku.
- **Verin sağlayıcıya gider:** her mesajda hesap/kart/kategori/portföy adların, hesap bakiyelerin ve portföydeki sembollerin (id'lere çevirebilmesi için) seçtiğin model sağlayıcısına gönderilir. İşlem geçmişin ancak asistan `kayit_ara` ile bakma ihtiyacı duyarsa gider. Bu veriyi dışarı hiç çıkarmak istemiyorsan `AI_API_KEY`'i boş bırak (sekme kapalı kalır) ya da yerel bir model kullan (`AI_PROVIDER=openai` + Ollama'nın `AI_BASE_URL`'i).
- Konuşma geçmişi sunucuda tutulmaz; her istekte istemciden gider ve sohbet sayfayı yenileyince sıfırlanır.
- Bir plan yalnız **bir kez** uygulanabilir (plan kimliği tek kullanımlıktır) — ağ hatasından sonraki tekrar denemesi çift kayıt yazmaz.

## Soğuk başlangıç ve uptime izleme

Render'ın ücretsiz katmanı **15 dakika gelen istek olmazsa** süreci uyutur; sonraki ilk istek 30-60 saniye bekler. Panel için katlanılır, ama "harcama SMS'ini paylaş → kaydet" akışını kullanılamaz hâle getirir. İki katmanlı çözüm:

**1. Uygulamanın kendini uyanık tutması (kodda, hazır).** `KEEPALIVE_URL` (ya da `APP_URL`) tanımlıysa ve `NODE_ENV=production` ise, uygulama 10 dakikada bir kendi genel adresindeki `/api/health` ucunu yoklar. Bu Render'ın saydığı türden gelen trafiktir, yani süreç uyumaz. **Ama yalnız uyanık tutar, uyandırmaz:** deploy, çökme ya da kota bitimiyle süreç bir kez uyursa kendi cron'u da durmuş olur.

**2. Dışarıdan uptime monitörü (asıl güvence, 2 dakikalık kurulum).** Ücretsiz seçenekler: [cron-job.org](https://cron-job.org), [UptimeRobot](https://uptimerobot.com), [Better Stack](https://betterstack.com). Kurulum aynı:

- URL: `https://<uygulama-adresin>/api/health` — `GET`
- Aralık: **5 veya 10 dakika**
- Beklenen: HTTP `200`

`/api/health` kimlik istemez ve veri sızdırmaz; yalnız süreç ve veritabanı canlı mı onu söyler:

```json
{ "ok": true, "db": true, "ms": 12 }
```

Veritabanına erişilemiyorsa **503** döner — yani monitör "uygulama ayakta ama kullanılamaz" durumunu da yakalar. (Bu ayrım pratikte lazım oldu: uygulama çalışırken Postgres kapalıydı ve hata arayüzde yalnız "Sunucu hatası" olarak görünüyordu.)

> Not: Render ücretsiz planı ayda 750 örnek-saati verir; tek bir servisi sürekli ayakta tutmak ~730 saattir, yani sığar. İkinci bir ücretsiz servis daha çalıştırıyorsan kota bölünür.

## Yedekleme

```bash
pg_dump "$DATABASE_URL" > yedek/finans-$(date +%F).sql        # tek dosya döküm
# Docker compose ile: docker exec finans-db pg_dump -U postgres finans > yedek/finans-$(date +%F).sql
```

Geri yükleme: `psql "$DATABASE_URL" < yedek/finans-YYYY-AA-GG.sql`. Sunucuda cron ile günlük `pg_dump` + istersen başka makineye rsync önerilir.

## Yol haritası (henüz yok, bilinçli olarak)

> Yapılanlar listeden düşer: temettü/bedelsiz kayıtları (Faz 21), tanım kayıtlarının düzenlenmesi (Faz 18) ve doğal dil asistanı (Faz 22) artık var.

- Dışa aktarma (içe aktarma var; dışa aktarım şimdilik yalnız KVKK veri indirme ucundan)
- **Bedelli** sermaye artırımı için ayrı kayıt türü — şimdilik normal ALIŞ olarak girilir (rüçhan bedeli maliyete eklenir), ayrı bir olay türü değildir
- Asistanın düzenleme/silme işlemlerini geri alabilmesi — şu an yalnız *yarattığı* kayıtlar geri alınabiliyor (eski hâl saklanmadığı için düzenleme geri alınamaz)
- Portföy işlemlerinin hesap bakiyesini **otomatik** düşürmesi (şu an isteğe bağlı: işlemi bir nakit hesaba bağlarsan işler, bağlamazsan bakiyeyi sen güncellersin)
- Gün içi (intraday) fiyat geçmişi — şu an günde bir anlık görüntü alınır, grafiğin çözünürlüğü gündür
