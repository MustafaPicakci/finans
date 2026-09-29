import React, { useState } from "react";
import { api, type AllData } from "../../api";
import { T, css } from "../../theme";
import { parolaKaniti, parolaDegistir, parolaSorunu, PAROLA_MIN, ZAYIF_PAROLA_KEY } from "../auth/e2ee";
import { ApiError } from "../../api";
import { BildirimKarti } from "./BildirimKarti";

/* ————— HESABIM (KULLANICI hesabı) —————
   Bu ekran "Hesaplar" sekmesinden AYRI ve bu bilinçli: orada "hesap" = banka/nakit/aracı
   kurum hesabı, burada "hesap" = giriş yaptığın kullanıcı. İkisi aynı sekmede durunca
   "Hesabı sil" düğmesi bir banka hesabını siliyormuş gibi okunuyordu — en yıkıcı eylemin
   yanlış anlaşılması kabul edilemez.

   Ana menüde yer almaz (menü zaten sekiz sekme): kenar çubuğundaki kullanıcı kartından ve
   mobildeki ⋯ menüsünden açılır — yani kullanıcı kimliğinin durduğu yerden. */
export function Profil({ user, data, reload, onDeleted }: {
  user: { email: string };
  data: AllData;
  reload: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /* Asistan anahtarı: kayıt yokken AÇIK sayılır (sunucudaki `asistanAcik` ile aynı kural —
     iki yerde iki varsayılan olursa ekran ile davranış ayrışır). */
  const aiAcik = data.settings.ai_enabled !== "0";
  const aiDegistir = async (acik: boolean) => {
    await api.put("settings", { ai_enabled: acik ? "1" : "0" });
    reload();
  };

  const download = async () => {
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { setErr("Dışa aktarılamadı"); }
  };
  const remove = async () => {
    setErr(""); setBusy(true);
    // parola sunucuya gitmez: hesap türüne göre kanıt (v2: auth_token) burada türetilir
    try { await api.deleteAccount(await parolaKaniti(user.email, pw)); onDeleted(); }
    catch { setErr("Parola hatalı"); setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 14, background: T.accSoft, color: T.acc,
          display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, flexShrink: 0,
        }}>{user.email.slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user.email.split("@")[0]}</div>
          <div style={{ fontSize: 12.5, color: T.mut3, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
        </div>
      </div>
    </div>

    {/* Asistan anahtarı burada, çünkü bu bir GİZLİLİK tercihi: asistanı kullanmak verinin bir
        kısmının üçüncü bir servise gitmesi demek ve bu ekran "verilerin" ekranı. Varsayılan
        AÇIK — anahtarın işi asistanı tanıtmak değil, kullanmak istemeyene kapatma yolu vermek. */}
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Asistan</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        Asistanı kullandığında yazdığın mesajlar ve <b>hesap/kart/kategori adların (bakiyelerle birlikte)</b>
        {" "}yanıtı üretmesi için seçili model sağlayıcısına gönderilir. Kullanmak istemiyorsan kapat —
        sekme gizlenmez ama sağlayıcıya hiçbir şey gitmez.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text, cursor: "pointer" }}>
        <input type="checkbox" checked={aiAcik} onChange={(e) => aiDegistir(e.target.checked)} />
        Asistan açık
      </label>
    </div>

    <BildirimKarti />

    <ParolaKarti email={user.email} />

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Verilerini indir</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        Bütün kayıtların (hesaplar, işlemler, portföy, kartlar, plan) tek bir JSON dosyası olarak iner.
        Yedek almak ya da başka bir yere taşımak için.
      </div>
      <button style={css.ghost} onClick={download}>JSON olarak indir</button>
    </div>

    {/* Yıkıcı bölge en altta ve görsel olarak ayrı — yanlışlıkla tıklanacak yerde durmaz */}
    <div style={{ ...css.card, borderColor: T.neg }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: T.neg }}>Hesabı sil</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        <b>Kullanıcı hesabın</b> ve ona bağlı <b>tüm verilerin</b> kalıcı olarak silinir — banka hesapların,
        işlemlerin, portföyün, kart ve plan kayıtların dahil. Geri alınamaz.
        Silmeden önce yukarıdan bir yedek indirmek isteyebilirsin.
      </div>
      {!confirm
        ? <button style={{ ...css.ghost, color: T.neg, borderColor: T.neg }} onClick={() => setConfirm(true)}>Hesabımı silmek istiyorum</button>
        : (
          <div style={{ padding: 12, border: `1px solid ${T.neg}`, borderRadius: 12, background: T.negSoft }}>
            <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
              Onaylamak için parolanı gir.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...css.input, width: 200 }} type="password" placeholder="parola" value={pw}
                onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
              <button style={{ ...css.btn, background: T.neg }} disabled={busy || !pw} onClick={remove}>{busy ? "…" : "Kalıcı olarak sil"}</button>
              <button style={css.ghost} onClick={() => { setConfirm(false); setPw(""); setErr(""); }}>Vazgeç</button>
            </div>
            {err && <div style={{ fontSize: 13, color: T.neg, marginTop: 8 }}>{err}</div>}
          </div>
        )}
    </div>
  </>);
}

/* ————— PAROLA (E2EE aşama 6) —————
   Parola değişince veri yeniden şifrelenmez: aynı veri anahtarı yeni parolayla yeniden
   sarılır (anında biter). Kurtarma kodu DEĞİŞMEZ — parolaya bağlı değil. Diğer cihazlardaki
   oturumlar kapanır. Girişte kullanılan parola bugünkü kurala uymuyorsa kart bunu söyler
   (sıfır bilgiden sonra zayıf parola daha pahalı: sızan bir veritabanındaki sarılı anahtar
   çevrimdışı denenebilir). */
function ParolaKarti({ email }: { email: string }) {
  const [acik, setAcik] = useState(false);
  const [eski, setEski] = useState("");
  const [yeni, setYeni] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [zayif, setZayif] = useState(() => { try { return sessionStorage.getItem(ZAYIF_PAROLA_KEY) === "1"; } catch { return false; } });
  const sorun = yeni ? parolaSorunu(yeni, email) : null;
  const kaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eski || !yeni || sorun) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await parolaDegistir(email, eski, yeni);
      try { sessionStorage.removeItem(ZAYIF_PAROLA_KEY); } catch { /* yok say */ }
      setZayif(false); setEski(""); setYeni(""); setAcik(false);
      setOk("Parolan değişti. Diğer cihazlardaki oturumlar kapatıldı; kurtarma kodun aynı kaldı.");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Değiştirilemedi, tekrar dene"); }
    setBusy(false);
  };
  return (
    <div style={{ ...css.card, ...(zayif ? { borderColor: T.warn ?? T.neg } : {}) }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Parola</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        {zayif
          ? <><b>Parolan bugünkü kurallara uymuyor</b> (en az {PAROLA_MIN} karakter, yaygın olmayan). Verilerin
            parolanla korunduğu için güçlü bir parolaya geçmeni öneririz.</>
          : <>Verilerin parolanla açılan bir anahtarla şifreli. Parolanı değiştirmek veriyi yeniden şifrelemez; kurtarma kodun aynı kalır.</>}
      </div>
      {ok && <div style={{ fontSize: 13, color: T.pos, marginBottom: 10 }}>{ok}</div>}
      {!acik ? <button style={css.ghost} onClick={() => { setAcik(true); setOk(""); }}>Parolayı değiştir</button> : (
        <form onSubmit={kaydet} style={{ display: "grid", gap: 10, maxWidth: 360 }}>
          <input style={css.input} type="password" placeholder="mevcut parola" value={eski} onChange={(e) => setEski(e.target.value)} autoComplete="current-password" />
          <div>
            <input style={css.input} type="password" placeholder={`yeni parola (en az ${PAROLA_MIN} karakter)`} value={yeni} onChange={(e) => setYeni(e.target.value)} autoComplete="new-password" />
            {sorun && <div style={{ fontSize: 12, color: T.mut3, marginTop: 5 }}>{sorun}</div>}
          </div>
          {err && <div style={{ fontSize: 13, color: T.neg }}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...css.btn, opacity: busy || !eski || !yeni || sorun ? 0.55 : 1 }} disabled={busy || !eski || !yeni || !!sorun}>{busy ? "Değiştiriliyor…" : "Parolayı değiştir"}</button>
            <button type="button" style={css.ghost} onClick={() => { setAcik(false); setEski(""); setYeni(""); setErr(""); }}>Vazgeç</button>
          </div>
        </form>
      )}
    </div>
  );
}
