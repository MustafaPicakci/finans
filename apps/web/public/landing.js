(function () {
  "use strict";
  var cv = function (v) { return "var(--" + v + ")"; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- tema ---------- */
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("finans-landing-tema");
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (e) { /* gizli sekme / kapalı depolama: sistem tercihi geçerli kalır */ }
  $("themeBtn").addEventListener("click", function () {
    var dark = getComputedStyle(root).getPropertyValue("--ground").trim().toLowerCase().indexOf("#0d0d11") === 0;
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("finans-landing-tema", next); } catch (e) {}
  });

  /* ---------- hero sparkline ---------- */
  (function () {
    var vals = [62, 64, 63, 68, 71, 70, 74, 79, 77, 83, 86, 92], W = 560, H = 90;
    var n = vals.length, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rng = (mx - mn) || 1;
    var x = function (i) { return i * W / (n - 1); }, y = function (v) { return (H - 6) - (v - mn) / rng * (H - 16); };
    var line = "M" + vals.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" L");
    var a = $("heroLine"), b = $("heroArea");
    if (a) a.setAttribute("d", line);
    if (b) b.setAttribute("d", line + " L" + W + "," + H + " L0," + H + " Z");
  })();

  /* ---------- özellikler: bölüm sekmeleri ---------- */
  var soft = function (t) { return "color-mix(in srgb," + cv(t) + " 13%,transparent)"; };
  var features = {
    ozet: {
      title: "Özet", glyph: "◧", tone: cv("pos"), soft: cv("pos-soft"), tabs: "tek ekran",
      head: "Net varlığınız tek sayıda, kaynakları tek bakışta",
      body: "Nakit, portföy, vadeli mevduat ve borçlar aynı hesaba girer. Net varlık, hesap dağılımı, varlık dağılımı ve Nakit Haritası açılışta karşınızda.",
      points: ["Net varlık = nakit + portföy + vadeli − kart ve kredi borcu", "Önümüzdeki günlerin likit nakit eğrisi", "Hesap bazında nakit ve varlık türüne göre dağılım", "Yaklaşan hareketler ve nakit açığı uyarısı"],
      demoTitle: "Net varlık kırılımı", demoMeta: "örnek",
      demo: [
        { name: "Nakit", meta: "4 hesap", value: "₺297.000", color: cv("ink"), dot: cv("t-nakit") },
        { name: "Portföy", meta: "6 varlık türü", value: "₺1.243.400", color: cv("ink"), dot: cv("brand") },
        { name: "Kart borcu", meta: "2 ekstre", value: "−₺48.600", color: cv("neg"), dot: cv("t-kripto") },
        { name: "Kredi borcu", meta: "2 kredi", value: "−₺512.000", color: cv("neg"), dot: cv("t-altin") }
      ],
      footLabel: "Net varlık", footValue: "₺979.800", footColor: cv("ink")
    },
    nakit: {
      title: "Nakit Akışı", glyph: "≋", tone: cv("t-nakit"), soft: soft("t-nakit"), tabs: "Takvim · Liste",
      head: "Ayın 20'sinde elinizde ne kalacağını bugün görün",
      body: "Düzenli gelir ve giderler, kart ekstreleri ve kredi taksitleri tek projeksiyona akar. Takvimde her günün sonundaki nakit, listede her işlemden sonra kalan bakiye yazar.",
      points: ["Varsayılan 6 aylık projeksiyon — süreyi Özet'ten değiştirirsiniz", "Gün gün takvim görünümü ve en düşük nokta", "Her işlemden sonra kalan bakiye", "Ödeme öncesi açık varsa \u201Cfon boz\u201D önerisi"],
      demoTitle: "Yaklaşan hareketler", demoMeta: "kalan nakit",
      demo: [
        { name: "Kira geliri", meta: "15 Ağu · düzenli gelir", value: "₺313.000", color: cv("pos"), dot: cv("pos") },
        { name: "Yapı Kredi ekstresi", meta: "18 Ağu · kart", value: "₺284.600", color: cv("neg"), dot: cv("t-kripto") },
        { name: "Taşıt kredisi taksiti", meta: "20 Ağu · kredi", value: "₺275.500", color: cv("neg"), dot: cv("t-altin") },
        { name: "Maaş", meta: "25 Ağu · düzenli gelir", value: "₺337.500", color: cv("pos"), dot: cv("pos") }
      ],
      footLabel: "En düşük nokta · 14 Eyl", footValue: "₺84.200", footColor: cv("warn")
    },
    borc: {
      title: "Kartlar & Krediler", glyph: "◱", tone: cv("t-kripto"), soft: soft("t-kripto"), tabs: "Kartlar · Plan",
      head: "Ekstre, taksit ve kredi projeksiyona kendiliğinden akar",
      body: "Kart borcu, kesim ve son ödeme tarihleri ve taksitli harcamalar Kartlar sekmesinde; krediler Plan'da. İkisi de nakit projeksiyonuna otomatik yansır.",
      points: ["Kart limiti, kullanım oranı ve kullanılabilir tutar", "Harcama kesim gününe göre doğru ekstreye düşer", "Taksitli harcama ardışık ekstrelere bölünür", "Kredide kalan taksit tarihten hesaplanır; biten kredi projeksiyondan düşer"],
      demoTitle: "Borç kalemleri", demoMeta: "örnek",
      demo: [
        { name: "Yapı Kredi World", meta: "kesim 18 Ağu · limit ₺75.000", value: "−₺28.400", color: cv("neg"), dot: cv("t-nakit") },
        { name: "Garanti Bonus", meta: "kesim 24 Ağu · limit ₺50.000", value: "−₺20.200", color: cv("neg"), dot: cv("t-etf") },
        { name: "Konut kredisi", meta: "92/120 taksit ödendi", value: "−₺18.300", color: cv("neg"), dot: cv("t-altin") },
        { name: "Taşıt kredisi", meta: "27/36 taksit ödendi", value: "−₺9.100", color: cv("neg"), dot: cv("t-bist") }
      ],
      footLabel: "Aylık toplam borç ödemesi", footValue: "₺37.100", footColor: cv("neg")
    },
    portfoy: {
      title: "Portföy", glyph: "◫", tone: cv("brand"), soft: cv("brand-soft"), tabs: "pozisyon + işlem",
      head: "Altı varlık türü, tek maliyet-değer mantığı",
      body: "BIST, yatırım fonu, altın, döviz, kripto ve ABD hisse/ETF aynı tabloda. Her pozisyonun ortalama maliyeti, güncel değeri, açık kâr–zararı ve ağırlığı yan yana durur.",
      points: ["Açık ve gerçekleşen kâr–zarar ayrı ayrı", "Değer grafiği kârı konan paradan ayırır, referans endekslerle karşılaştırır", "Portföy grupları: aynı sembol iki grupta ayrı maliyet", "Dolar bazlı varlıklar kendi biriminde, toplamlar TL"],
      demoTitle: "Pozisyonlar", demoMeta: "açık K/Z",
      demo: [
        { name: "GRAM · Gram altın", meta: "120 gr · ort. ₺2.450", value: "+₺64.200", color: cv("pos"), dot: cv("t-altin") },
        { name: "USD · Dolar", meta: "5.000 · ort. ₺32,10", value: "+₺36.500", color: cv("pos"), dot: cv("t-doviz") },
        { name: "THYAO", meta: "400 lot · ort. ₺285", value: "+₺10.800", color: cv("pos"), dot: cv("t-bist") },
        { name: "BTC · Bitcoin", meta: "0,12 · ort. $58.000", value: "+₺162.300", color: cv("pos"), dot: cv("t-kripto") }
      ],
      footLabel: "Toplam portföy", footValue: "₺1.243.400", footColor: cv("ink")
    },
    asistan: {
      title: "Asistan", glyph: "◍", tone: cv("t-fon"), soft: soft("t-fon"), tabs: "yaz, söyle, paylaş",
      head: "İşlemi anlatın, kayda o çevirsin",
      body: "Ne yaptığınızı gündelik dille yazarsınız; asistan bunu bir kayıt planına çevirir ve önce onayınıza sunar. Siz onaylamadan hiçbir şey yazılmaz.",
      points: ["Her plan onay kartında görünür — satırları çıkarabilirsiniz", "Uyguladığınız planı tek düğmeyle geri alın", "Sesle yazdırma tarayıcıda çalışır; ses sunucuya gitmez", "Android'de banka SMS'ini \u201CPaylaş → Finans\u201D ile gönderin"],
      demoTitle: "Onay bekleyen plan", demoMeta: "uygulanmadan önce",
      demo: [
        { name: "\u201CMigros\u2019ta 3.240 harcadım\u201D", meta: "gider · Market · Vakıfbank", value: "−₺3.240", color: cv("neg"), dot: cv("t-nakit") },
        { name: "\u201CMaaş yattı\u201D", meta: "gelir · Vakıfbank", value: "+₺62.000", color: cv("pos"), dot: cv("pos") },
        { name: "\u201CYapı Kredi ekstresini öde\u201D", meta: "tutarı sunucu hesaplar", value: "−₺28.400", color: cv("neg"), dot: cv("t-kripto") }
      ],
      footLabel: "Onaylamadan hiçbiri yazılmaz", footValue: "3 kayıt", footColor: cv("ink")
    }
  };
  var featureOrder = ["ozet", "nakit", "borc", "portfoy", "asistan"];
  var activeFeature = "nakit";

  $("sectionTabs").innerHTML = featureOrder.map(function (k) {
    var d = features[k];
    return '<button type="button" class="sect-btn" role="tab" data-k="' + k + '" aria-selected="false">' +
      '<span style="width:28px;height:28px;border-radius:9px;background:' + d.soft + ';color:' + d.tone + ';display:grid;place-items:center;font-size:13px;font-weight:700">' + esc(d.glyph) + '</span>' +
      '<div style="font-size:14.5px;font-weight:700;margin-top:12px;letter-spacing:-.01em">' + esc(d.title) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">' + esc(d.tabs) + '</div></button>';
  }).join("");

  function renderFeature(k) {
    activeFeature = k;
    var d = features[k];
    Array.prototype.forEach.call($("sectionTabs").children, function (b) {
      b.setAttribute("aria-selected", String(b.dataset.k === k));
    });
    var t = $("fTitle");
    t.textContent = d.title; t.style.background = d.soft; t.style.color = d.tone;
    $("fHead").textContent = d.head;
    $("fBody").textContent = d.body;
    $("fPoints").innerHTML = d.points.map(function (p) {
      return '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:var(--ink-2);line-height:1.45">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="' + d.tone + '" stroke-width="1.9" style="flex-shrink:0;margin-top:2px" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>' +
        esc(p) + '</div>';
    }).join("");
    $("fDemoTitle").textContent = d.demoTitle;
    $("fDemoMeta").textContent = d.demoMeta;
    $("fDemo").innerHTML = d.demo.map(function (r) {
      return '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2)">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + r.dot + ';flex-shrink:0"></span>' +
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.name) + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink-3);margin-top:1px">' + esc(r.meta) + '</div></div>' +
        '<span class="mono" style="font-size:12.5px;font-weight:500;color:' + r.color + ';white-space:nowrap">' + esc(r.value) + '</span></div>';
    }).join("");
    $("fFootLabel").textContent = d.footLabel;
    $("fFootValue").textContent = d.footValue;
    $("fFootValue").style.color = d.footColor;
  }
  $("sectionTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-k]");
    if (b) renderFeature(b.dataset.k);
  });
  renderFeature(activeFeature);

  /* ---------- veri girişi paneli ---------- */
  var chips = function (label, list, active) { return { label: label, isChips: true, options: list, active: active }; };
  var field = function (label, value, mono) { return { label: label, value: value, mono: !!mono }; };
  var forms = {
    kalem: {
      amountLabel: "Tutar", amount: "3.240",
      fields: [chips("Tür", ["Gider", "Gelir"], "Gider"), chips("Kategori", ["Market", "Yeme-içme", "Ulaşım", "Fatura"], "Market"), field("Hesap", "Vakıfbank Vadesiz"), field("Tarih", "11 Ağu 2026", true)],
      effect: "Bugün/geçmiş tarihli → bakiyeye işler; ileri tarihli → plana girer"
    },
    transfer: {
      amountLabel: "Transfer tutarı", amount: "25.000",
      fields: [field("Gönderen", "Vakıfbank Vadesiz"), field("Alan", "Enpara"), field("Tarih", "11 Ağu 2026", true), field("Açıklama", "Birikim hesabına")],
      effect: "İki bacağı tek kayıtta yazar; gelir/gider sayılmaz, net varlık değişmez"
    },
    cardtx: {
      amountLabel: "Harcama tutarı", amount: "4.500",
      fields: [field("Kart", "Yapı Kredi World"), chips("Taksit", ["Tek çekim", "3", "6", "12"], "12"), chips("Kategori", ["Market", "Teknoloji", "Giyim", "Diğer"], "Teknoloji"), field("Tarih", "11 Ağu 2026", true)],
      effect: "Kesim gününe göre doğru ekstreye düşer; taksitler ardışık ekstrelere bölünür"
    },
    duzenli: {
      amountLabel: "Aylık tutar", amount: "62.000",
      fields: [chips("Tür", ["Gelir", "Gider"], "Gelir"), field("Ad", "Maaş"), field("Ayın günü", "25", true), field("Hedef hesap", "Vakıfbank Vadesiz")],
      effect: "Her ay projeksiyona girer; tutarı sonradan değiştirmek geçmişi bozmaz"
    },
    trade: {
      amountLabel: "İşlem tutarı", amount: "59.200",
      fields: [chips("Yön", ["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"], "ALIŞ"), field("Sembol", "GRAM ALTIN"), field("Adet × Fiyat", "20 gr × ₺2.960", true), field("Hesap", "Enpara")],
      effect: "Pozisyona ve net varlığa yansır; hesap seçilirse bakiyeyi de oynatır"
    }
  };
  var entryOrder = [["kalem", "Gelir / Gider"], ["transfer", "Transfer"], ["cardtx", "Kart"], ["duzenli", "Düzenli"], ["trade", "Portföy"]];

  $("entryTabs").innerHTML = entryOrder.map(function (p) {
    return '<button type="button" class="chip" role="tab" data-e="' + p[0] + '" aria-selected="false">' + esc(p[1]) + "</button>";
  }).join("");

  function renderEntry(k) {
    var f = forms[k];
    Array.prototype.forEach.call($("entryTabs").children, function (b) {
      b.setAttribute("aria-selected", String(b.dataset.e === k));
    });
    $("eAmountLabel").textContent = f.amountLabel;
    $("eAmount").textContent = f.amount;
    $("eFields").innerHTML = f.fields.map(function (fl) {
      var head = '<div style="font-size:11px;font-weight:600;color:var(--ink-2);margin-bottom:5px">' + esc(fl.label) + "</div>";
      if (fl.isChips) {
        return "<div>" + head + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + fl.options.map(function (o) {
          var on = o === fl.active;
          var st = on ? "background:var(--brand);color:var(--brand-ink);font-weight:600"
                      : "background:var(--surface-3);border:1px solid var(--line);color:var(--ink-2);font-weight:500";
          return '<span style="padding:6px 11px;border-radius:999px;font-size:12px;' + st + '">' + esc(o) + "</span>";
        }).join("") + "</div></div>";
      }
      return "<div>" + head + '<div style="padding:9px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);font-size:13px;color:var(--ink)' +
        (fl.mono ? ";font-family:\'IBM Plex Mono\',monospace" : "") + '">' + esc(fl.value) + "</div></div>";
    }).join("");
    $("eEffectLabel").textContent = f.effect;
  }
  $("entryTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-e]");
    if (b) renderEntry(b.dataset.e);
  });
  renderEntry("kalem");

  /* ---------- varlık sınıfları ---------- */
  var assets = [
    { label: "Nakit hesapları", tag: "TL", tone: "t-nakit", pct: "19%" },
    { label: "Kıymetli maden", tag: "AU", tone: "t-altin", pct: "23%" },
    { label: "Döviz", tag: "$", tone: "t-doviz", pct: "13%" },
    { label: "BIST hisseleri", tag: "BI", tone: "t-bist", pct: "10%" },
    { label: "Yatırım fonları", tag: "FON", tone: "t-fon", pct: "8%" },
    { label: "ABD hisse & ETF", tag: "ETF", tone: "t-etf", pct: "12%" },
    { label: "Kripto", tag: "₿", tone: "t-kripto", pct: "15%" }
  ];
  $("assetList").innerHTML = assets.map(function (a) {
    return '<div class="card" style="display:flex;align-items:center;gap:12px;border-radius:14px;padding:12px 15px">' +
      '<span class="mono" style="width:28px;height:28px;border-radius:9px;background:' + soft(a.tone) + ';color:' + cv(a.tone) + ';display:grid;place-items:center;font-size:10.5px;font-weight:600;flex-shrink:0">' + esc(a.tag) + "</span>" +
      '<span style="flex:1;font-size:13.5px;font-weight:500;min-width:0">' + esc(a.label) + "</span>" +
      '<span style="width:52px;height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden;flex-shrink:0"><span style="display:block;height:100%;width:' + a.pct + ';background:' + cv(a.tone) + '"></span></span>' +
      '<span class="mono" style="font-size:11.5px;color:var(--ink-3);width:34px;text-align:right">' + a.pct + "</span></div>";
  }).join("");

  /* ---------- S.S.S. ----------
     Cevaplar DOM'da hep var, kapalı olan gizleniyor: arama motoru JS çalıştırmadan
     da tüm soru-cevabı görsün (sayfanın SEO işi bu). */
  var faqs = [
    { q: "Bankamı bağlamam gerekiyor mu?", a: "Hayır. Finans hiçbir banka hesabına bağlanmaz, banka kimlik bilgisi istemez. Hesaplarınızı ve düzenli kalemlerinizi bir kez tanımlarsınız, sonrası tek panelden birkaç saniyelik kayıt." },
    { q: "Verilerim nerede tutuluyor?", a: "Kayıtlarınız uygulamanın bulut veri tabanında, yalnız sizin hesabınıza bağlı olarak saklanır — her kullanıcının verisi veri tabanı düzeyinde ayrıdır. Kullanmak için e-posta ile bir hesap açmanız gerekir; parolanız hiçbir zaman düz metin olarak kaydedilmez. Verinizin tamamını istediğiniz an indirebilir, hesabınızı kalıcı olarak silebilirsiniz. Ayrıntılar Gizlilik Politikası'nda." },
    { q: "Döviz ve dolar bazlı varlıklar nasıl gösteriliyor?", a: "Her pozisyon kendi biriminde girilir, tüm toplamlar TL karşılığıyla hesaplanır. Üstteki ₺/$ düğmesiyle tüm ekranı dolar bazına çevirebilirsiniz." },
    { q: "Taksitler ve kredi ödemeleri projeksiyona giriyor mu?", a: "Evet. Kart ekstreleri, taksitli harcamaların aylık payı ve kredi taksitleri nakit projeksiyonuna otomatik yansır — dip noktayı bu yüzden gerçekçi görürsünüz." },
    { q: "Asistan nasıl çalışıyor?", a: "Yaptığınız işlemi gündelik dille yazarsınız ya da sesle söylersiniz; asistan bunu bir kayıt planına çevirip önce onayınıza sunar — onaylamadan hiçbir şey yazılmaz. Uyguladığınız bir planı sonradan geri alabilirsiniz. Sesle yazdırma tarayıcının kendi özelliğidir, ses kaydı sunucuya gönderilmez. Asistan yalnız bu panelin konularına cevap verir ve yatırım tavsiyesi vermez." },
    { q: "Yatırım tavsiyesi veriyor mu?", a: "Vermiyor. Finans sadece sizin girdiğiniz veriyi düzenler ve hesaplar; alım-satım önerisi ya da getiri tahmini sunmaz." }
  ];
  $("faqList").innerHTML = faqs.map(function (f, i) {
    return '<div style="background:var(--surface)">' +
      '<button type="button" class="faq-q" data-f="' + i + '" aria-expanded="false" aria-controls="faq-a-' + i + '">' +
      '<span style="flex:1;font-size:14.5px;font-weight:600;letter-spacing:-.01em">' + esc(f.q) + "</span>" +
      '<span class="faq-sign" style="font-size:16px;color:var(--ink-3);flex-shrink:0" aria-hidden="true">＋</span></button>' +
      '<div class="faq-a" id="faq-a-' + i + '" hidden>' + esc(f.a) + "</div></div>";
  }).join("");
  var openFaq = -1;
  function setFaq(i) {
    openFaq = openFaq === i ? -1 : i;
    faqs.forEach(function (_, j) {
      var on = j === openFaq;
      var btn = $("faqList").querySelector('[data-f="' + j + '"]');
      btn.setAttribute("aria-expanded", String(on));
      btn.querySelector(".faq-sign").textContent = on ? "−" : "＋";
      $("faq-a-" + j).hidden = !on;
    });
  }
  $("faqList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-f]");
    if (b) setFaq(Number(b.dataset.f));
  });
  setFaq(0);
})();
