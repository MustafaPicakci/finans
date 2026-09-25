# Sıfır bilgi şifreleme — tasarım

*Durum: tasarım onaylandı, uygulama `e2ee` branch'inde sürüyor. Aşama listesi ve dosya dosya iş planı ayrı tutulur; bu dosya **neden** sorusunu cevaplar.*

Amaç tek cümle: **sunucuyu işleten kişi kullanıcının finansal verisini okuyamasın.** Bugün okuyabiliyor — `DATABASE_URL` elinde, satırlar düz metin. "Verin güvende" demek bu hâliyle bir söz, garanti değil.

Bu iş, uygulamayı denemesi istenen kişilerin gerçek verilerini girmek istememesinden doğdu. İlk teşhis yanlıştı ("denemek zor, demo veri lazım"); demo veri fikri **reddedildi**, çünkü sorun deneme sürtünmesi değil gerçek kullanıcının güveniydi.

İki şart tasarımı belirledi:

1. **"Ben bile göremeyeyim"** → anahtar kullanıcıda. Sunucu tarafı şifreleme (anahtar env'de) yeterli değil.
2. **"Her şey de client'a taşınmasın"** → sunucu yapabildiği işi yapmaya devam etsin. **Asistan kalıyor, cron kalıyor.**

---

## 1. Tehdit modeli — neyi garanti eder, neyi etmez

**Karşı taraf: meraklı ama dürüst sunucu** (*honest-but-curious*). Operatör veritabanını okuyabilir, yedek alabilir, log'lara bakabilir — ama satırları kasten takas etmez, geri sarmaz, arayüzü kullanıcıyı kandıracak şekilde değiştirmez.

**Aktif kötü niyetli sunucuya karşı savunma kapsam dışı ve bu bilinçli bir karardır** (2026-09-25, kullanıcı kararı: *"engellemenin bir yolu yok, kod zaten bana ait"*). Sebebi yapısal: sunucu istemci JavaScript'ini de sunuyor, yani anahtarı sızdıran bir sürüm deploy edilebilir ve tarayıcının aldığı kodun dürüst sürüm olup olmadığını anlamasının yolu yok. Web'de bunun çözümü yoktur; yerel uygulamalar imzalı ikili ve sürümlenmiş güncellemeyle kısmen çözer. **Proton Mail ve Bitwarden'ın web istemcilerinde de aynı kusur var** — kategorinin kabul edilmiş sınırı. Bu yüzden imzalı manifest / bütünlük katmanı tasarımda YOK.

Kusuru pratikte küçülten üç şey, ki garantinin değerini bunlar taşıyor:

1. **Pasif değil aktif saldırı.** Veritabanına bakmak sessizdir ve iz bırakmaz; kötü niyetli kod deploy etmek bir eylemdir ve git geçmişinde durur.
2. **Yalnız ileriye işler.** Yarın sürülen kötü kod, ondan sonra giriş yapanların anahtarını toplar — **dünkü yedeği çözemez.** Gerçek dünyada en olası riskler (sızan döküm, çalınmış `DATABASE_URL`, laptopta kalmış eski yedek, meraklı bir bakış) tamamen kapanır.
3. Kod açık; sürülen paketin depodaki kodla eşleştiği doğrulanabilir (kısmî: kullanıcının bakmasını gerektirir).

Bu yüzden **söylenebilecek cümle ile söylenemeyecek cümle** ayrımı tasarımın parçasıdır:

> ✅ *"Veritabanında duran kayıtlarını okuyamam."*
> ❌ *"Teknik olarak hiçbir şekilde erişemem."*

### Şifrelendikten sonra bile sunucunun gördükleri

Kaçınılmaz metadata; hiçbir şifreleme gizlemez ve gizlilik metninde yazılacak:

- E-posta, kayıt tarihi, oturum zamanları, IP
- Her tablodaki **satır sayısı** (kaç hesabın, kaç işlemin var)
- **Tarihler** — ne zaman harcama yaptığın (düz kolon olarak kalıyor, bkz. §2)
- **Graf yapısı** — hangi harcama hangi kartta/hesapta, kaç kategorin var (FK'ler düz)
- **Tuttuğun semboller** (kullanıcı kararı: `trades.symbol` şifrelenmiyor, bkz. §4.2)
- Yazma zamanlaması ve sıklığı

Görmediği: **her tutar** (harcama, maaş, bakiye, adet, fiyat), **her ad/açıklama** (işyeri, kalem adı, not), kategori adları, K/Z.

Yani *"12 Eylül'de Garanti kartında bir harcama var"* görünür; *"Migros'a 450 TL"* görünmez.

---

## 2. Belkemiği: satır başına tek zarf

**Alan alan şifreleme reddedildi ve sebebi performans.** `crypto.subtle` **çağrı başına** sabit maliyet taşır — binlerce satır × birkaç alan on binlerce çağrı demek ve bu ilk açılışta yarım saniyeyi aşar. Kullanıcının ikinci şartı ("performanssız olur") tam olarak bunu hedefliyordu.

Her tablonun hassas alanları **tek bir JSON blob** olarak tek bir `enc text` kolonunda durur:

```
transactions (id, user_id, date, account_id, category_id, enc)
                                                          └── {"amount":-450.5,"name":"Migros"}
```

Dört sonucu var ve üçü işi küçültüyor:

1. **Çözme maliyeti satır sayısı kadar**, alan sayısı kadar değil.
2. **`date` / `ym` / `due` / FK'ler gerçek kolon kalır.** Hassas değiller — bir ayın adı maaşı söylemez — ve karşılığında üç sorun **hiç doğmaz**: şifreli birincil anahtar (rastgele IV ile iki ciphertext asla eşit olmaz, yani `ON CONFLICT (recurring_id, ym) DO NOTHING` hiç tetiklenmez ve idempotency ölürdü), `ORDER BY date` kaybı, ve değere bağlı CHECK kısıtlarının toptan düşüşü.
3. **"Bu kolonu şifrelemeyi unuttum" hatası yapısal olarak imkânsızlaşır** — kolon şemada yoktur. Bakımı gereken bir "şifreli kolonlar listesi" yerine, tipte var olup kolonu olmayan her alan zarfa girmek zorundadır ve `tsc` bunu doğrular.
4. **Bedeli**: zarfın içindeki bir alana sunucunun ileride ihtiyacı olursa imkânsız. İstenen şey bu, ama tek yönlü bir kapı.

`num` codec'i değeri **8 baytlık float64** olarak kodlar → tüm tutarların ciphertext'i aynı boyda, uzunluk sızıntısı bedavaya kapanır (kolon zaten `double precision`, aynı 8 bayt, hassasiyet değişmez). Metinler 32 baytlık kovalara doldurulur.

## 3. Önbellek: anahtar ciphertext'in KENDİSİ

"Çözülmüş `AllData`'yı sürüm anahtarıyla sakla" tasarımı **reddedildi**, çünkü "veri sunucuda değiştiyse ne olacak" sorusuna cevap veremiyor: sürüm damgası her tenant tabloya `updated_at` eklemeyi ve bir geçersizleştirme protokolü uydurmayı gerektirirdi — ve o protokoldeki bir hata **sessizce eski rakam gösterirdi.** Bir finans panelinde en kötü hata sınıfı bu, çünkü kullanıcı yanlış olduğunu anlamaz.

Doğru anahtar blobun kendisi: **`enc` baytları aynıysa içindeki düz metin tanımı gereği aynıdır.** IndexedDB'de `Map<enc, düz metin>`; isabet varsa çözme atlanır, ıska varsa çözülür ve yazılır.

Kritik özellik: **önbellek "veri ne" sorusuna hiç karışmaz**, yalnız "bu blobu daha önce çözdüm mü" sorusuna cevap verir. Tazelik bugünkü mekanizmadan gelir — `/api/all` her mutasyondan sonra yeniden çekilir.

- Satır değişti → yeni IV → yeni blob → **ıska, mutlaka çözülür.** Eski değeri göstermek yapısal olarak imkânsız.
- Cron bir satırı etkinleştirdi → değişen `pending` (düz kolon), `enc` aynı → isabet, ve düz metin zaten doğruydu.
- **Geçersizleştirme protokolü yok, dolayısıyla protokol hatası da yok.**

Bir yanlış anlaşılmayı önlemek için: ciphertext'i önbellek anahtarı yapmak **determinist şifreleme değildir.** IV her yazımda rastgele; blob sunucunun zaten gördüğü bir veri ve yalnız yerel bir sözlük anahtarı — yeni hiçbir şey sızdırmıyor.

Bedeli: **önbellek cihazda düz metin tutar.** DEK'i IndexedDB'de tutmakla aynı takas sınıfı — karşı taraf sunucu, cihaz değil; çıkışta ikisi de silinir.

---

## 4. Sunucunun düz metne ihtiyaç duyduğu yerler ve çözümleri

### 4.1 Bakiye ve tutar aritmetiği → istemciye (ama yeni iş değil)

Sunucu bugün iki şey yapıyor: bakiyeyi oynatıyor (`applyEntry`, `UPDATE accounts SET balance = balance + ?`) ve **tutar türetiyor** (beş yerde: düzenli kalem gerçekleştirme, ekstre tutarı, `tradeBalanceDelta`, mevduat anaparası, açılış bakiyesi). Şifreli sayıyla ikisi de yapılamaz.

**`accounts.balance` kolonu kalkıyor.** Değişmez zaten "bakiye = Σ `account_entries`" diyor ve `/api/all` tüm hareketleri **zaten** istemciye gönderiyor — türetme bugün de mümkün, sadece yapılmıyor. `accountLedger` zaten defterden yürüyor, yani ek maliyet yok: dizi bellekte ve zaten geziliyor. Yan kazanç: `ledgerDrift`'in yakalamak için var olduğu "defter ile bakiye ayrıştı" risk sınıfı **yapısal olarak yok oluyor** (drift tanım gereği 0), o yüzden fonksiyon ve uyarısı kalkıyor.

**Tutar türetmesi istemciye iş taşımıyor, sunucudaki kopyayı siliyor.** Her yazma zaten tarayıcıdan doğuyor; sunucu tutarı yalnız "istemciden gelene güvenilmez" (Faz 8.2) diye ikinci kez hesaplıyor. Sıfır bilgi modelinde istemci kullanıcının kendisidir, yani **o gerekçe düşer.** `tradeBalanceDelta`'nın kendi yorumunda yazan "iki kopya ayrışabilir" riski de böylece biter.

### 4.2 Fiyat cron'u → hiç değişmiyor

`trades.symbol` **şifrelenmiyor** (kullanıcı kararı). Karşılığında fiyat cron'u, TEFAS tazelemesi, `backfillPriceHistory`, referans endeksler ve `/api/all`'ın sembol daraltması **olduğu gibi kalıyor** — o daraltmanın kalkması `data.ts`'in kendi yorumunda **ölçülü** duran 770 kB / 5,5 sn gerilemesini geri getirirdi.

Sızan bilgi: hangi sembolleri tuttuğun. Kaç adet, kaça aldığın, K/Z — hiçbiri yok. Dürüst cümle: *"hangi sembolleri takip ettiğin sunucudan gizlenmiyor."*

### 4.3 Cron sunucuda KALIYOR — hesaplayıcı değil, etkinleştirici

`materializeDueRecurring` ve `materializeDueStatements` bugün tutar okuyup hesap yapıyor. Şifreliyken yapamaz — **ama hesaplamasına gerek yok.**

İstemci, düzenli kalem oluşturulduğunda/değiştirildiğinde gelecek occurrence'ları **önceden hesaplayıp şifreleyerek** yazar (`pending=true`, `date` düz). Cron'un işi `WHERE pending AND date <= today` satırlarını etkinleştirmek: aritmetik yok, çözme yok.

Böylece "uygulamayı açmazsan maaşın deftere geçmez" takası **düşüyor** — kullanıcının ikinci şartı korunuyor.

Dürüst risk: önceden üretilmiş satırlar **bayatlayabilir** (tutar değişir, kalem silinir). Kural: istemci her açılışta 12 aylık ufku yeniden üretir ve etkinleşmemiş bayat satırları siler. Bu kırılgan çıkarsa yedek yol basit ve bilinen — istemci-açılışında gerçekleştirme.

### 4.4 Asistan KALIYOR — bağlam istemcide, sağlayıcı çağrısı sunucuda

Bugün `buildContext(uid)` veritabanından hesap adlarını ve **bakiyeleri** okuyup sistem promptuna koyuyor; okuma araçları sunucuda engine çağırıyor; `enrich.ts` ekstre tutarını sunucuda hesaplıyor. Şifrelemeden sonra hiçbiri çalışmaz.

Ajan döngüsü **istemciye taşınır** — sunucuda kalsaydı her araç turu için sunucu→istemci itme (SSE ya da "devam et" protokolü) gerekirdi, ki döngüyü taşımaktan kesinlikle daha karmaşık. Sunucuda kalan tek şey `POST /api/ai/relay`: durumsuz geçiş, diske hiçbir şey yazmaz, gövdeyi loglamaz. API anahtarları orada kalmak zorunda olduğu için röle şart.

**Bu bir hızlanma**: `context.ts` bugün her mesajda 9 sorgu atıyor, bellekteki `data`'dan kurulunca sıfır. Taşınan şey matematik değil sorgu katmanı — matematik zaten engine'de.

Bedava gelen ikinci kazanç: `app.request` iç istek deseni ve `invoke` siliniyor, yani **ayrıcalıklı yazma yolu diye bir şey kalmıyor.** İstemci onaylanan planı normal uçlara yazar.

`ai_plans`'ın tek kullanımlık kilidi **aynen çalışır** — atomik `UPDATE … WHERE consumed_at IS NULL RETURNING` satırın *içeriğine* değil *varlığına* dayanıyor, opaklık yeterli. Takas: tüketim ile uygulama iki ayrı istek; istemci arada çökerse plan yanar ve **hiçbir şey yazılmaz.** Tersi (önce uygula, sonra tüket) ağ tekrarında çift kayda açık, ki Faz 34'ün varlık sebebi tam olarak oydu.

**Geri alınan karar**: Faz 34 sohbet geçmişini bilerek sunucuya taşımıştı, gerekçesi *"istemci 'assistant' rolünde uydurma tur enjekte edebiliyordu"*. Sunucu artık geçmişi okuyamayacağı için o koruma **geri alınıyor** — bir gözden kaçma değil, takasın parçası: o koruma kullanıcının kendi istemcisine karşıydı ve sıfır bilgi modelinde istemci kullanıcının kendisidir. Sohbetin **kalıcılığı** (cihazlar arası, PWA yeniden kurulumu) korunuyor; satırlar sunucuda duruyor, yalnız şifreli.

Aynı mantık `statementAmount`'ın sunucuda olmasını gerektiren Faz 8.2 kararı için de geçerli ve orada da gerekçe düşüyor.

**Dürüstçe yazılacak**: asistana yazdığın cümle sunucudan **düz** geçer ve sağlayıcıya gider. Diskte durmaz ama o an bellektedir. Bu zaten bugün de böyle ve arayüz katlamadan söylüyor — şifrelemeden sonra daha görünür olması gerekir, çünkü artık uygulamanın geri kalanıyla arasında gerçek bir fark var. Bu yüzden asistan **kullanıcı başına kapatılabilir** oluyor (varsayılan açık kalır).

---

## 5. Anahtar yönetimi

```
parola ──PBKDF2-SHA256(600k, kdf_salt)──► master
                                            ├──HKDF("kek")───► KEK ──sarar──► DEK  (cihazda)
                                            └──HKDF("auth")──► auth_token ─────► sunucuya
kurtarma kodu ──► RK ──sarar──► aynı DEK
```

- **DEK** rastgele, **hiçbir zaman sunucuya düz gitmez**; iki kez sarılıp sunucuda sarılı hâlde saklanır.
- **Parola değişimi veriyi yeniden şifrelemez** — yalnız DEK yeniden sarılır. Tasarımın ucuz olduğu tek yer.
- **Parola tarayıcıdan çıkmaz ve bu zorunlu.** Aksi hâlde sunucudaki scrypt hash'i (bugün N=16384) şifrelemenin **arka kapısı** olurdu: veritabanını okuyan kişi — tam da tehdit modelindeki taraf — sözlük saldırısıyla parolayı bulur ve PBKDF2-600k'yı hiç çalıştırmadan DEK'i açardı. Yani 600.000 iterasyon, yanında 16.384'lük bir kapı dururken anlamsız olurdu.
- `users.password_kdf` (`'legacy'|'v2'`) ile başarılı legacy girişten sonra sessiz yükseltme.

### Parola sıfırlama artık veriyi kurtarmaz

E-postayla gelen bir bağlantı DEK'i açamaz — açabilseydi sunucu da açabilirdi. Sonuç: **parolasını unutan ve kurtarma kodunu kaybeden kullanıcının verisi gider.**

Kurtarma kodu bu yüzden zorunlu: kayıt akışının son adımında bir kez gösterilir, "kaydettim" onayı verilmeden geçilemez. Sıfırlama artık *"verini silerek yeni parola belirle"* der ve bunu açıkça der.

### PWA'da anahtarın ömrü

Uygulama günde defalarca açılıyor; her açılışta parola sormak kullanılamaz kılar. DEK açıldıktan sonra IndexedDB'de `extractable:false` CryptoKey olarak tutulur, çıkışta silinir. Takas açık: cihazı eline geçirene karşı koruma sağlamaz — ama tehdit modelindeki karşı taraf sunucu. Omuz üstünden bakana karşı bakiye gizleme modu zaten var ([privacy.ts](../apps/web/src/privacy.ts)).

---

## 6. Güvenlik: ne kadarı kabul gören yöntem

**Standart olan — hiçbir şey elle yazılmıyor**: AES-256-GCM (NIST SP 800-38D), PBKDF2-HMAC-SHA256 600k (OWASP 2023 eşiği, FIPS onaylı), HKDF (RFC 5869), zarf şifreleme (AWS KMS / Google Tink deseni), parola-tarayıcıdan-çıkmaz + ayrı auth token (**Bitwarden / 1Password'ün yayımlanmış tasarımı**, uydurulmuş değil kopyalanmış), kurtarma anahtarının aynı DEK'i sarması (1Password Emergency Kit deseni).

Uygulama `crypto.subtle` ile, yani **tarayıcının kendi denetlenmiş kütüphanesiyle** — AES'i, PBKDF2'yi, HKDF'i biz yazmıyoruz.

**Bağımlılık politikası: kripto için npm paketi YOK.** Gerekçe bu tehdit modeline özgü — bir kripto kütüphanesinin kötü niyetli sürümü doğrudan **anahtar sızdırma yolu** olur, ve bu tam olarak korunmaya çalıştığımız şey. WebCrypto sıfır bağımlılık, tedarik zinciri yüzeyi yok. Argon2id ileride istenirse denetlenmiş bir WASM ayrı bir kararla değerlendirilir; `kdf_params` json'ı o yolu açık tutuyor.

**Standart olmayan, yani zayıf halkalar** — dördü de yazılmalı, gizlenmemeli:

1. Tarayıcıya JS'i sunucu gönderiyor (§1). SRI işe yaramaz, HTML'i de aynı sunucu veriyor.
2. Aktif kötü niyetli sunucuya karşı **bütünlük yok**: AAD (`tablo:user_id`) ciphertext'in başka kolona/kullanıcıya taşınmasını yakalar, **aynı kullanıcının iki satırının takasını ya da satır silme/geri sarmayı yakalamaz.**
3. Cihazda düz metin var (DEK + önbellek). Bitwarden'ın kasa önbelleği de böyle.
4. **Denetim yok.** Kişisel bir projenin kriptografisi bağımsız denetimden geçmiyor. Risk azaltmanın yolu zaten yapılan şey — standart primitifler, yayımlanmış bir tasarımı kopyalamak, kendi kripto kodunu minimumda tutmak. Ama "denetlendi" denemez.

### Bundan doğan yeni zorunluluk: parola politikası

Sızan bir veritabanı `dek_wrapped_pw`'yi de sızdırır ve saldırgan **çevrimdışı** deneme yapabilir. 600k PBKDF2 bunu pahalı kılar ama zayıf parolayı kurtarmaz — yani **parola gücü şifrelemeden sonra öncesinden daha önemli.** Bugünkü kural asgari 8 karakter; asgari 12 + yaygın parola kontrolü + güç göstergesi gerekiyor.

---

## 7. Şeffaf sınır ve derleme kapıları

**Şifreleme/çözme [api.ts](../apps/web/src/api.ts)'in içinde**, çağrı yerleri bunu hiç görmez. Bugün her okuma iki fonksiyondan, her yazma `post/put/del` + on kadar metottan geçiyor — tek dosya, ~20 çağrı yeri, yani **kapsam inşa gereği tam.** Çağrı yeri başına şifreleme anahtar erişimini 12 özellik klasörüne yayar ve "yeni alan eklendi, şifrelenmedi" hatasını **sessiz ve kalıcı** kılar: düz metin veritabanına yazılır ve kimse fark etmez.

Rotalar tablo adlarıyla birebir olmadığı için (`cardtxs→card_txs`, `prices→user_prices`, `reconcile` gövdesi iki tabloya düşüyor) iki harita gerekiyor: `TABLE_FIELDS` ve `ROUTE_FIELDS` (çoğu türetilir, sekiz özel gövdeli rota elle).

**Kapılar** — `check-ai-routes.ts`'in kanıtlanmış deseniyle (kaynağı oku, çıkar, iki yönlü karşılaştır, gerekçesiz kalanda patla):

1. **Şema kayması** — `db.ts` DDL'i ile harita karşılaştırılır; sınıflandırılmamış yeni kolon ya da artık var olmayan kolon için codec build'i durdurur. `PLAIN` listesinin **gerekçe alanı** vardır ("`source_id`: revertEntries bununla WHERE yapıyor") — cümle kodun içinde durur, dokümanda değil.
2. **Tip kayması** — `satisfies FieldsOf<Transaction>`: engine tipine alan eklenip zarfa girmezse `tsc` patlar. Kapı 1 veritabanı şemasına, kapı 2 engine tiplerine karşı korur; ikisi farklı yönlerden kayar.
3. **Sızıntı testi** — temsilî gövdeleri serileştirip hassas hiçbir değerin düz geçmediğini iddia eder. Tek test, tüm hata sınıfı.
4. **Sunucu kriptoya link'lenmez** — `apps/server/**` içinde `@finans/crypto` (map dışı) import'u bulunursa build durur. Bir yorum değil, bir test.

`packages/crypto` ayrı bir paket çünkü haritayı sunucudaki kapı okuyacak ve sunucu `apps/web`'den import edemez. **Engine'e girmez**: WebCrypto asenkron (engine senkron, 326 test yeniden yazılırdı), şifreleme taşıma kaygısıdır, ve `apps/server` engine'i import ettiği için "sunucu anahtarı göremez" garantisinin **yapısal** olması gerekiyor.

---

## 8. Göç

Mevcut veri düz metin ve **canlıda gerçek kullanımda.** Omurga tek özellik: **`v1:` öneki değeri tarif eder** → göç yeniden çalıştırılabilir (zarflanmışı atlar), yarıda kalması ölümcül değil, geri alma simetrik.

**Ön koşul, ayrı sevk**: şema hazırlığı — hassas kolonlar kaldırılıp `enc` eklenir, onlara bağlı CHECK'ler düşer. **Hiçbir şey şifreli değil, uygulama tam çalışıyor, tersine çevrilebilir.** En riskli DDL'i ciphertext yokken yapmış olmak, göçü ikiye bölmenin en ucuz yolu.

1. **Yedeği sunucu zorlar**: `GET /api/export` dönerken `users.last_export_at` yazar; `POST /api/e2ee/begin` bunun son 15 dakika içinde olmasını şart koşar (428). Onay kutusu değil, sunucunun kendi gözlemi.
2. **Başla**: DEK üretilir, iki kez sarılır, **hiçbir veri yazılmadan önce** kalıcılaşır — kaybı tek onarılamaz hata.
3. **Yazma kilidi**: `e2ee_started_at IS NOT NULL AND e2ee_migrated_at IS NULL` iken guard'dan sonraki middleware `/e2ee/*` dışı tüm POST/PUT/DELETE'e 409 döner. Bu, "ikinci cihaz yarı göçmüş hesaba düz metin yazar" senaryosunu **yapısal olarak imkânsız** kılıyor — plandaki en tehlikeli senaryo o.
4. **Yaz**: tablo tablo, sunucu id ile opak `UPDATE` yapar, içeriği yorumlamaz. Kesintiden sonra kaldığı yerden devam eder.
5. **Doğrula**: yeniden çek, çöz, anlık görüntüyle **alan alan** karşılaştır + türetilmiş değişmezler (net varlık, hesap başına bakiye, satır sayıları). `verifyMigration` saf fonksiyon — testlenebilir, ağdan bağımsız.
6. **Bitir**: yalnız fark listesi boşsa damga atılır, kilit kalkar. **İptal** simetrik.

Parola değişimi `auth_token` + `dek_wrapped_pw`'yi **tek tx'te** yazar — ayrı olsalardı arada bir çökme, açılamayan bir DEK'le yeni parola bırakırdı.

**Prod öncesi el ile bir kez**: kopya veritabanında tam göç → doğrula → iptal → tekrar göç turu. Otomatikleştirilemeyen tek şey bu ve gerekli.
