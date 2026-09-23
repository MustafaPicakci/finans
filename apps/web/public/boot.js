/* ————— açılış betiği: paket inmeden ÖNCE yapılması gereken iki iş —————
   Neden ayrı dosya? Sunucu `script-src 'self'` CSP'si gönderiyor (apps/server/index.ts) —
   satır içi bir <script> dev'de çalışır, prod'da sessizce ENGELLENİR; en kötü cinsten bir
   hata. `<head>`'de ve defer/async YOK: gövde ayrıştırılmadan, yani ilk boyamadan önce koşar.

   1) TEMA. `data-theme` React'in bir useEffect'inde set ediliyordu (App.tsx), yani koyu
      temadaki kullanıcı HER yenilemede önce beyaz bir kare görüyordu (index.html'in taban
      arka planı açık temanındı). Aynı şey depoda tercihi olmayan ve sistemi koyu olan
      kullanıcıda ters yönde oluyordu: themeCSS'in `prefers-color-scheme` bloğu koyu
      boyuyor, React mount olunca açığa dönüyordu.
   2) `js` SINIFI. index.html'deki tanıtım bloğu JS ÇALIŞTIRMAYAN istemciler için orada
      (Faz 28: Google'ın OAuth marka doğrulaması, önizleme botları). Tarayıcıda ise
      ~880 KB'lik paket inene kadar ekranda DURUYOR — `<script type="module">` defer'lidir,
      yani HTML boyanır, paket sonra indirilir; kullanıcının her yenilemede gördüğü
      "gelip giden ekran" buydu. Sınıf, index.html'deki stil kuralıyla o bloğu gizler ve
      yerine yükleme göstergesini açar. Betik çalışmazsa (JS kapalı, bot) hiçbir şey
      gizlenmez — tanıtım metni yerinde kalır, yani 1. maddedeki gerekçe bozulmaz. */
(function () {
  var html = document.documentElement;
  html.className = html.className ? html.className + " js" : "js";
  /* Anahtar theme.ts'teki THEME_KEY ile aynı olmak zorunda; yazılan tek iki değer
     "light" ve "dark" olduğundan burada yalnız "dark" aranır. */
  var tema = "light";
  try { if (localStorage.getItem("finans-theme") === "dark") tema = "dark"; } catch (e) { /* özel pencere / engellenmiş depolama */ }
  html.setAttribute("data-theme", tema);
  var meta = document.querySelector('meta[name="theme-color"]'); // tarayıcı çubuğu da parlamasın
  if (meta) meta.setAttribute("content", tema === "dark" ? "#0D0D11" : "#F4F3F0");
})();
