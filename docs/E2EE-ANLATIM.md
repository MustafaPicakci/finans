# Şifreleme — sade anlatım

*Bu belge teknik bilgi gerektirmez. Aynı sistemin mühendis gözüyle, gerekçeleri ve ölçümleriyle anlatımı [E2EE.md](E2EE.md)'dedir; bu dosya onun "herkes için" sürümüdür. Her iki dosya da `e2ee` dalındaki kodu anlatır — main'de henüz bu sistem yok.*

---

## 1. Tek cümlede

**Kullanıcının tutarları, adları ve notları, sunucuya kilitli bir kutunun içinde gider. Kutunun anahtarı yalnız kullanıcının tarayıcısındadır. Sunucuyu işleten kişi (yani sen) kutuları saklar ama açamaz.**

Teknik adı *uçtan uca şifreleme* (end-to-end encryption, **E2EE**) ya da *sıfır bilgi* (zero knowledge): sunucu, sakladığı verinin içeriği hakkında "sıfır bilgiye" sahiptir.

---

## 2. Neden gerekti?

Önceden durum şuydu: veritabanında her şey açık yazıyordu.

```
transactions tablosu (ESKİ)
id | tarih      | ad       | tutar
---+------------+----------+--------
 7 | 2026-09-12 | Migros   | -450.50
 8 | 2026-09-15 | Maaş     | 85000
```

Veritabanı adresine (`DATABASE_URL`) sahip olan herkes — sen, Neon'daki bir çalışan, adresi ele geçiren biri, bir yedek dosyasını bulan biri — bu tabloyu açıp okuyabilirdi. "Verin güvende" demek yalnız bir **sözdü**.

Arkadaşların uygulamayı denemek istemedi, çünkü gerçek maaşlarını, borçlarını senin okuyabileceğin bir yere yazmak istemediler. Bu anlaşılır bir çekince. Şifrelemeden sonra aynı tablo şöyle görünür:

```
transactions tablosu (YENİ)
id | tarih      | hesap | kategori | enc
---+------------+-------+----------+-------------------------------------------
 7 | 2026-09-12 |   1   |    5     | v1:q8Jd2…:Xk91mPz0aL7…(anlamsız karakterler)
 8 | 2026-09-15 |   1   |    2     | v1:Pw0sN…:Rt4bB9ueQ2c…(anlamsız karakterler)
```

"Migros" ve "450,50" artık `enc` kolonundaki anlamsız karakterlerin içinde. O karakterleri anahtar olmadan anlamlı hâle getirmenin bilinen bir yolu yok.

---

## 3. Temel fikirler — gündelik benzetmelerle

### 3.1 Şifreleme = kilitli kutu

Şifreleme, bir metni **anahtar** denen gizli bir sayıyla karıştırıp anlamsız hâle getirmektir. Aynı anahtarla karıştırma geri alınır. Anahtarı olmayan için sonuç rastgele gürültüden farksızdır.

Burada kullanılan yöntem **AES-256-GCM**. Bankalar, WhatsApp, HTTPS aynı yöntemi kullanır. Kendimiz icat etmedik; tarayıcının içinde hazır gelen, yıllardır denetlenmiş kodu çağırıyoruz.

### 3.2 İki ayrı anahtar var: veri anahtarı ve parola

Burada kafa karıştıran nokta şu: **verini şifreleyen anahtar senin parolan değil.**

- **Veri anahtarı (DEK)**: hesap açıldığında tarayıcının ürettiği, tamamen rastgele, çok uzun bir sayı. Bütün kutular bununla kilitlenir. Kimse bunu ezberlemez, görmez.
- **Parola**: senin bildiğin şey. Veri anahtarını **saklayan kutunun** anahtarını üretmek için kullanılır.

Benzetme: Evdeki tüm çekmeceler **tek bir anahtarla** (veri anahtarı) açılıyor. O anahtarı bir **küçük kasaya** koyuyorsun, kasanın şifresi de senin parolan. Kasa sunucuda duruyor; sunucu kasayı saklıyor ama şifresini bilmiyor.

Bunun iki faydası var:

1. **Parola değiştirince veriyi yeniden şifrelemek gerekmez.** Yalnız küçük kasanın şifresi değişir; içindeki anahtar aynı kalır, çekmeceler aynı kalır. Bir saniyelik iş.
2. **Anahtarı ikinci bir kasaya da koyabiliriz.** İşte kurtarma kodu budur (§3.4).

### 3.3 Parola tarayıcıdan hiç çıkmaz

Eski sistemde giriş yaparken parolan sunucuya gidiyordu; sunucu onu kontrol edip saklıyordu (karıştırılmış hâliyle). Yeni sistemde bu **olamaz**: parolanı bilen biri küçük kasayı açabilir, yani sunucu parolanı görürse veriyi de görebilir.

Bu yüzden tarayıcı paroladan **iki ayrı şey** türetir:

```
parolan
   │
   ▼  (kasıtlı olarak yavaş bir hesap — 600.000 tur)
ana sır
   ├──► "kasa anahtarı"   → tarayıcıda kalır, küçük kasayı açar
   └──► "giriş jetonu"    → sunucuya gider, yalnız "bu kişi doğru parolayı biliyor" kanıtıdır
```

Giriş jetonundan geriye doğru parolayı ya da kasa anahtarını bulmak mümkün değil. Sunucu "sen gerçekten sensin" diyebiliyor ama kasayı açacak şeyi hiç eline almıyor.

**Neden "kasıtlı olarak yavaş"?** Veritabanı çalınırsa, çalan kişi küçük kasayı evinde milyonlarca parola deneyerek açmaya çalışabilir. Her deneme 600.000 tur hesap gerektirdiğinden bu çok pahalı olur. Senin için ise bu hesap girişte **bir kez** yapılır ve kısa bir bekleme olarak hissedilir.

### 3.4 Kurtarma kodu = yedek anahtar

Veri anahtarının ikinci kopyası, ikinci bir küçük kasada durur. O kasanın şifresi de **kurtarma kodu**: uygulamanın bir kez gösterdiği uzun, rastgele bir kod.

- Parolanı unutursan kurtarma koduyla ikinci kasayı açarsın, içindeki aynı veri anahtarını yeni parolayla yeniden kilitlersin. **Hiçbir veri kaybolmaz.**
- Hem parolanı unutur hem kurtarma kodunu kaybedersen **veriye kimse ulaşamaz** — sen de, ben de. Tek seçenek hesabı boşaltıp baştan başlamak.

Bu, sistemin en sert sonucudur ve bilinçlidir: e-postayla gelen bir "şifremi unuttum" bağlantısı veriyi açabilseydi, e-postayı gönderen sunucu da açabilirdi. O zaman şifrelemenin anlamı kalmazdı.

Uygulama bu yüzden kurtarma kodunu **uygulamayı açmadan önce** gösterir ve son dört karakterini yazdırır ("kaydettim" kutusunu okumadan işaretlemek çok kolay).

### 3.5 Kutunun üstündeki etiket

Her kutu kilitlenirken üzerine görünmez bir etiket basılır: *"Bu kutu, 3 numaralı kullanıcının işlemler tablosuna aittir."* (Teknik adı AAD.)

Biri kutuyu alıp başka bir kullanıcının satırına ya da başka bir tabloya taşırsa kilit açılmaz. Yani şifreli bir kutuyu kopyalayıp başka bir yere yapıştırarak kimse "Ali'nin maaşını Ayşe'nin ekranında gösteremez".

### 3.6 Kutular aynı boyda

Kutunun boyu bile bir ipucudur: "Migros" kısa, "Migros Jet Market Ataşehir" uzun. 450 kısa, 45.000 biraz daha uzun. Bu yüzden her kutu, içine boşluk eklenerek 32 baytlık sabit boylara yuvarlanır. "450" ile "45.000" aynı boyda kutuya girer. Çok uzun bir notla kısa bir ad yine ayırt edilir, ama yakın boyutlar ayırt edilemez.

---

## 4. Uygulama kullanılırken neler oluyor — adım adım

### 4.1 Hesap açma

1. Parolanı yazarsın. Tarayıcı ondan kasa anahtarını ve giriş jetonunu türetir.
2. Tarayıcı rastgele bir **veri anahtarı** üretir.
3. Veri anahtarını kasa anahtarıyla kilitler → sunucuya "1. kasa" olarak gönderir.
4. Bir **kurtarma kodu** üretir, sana gösterir, son dört karakterini yazdırır.
5. Veri anahtarını kurtarma koduyla da kilitler → sunucuya "2. kasa" olarak gönderir.
6. Veri anahtarını tarayıcının kendi deposuna koyar (§4.4).

Sunucunun elinde kalan: e-postan, giriş jetonunun karıştırılmış hâli, iki kilitli kasa. Hiçbiri tek başına veriyi açmaz.

### 4.2 Bir harcama girmek

"Migros'a 450 TL" yazdığını düşün:

```
Tarayıcı                                          Sunucu
────────                                          ──────
1. Form: {tarih: 12 Eylül, hesap: 1,
          ad: "Migros", tutar: -450}
2. Hassas alanları ayır:
     düz:   tarih, hesap
     kutu:  {ad: "Migros", tutar: -450}
3. Kutuyu veri anahtarıyla kilitle
     → "v1:q8Jd2…"
4. Gönder ───────────────────────────────────►  5. Satırı olduğu gibi yazar.
                                                   Kutunun içini göremez.
```

Bakiyenin değişmesi gibi yan etkiler de (hesaba bir hareket satırı eklenmesi) tarayıcıda hesaplanır ve kilitli kutu olarak gider.

### 4.3 Uygulamayı açmak

1. Tarayıcı sunucudan tüm satırları ister (tek istek).
2. Sunucu satırları kilitli kutularıyla birlikte yollar.
3. Tarayıcı her kutuyu veri anahtarıyla açar. Ekranlar açılmış veriyle, eskisi gibi çalışır.

Bakiye, net varlık, nakit takvimi, portföy getirisi — hepsinin matematiği zaten tarayıcıda çalışan ortak koddaydı (`packages/engine`). Değişen tek şey, verinin artık tarayıcıya kilitli gelip orada açılması.

### 4.4 Her açılışta parola sorulmaması

Günde birkaç kez açılan bir uygulamada her seferinde parola istemek kullanılamaz olurdu. Bu yüzden veri anahtarı, giriş yapıldıktan sonra tarayıcının kendi deposunda (IndexedDB) **"dışarı verilemez"** işaretiyle saklanır: sayfanın kodu bu anahtarla kutu açabilir, ama anahtarın kendisini okuyup bir yere kopyalayamaz. Çıkış yapınca silinir.

Oturum var ama anahtar yoksa (ör. tarayıcı verisi silinmişse) uygulama açılmaz, parolayı yeniden sorar.

### 4.5 Yeni cihaz

Telefondan ilk kez giriş yaptığında parolan yine kasa anahtarını türetir. Tarayıcı sunucudan 1. kasayı alır ve açar; aynı veri anahtarı artık telefonda da vardır. Cihazlar arasında anahtar taşımak gerekmez, parola yeterlidir.

---

## 5. Sunucu neyi görür, neyi görmez?

| Görür (düz) | Görmez (kilitli) |
|---|---|
| E-posta, kayıt tarihi, giriş zamanları, IP | Her **tutar**: harcama, maaş, bakiye, adet, fiyat, limit |
| **Tarihler**: hangi gün bir kayıt olduğu | Her **ad ve not**: işyeri, kalem adı, hesap adı, kart adı |
| **Bağlantılar**: hangi harcama hangi kartta, hangi hesapta | Kategori adları |
| Her tablodaki **satır sayısı** (kaç işlem, kaç hesap) | Kâr/zarar |
| Kayıt **türleri** (gelir mi gider mi, ALIŞ mı SATIŞ mı) | Asistan **sohbet geçmişi** (saklanan hâli) |
| **Hangi sembolleri** tuttuğun (THYAO, AFT…) | Kaç adet, kaça aldığın |
| Kutunun kaba boyu | |

Özet: *"12 Eylül'de 1 numaralı kartta bir harcama var"* görünür. *"Migros'a 450 TL"* görünmez.

**Semboller neden açık?** Senin kararın. Fiyat güncelleme işi (her 30 dakikada bir sunucuda çalışan cron) hangi sembollerin fiyatını çekeceğini bilmeli. Sembolleri kilitlemek, fiyat servisini tamamen tarayıcıya taşımayı ya da ayrı bir karmaşık düzen kurmayı gerektirirdi. Karşılığında sızan bilgi "bu kişi THYAO tutuyor" — kaç tane, kaça aldığı değil.

**Tarihler neden açık?** Tek başına bir tarih kimseye bir şey söylemez, ama veritabanının sıralama, "bu ayın kaydı zaten yazıldı mı" kontrolü gibi temel işleri tarihe dayanır. Onları kilitlemek bu işleri bozar ya da çok karmaşıklaştırırdı.

---

## 6. Bazı işler tarayıcıya taşındı — neden?

Kilitli bir sayıyla toplama yapılamaz. Sunucu tutarı göremiyorsa hesaplayamaz da. Bu yüzden eskiden sunucunun yaptığı üç iş tarayıcıya geçti:

### 6.1 Bakiye

Eskiden her hesabın bakiyesi ayrı bir kolonda duruyordu ve sunucu her işlemde onu güncelliyordu. Artık bakiye kolonu **yok**: bakiye, o hesabın hareketlerinin toplamıdır ve tarayıcı her açılışta toplar. Bu zaten doğru tanımdı; eski kolon aynı bilginin ikinci kopyasıydı ve bazen birbirinden ayrışma riski taşıyordu. O risk de ortadan kalktı.

### 6.2 Otomatik ödeme ve düzenli kalemler

"Kira her ayın 5'inde Garanti hesabımdan otomatik düşsün" ya da "kart ekstresini vade günü hesaptan öde" talimatları eskiden sunucuda çalışan bir zamanlayıcıyla yazılıyordu. Sunucu tutarı göremediği için artık bunları **uygulamayı açtığında tarayıcı yazar**.

- Kaydın tarihi, **kalemin gerçek günüdür**, açtığın gün değil. 5 Eylül'de düşmesi gereken kira 9 Eylül'de açtığında yazılsa bile kayıt "5 Eylül" tarihlidir. Sonuç, zamanında yazılmış olanla birebir aynıdır.
- Uygulamayı aylarca açmasan da, **talimatı verdiğin günden** sonraki bütün kaçırılmış kalemler ilk açılışta yazılır. (Önceden 10/45 günlük bir sınır vardı; o kaldırıldı.)
- Talimattan **önceki** tarihlere dokunulmaz — onları elle girmiş olabilirsin.
- Aynı kalem iki kez yazılamaz: veritabanı "bu kalemin bu ayı zaten var" kontrolünü tarih üzerinden yapar (tarih açık olduğu için bu hâlâ çalışır).

Takas: uygulamayı açmadığın sürece bakiyen o kalemi **göstermez**. Açtığın an düzelir.

### 6.3 Asistan

Asistanın "beyni" (hangi aracı çağıracağı, tutarların nasıl hesaplanacağı, onay kartının ne yazacağı) artık tarayıcıda çalışır, çünkü verini okuyabilen tek yer orası.

Ama yapay zekâ modeline (Gemini vb.) giden istek **hâlâ sunucudan geçer**, çünkü modelin API anahtarı sunucuda durmak zorunda — tarayıcıya koysaydık herkes görüp kullanabilirdi. Sunucu bu noktada bir **röle** (aktarıcı) gibi çalışır: tarayıcıdan gelen isteği modele iletir, cevabı geri verir, **hiçbir şeyi diske yazmaz, loglamaz**.

Bunun anlamı: **asistanı kullandığın an**, yazdığın cümle ve asistanın o soruyu cevaplamak için ihtiyaç duyduğu bilgiler (hesap adların, bakiyelerin, sorduğun harcama toplamı gibi) sunucunun belleğinden **açık** geçer ve model sağlayıcısına gider. Şifreleme bu yolu kapsamaz. Asistanı hiç kullanmayan kullanıcı için bu yol hiç açılmaz; ayrıca **Hesabım** ekranından asistan kapatılabilir.

---

## 7. Mevcut veriler nasıl şifrelendi?

Canlıda zaten düz metin veri vardı. Dönüşüm iki adımda, kendiliğinden gerçekleşir:

1. **Sunucu, yeni sürüm ilk açıldığında**: her tablodaki hassas kolonları (ad, tutar…) tek bir `enc` kolonunda toplar ve eski kolonları siler. Bu aşamada veri hâlâ **şifresizdir**, sadece yeni biçime taşınır (başında `p1:` yazar = "düz"). Amaç en riskli adımı (kolon silmeyi) şifreleme karmaşası olmadan yapmak.
2. **Her kullanıcının ilk girişinde, kendi tarayıcısında**: kurtarma kodu gösterilir ve kaydedilir → tarayıcı `p1:` satırlarını çeker → her birini kilitler → göndermeden önce **kilidi geri açıp orijinaliyle karşılaştırır** → yalnız eşleşeni gönderir. Sunucu hiç düz satır kalmadığını kendisi sayınca "bu kullanıcının göçü bitti" der ve o andan sonra o kullanıcıdan düz veri kabul etmez.

Yarıda kalırsa (sekme kapandı, bağlantı koptu) zarar yok: iki biçim yan yana okunur, kalan satırlar sonraki açılışta kilitlenir.

Bu, prod verisinin bir kopyasında denendi: 217 satır, alan alan karşılaştırmada sıfır fark, bakiyeler eski değerlerle kuruşu kuruşuna aynı.

**Sen sunucuyu işleten kişi olarak bu dönüşümü yapamazsın ve yapmamalısın**: anahtar sende değil. Bir kullanıcı hiç giriş yapmazsa onun verisi `p1:` (düz) biçimde kalır — şifreleme her kullanıcı için kendi ilk girişiyle başlar.

---

## 8. Güçlü yanlar

1. **En olası risklerin tamamı kapanır.** Gerçek hayatta verinin sızmasının yolları: veritabanı dökümünün sızması, `DATABASE_URL`'in çalınması, bir laptopta unutulmuş yedek, barındırma şirketindeki biri, meraklı bir bakış. Bunların hiçbiri artık tutar ya da ad göstermez.
2. **Geçmişe dönük korumadır.** Bugün alınmış bir yedek, yarın sunucu ele geçirilse bile açılamaz.
3. **Standart, kopyalanmış bir tasarım.** Kullanılan yöntemler (AES-256-GCM, PBKDF2 600.000 tur, HKDF, "parola tarayıcıdan çıkmaz + ayrı giriş jetonu", "anahtarı iki kez kilitleme") Bitwarden ve 1Password'ün yayımlanmış tasarımlarının aynısıdır. Kriptografiyi biz yazmadık; tarayıcının kendi kütüphanesini çağırıyoruz.
4. **Hiçbir şifreleme npm paketi yok.** Kötü niyetli bir kütüphane güncellemesi anahtarı sızdırmanın en kolay yolu olurdu; o kapı yok.
5. **Unutulma hatası derleme sırasında yakalanır.** Birisi ileride yeni bir hassas kolon ekleyip şifrelemeyi unutursa `pnpm build` durur. Aynı şekilde, şifreleme boru hattını atlayarak veri gönderen yeni bir kod yazılırsa build yine durur. "Unuttum" hatası sessizce canlıya çıkamaz.
6. **Parola değişimi ucuzdur**, veriyi yeniden şifrelemeyi gerektirmez.
7. **E-postası ele geçirilen bir hesapta** saldırgan "şifremi unuttum" ile veriyi **okuyamaz**; kurtarma kodu olmadan en fazla silebilir.
8. **Ayrıcalıklı yazma yolu kalmadı.** Eskiden asistan sunucunun içinden özel bir yolla yazıyordu; artık o da senin gibi normal uçlara, senin oturumunla yazar.

---

## 9. Zayıf yanlar — dürüst liste

### 9.1 Kodu sunucu gönderiyor

Tarayıcı, çalıştıracağı JavaScript'i **aynı sunucudan** indirir. Sunucuyu kontrol eden biri (sen ya da sunucuyu ele geçiren biri) anahtarı sızdıran bir sürüm yayınlarsa, o andan sonra giriş yapanların anahtarı toplanabilir. Tarayıcının "bu kod dürüst mü" diye kontrol etmesinin bir yolu yok.

Bu, web üzerindeki bütün şifreli uygulamaların ortak sınırıdır (Proton Mail'in ve Bitwarden'ın web sürümleri dahil). Bu yüzden söylenebilecek doğru cümle şudur:

> ✅ "Veritabanında duran kayıtlarını okuyamam."
> ❌ "Hiçbir şekilde erişemem."

Durumu hafifleten üç şey: bu **aktif** bir eylemdir (git geçmişinde iz bırakır), yalnız **ileriye** işler (dünkü yedeği açamaz), ve kod açıktır.

### 9.2 Asistan kullanıldığında veri açık geçer

§6.3'te anlatıldı. Asistana yazılan cümle ve cevaplamak için gereken bilgiler, sunucu belleğinden ve model sağlayıcısından düz geçer. Diske yazılmaz ama o an açıktır.

Ayrıca röle, tarayıcıdan gelen bilgiye güvenmek zorundadır (sunucu gerçeğini göremez). Giriş yapmış biri röleyi taklit edilmiş isteklerle kendi amacı için kullanmaya çalışabilir. Buna karşı önlemler var (bilinen alanlar dışındakiler atılır, metinler kısaltılır, geçmiş denetlenir, kullanıcı başına günlük 300 tur tavanı), ama "biçimce doğru" bir sahte istek hâlâ geçebilir. Zarar veri sızıntısı değil, API kotasının harcanmasıdır — kişi yalnız kendi verisini görebilir.

### 9.3 Parola + kurtarma kodu kaybolursa veri gider

Kimsenin geri getiremeyeceği tek durum budur. Destek vermek isteyen bir operatör olarak bu senin de elini bağlar: "verimi kurtarır mısın?" sorusuna cevap her zaman "hayır"dır.

### 9.4 Zayıf parola, sızan veritabanında kırılabilir

Veritabanı sızarsa kilitli kasa da sızar ve çalan kişi evinde parola deneyebilir. 600.000 tur bunu çok yavaşlatır, ama "123456" gibi bir parolayı kurtaramaz. Bu yüzden yeni parola kuralı sertleştirildi (en az 12 karakter, yaygın kalıp yok, e-posta parolada geçemez). Eski kısa parolalar girişi engellemez ama uygulama değiştirmeyi önerir.

### 9.5 Açık bırakılmış cihaz korunmaz

Anahtar giriş yapılmış tarayıcıda durur. Kilidi açık, çalınmış bir telefonda uygulama açılır ve veri görünür. Tehdit modelindeki karşı taraf sunucudur, cihazı eline geçiren değil — bu açığı şifreleme getirmedi, yalnız kapatmıyor (önceden de açık oturum aynı erişimi veriyordu). Zararı sınırlayanlar: oturum en fazla 7 gün sürer ve düşünce tarayıcı anahtarı siler; başka cihazdan parola değiştirmek diğer tüm oturumları kapatır; çözülmüş veri diske yazılmadığından internetten kesilmiş cihaz yenilendiğinde hiçbir şey göstermez. Omuz üstünden bakana karşı bakiye gizleme modu ayrıca var. **Karar (2026-09-28): böyle kalıyor** — açılışta/boşta kalınca kilit istemek değerlendirildi, yapılmadı.

### 9.6 Sunucu sıralamayı ve toplamayı bilemez, ama satırlarla oynayabilir

Kutu etiketi (§3.5) bir kutunun **başka kullanıcıya ya da tabloya** taşınmasını yakalar. Ama sunucu kötü niyetliyse **aynı kullanıcının** iki kutusunu yer değiştirebilir, bir satırı silebilir ya da eski bir hâline geri döndürebilir; bu fark edilmez. Bu da §9.1 ile aynı sınıftır (kötü niyetli sunucu kapsam dışı).

### 9.7 Tek bozuk satır uygulamayı açtırmaz

Açılışta bütün kutular birlikte açılır. Bir tanesi açılamazsa (bozulmuş veri, anahtar uyuşmazlığı) uygulamanın tamamı hata verir; bozuk satırı atlayıp geri kalanı göstermez. Bu bilinçli bir güvenlik tercihidir (sessizce eksik veri göstermek, yanlış bakiye göstermek demektir), ama bir kullanıcının tek bir satırı yüzünden hiç giriş yapamaması anlamına da gelir — ve sen o satırı veritabanından açıp düzeltemezsin. **Karar (2026-09-28): böyle kalıyor.** Değerlendirilip ertelenen ara yol: uygulamayı salt okunur açıp açılamayan satırları (tablo + id) göstermek, yazma/otomatik ödeme/mutabakatı o satırlar çözülene dek kapatmak.

### 9.8 Bağımsız denetim yok

Kullanılan parçalar standart ve tasarım kopyalanmış olsa da, bu projenin şifreleme kodu bir güvenlik firmasınca denetlenmedi. "Denetlendi" denemez.

---

## 10. Sisteme etkisi

### 10.1 Hız

| Ne | Etkisi |
|---|---|
| Uygulamanın açılışı | Kutuları açmak için ek süre. Ölçüm: 8.000 satırda (yıllarca yoğun kullanım) masaüstünde ~50 ms, orta telefonda ~215 ms. Bugünkü gerçek hesap ~200 satır → masaüstünde ~1,5 ms, telefonda ~6 ms. Fark edilmez. |
| Giriş | Parola hesabı bilinçli olarak yavaştır; girişte bir kez kısa bir bekleme. |
| Kayıt girme | Tek kutu kilitlemek mikro saniyeler — fark edilmez. |
| Asistan | Biraz **hızlandı**: eskiden her mesajda sunucu 9 ayrı veritabanı sorgusu atıyordu; artık bağlam tarayıcıdaki hazır veriden kuruluyor. |
| Sunucu yükü | Azaldı: tutar hesaplamıyor, bakiye güncellemiyor, otomatik ödeme cron'u çalışmıyor. |

Önbellek (açılmış veriyi cihazda saklamak) tasarlandı ama **yapılmadı**: ölçülen süreler buna ihtiyaç göstermiyor ve önbellek, cihazda düz metin saklamak demekti. Telefonda 300 ms'yi aşan gerçek bir kullanıcı çıkarsa yeniden düşünülür.

### 10.2 Uygulamanın yapabildikleri — ne değişmedi

Kullanıcı açısından ekranlar ve sonuçlar aynıdır. Aynı hesaplama kodu (engine) aynı veriyle aynı rakamı üretir. Fiyat güncelleme, referans endeksler, kurumsal olaylar, mail gönderimi değişmedi.

### 10.3 Değişen davranışlar

- **Otomatik kalemler uygulama açılınca yazılır**, sunucuda arka planda değil (§6.2).
- **Kurtarma kodu zorunlu**; mevcut her kullanıcı ilk girişinde bir kez görür.
- **"Şifremi unuttum"** artık iki yol sunar: kurtarma koduyla (veri kalır) ya da veriyi silerek (açık onayla).
- **Veri indirme (KVKK)** çalışır ve açık metin verir (tarayıcı açıp indirir), ama indirilen dosya uygulamaya geri **yüklenemez**; bir yedek değil, bir dökümdür.

### 10.4 Senin (operatörün) işine etkisi — en çok hissedeceğin kısım

- **Veritabanına bakıp hata ayıklayamazsın.** "Bakiyem yanlış görünüyor" diyen bir kullanıcının rakamlarını SQL ile göremezsin. Hata ayıklama ancak kullanıcının kendi ekranından (ya da kendi indirdiği dökümden) yapılabilir.
- **Veriyi SQL ile düzeltemezsin.** Tutarı ya da adı değiştiren bir `UPDATE` yazılamaz; o alanlar kutunun içinde. Tarih, bağlantı ve tür gibi açık alanlar hâlâ düzeltilebilir.
- **Sunucu tarafında tutar gerektiren yeni özellikler yapılamaz.** Örnek: "ekstren 5.000 TL, yarın son gün" diye e-posta ya da bildirim göndermek, sunucuda istatistik/rapor üretmek, kullanıcılar arası toplam almak. Böyle bir ihtiyaç ancak tarayıcıda (uygulama açıkken) çözülebilir. Bu bilinçli, tek yönlü bir kapıdır.
- **Yeni tablo ya da kolon eklerken bir karar vermen gerekir**: bu alan kilitli mi olacak, açık mı? Build seni durdurup sorar (`packages/crypto/src/map.ts`).

---

## 11. Sık sorulan sorular

**Her şey artık tarayıcıda mı çalışıyor?**
Hayır. Sunucu hâlâ: giriş/oturum yönetimi, verinin saklanması, fiyat çekme, mail gönderme, asistan rölesi, güvenlik sınırları (hız sınırı vb.) işlerini yapar. Tarayıcıya geçen yalnızca **tutarla hesap yapan** işlerdir, çünkü tutarı yalnız tarayıcı görebilir. Hesaplama kodunun büyük kısmı zaten tarayıcıdaydı.

**Ben (operatör) gerçekten göremiyor muyum?**
Veritabanındaki kayıtları göremezsin. Kötü niyetli bir kod yayınlayıp **bundan sonra** giriş yapanların anahtarını toplayabilirdin — bu, web'de önlenemeyen bir sınırdır ve dürüstçe böyle söylenmelidir.

**Veritabanı çalınırsa ne olur?**
Tutarlar ve adlar okunamaz. Tarihler, bağlantılar, semboller, satır sayıları okunur. Zayıf parolası olan kullanıcının kasası zamanla kırılabilir; güçlü parolalı kullanıcınınki pratikte kırılamaz.

**Neon (veritabanı şirketi) ne görür?**
Senin gördüğünün aynısı: kilitli kutular.

**Gemini (yapay zekâ sağlayıcısı) ne görür?**
Yalnız asistan kullanıldığında, o konuşmada modelin gördüğü şeyleri: yazılan cümle, hesap/kart/kategori adları ve bakiyeler, sorunun cevabı için hesaplanan toplamlar. Asistanı kullanmayan kullanıcı hakkında hiçbir şey.

**Parola değiştirince eski cihazlar ne olur?**
Diğer cihazlardaki oturumlar kapanır; yeni parolayla tekrar giriş yapılır. Veri yeniden şifrelenmez, kurtarma kodu değişmez.

**Kurtarma kodunu kaybettim ama parolamı biliyorum.**
Sorun yok, veri parolayla açılır. (Kod yalnız parolayı unuttuğunda gerekir.)

---

## 12. Küçük sözlük

| Terim | Anlamı |
|---|---|
| **E2EE / sıfır bilgi** | Verinin kilidini yalnız kullanıcının açabildiği düzen. |
| **DEK (veri anahtarı)** | Bütün kayıtları kilitleyen rastgele anahtar. Tarayıcı üretir, sunucu açık hâlini hiç görmez. |
| **KEK (kasa anahtarı)** | Paroladan türeyen, DEK'i kilitleyen anahtar. Tarayıcıda kalır. |
| **Kurtarma kodu** | DEK'in ikinci kopyasını kilitleyen yedek kod. |
| **Giriş jetonu** | Paroladan türeyen, sunucuya yalnız "parolayı biliyorum" kanıtı olarak giden değer. |
| **Zarf (`enc`)** | Satırın hassas alanlarını taşıyan kilitli kutu. `v1:` = şifreli, `p1:` = göç sırasında geçici düz biçim. |
| **AAD (kutu etiketi)** | Kutunun hangi kullanıcıya/tabloya ait olduğunu bağlayan görünmez etiket. |
| **PBKDF2 600k** | Paroladan anahtar türeten, kasıtlı olarak yavaş hesap. |
| **AES-256-GCM** | Kilitleme yöntemi. Kutuya dokunulmuşsa açılmayı reddeder. |
| **Röle** | Asistan isteğini yapay zekâ sağlayıcısına aktaran, hiçbir şey saklamayan sunucu ucu. |
| **Göç** | Eski düz verinin kilitli biçime dönüştürülmesi. |

---

## 13. Daha derini

- Kararların gerekçeleri, ölçümler, tasarımdan sapmalar: [E2EE.md](E2EE.md)
- Hangi alan kilitli, hangisi açık ve neden: [packages/crypto/src/map.ts](../packages/crypto/src/map.ts)
- Anahtarların türetilmesi: [packages/crypto/src/keys.ts](../packages/crypto/src/keys.ts)
- Yazma boru hattı: [apps/web/src/yazim/](../apps/web/src/yazim/index.ts)
- Tarayıcı göçü: [apps/web/src/yazim/goc.ts](../apps/web/src/yazim/goc.ts)
- Asistan rölesinin denetimi: [packages/asistan/src/role.ts](../packages/asistan/src/role.ts)
