import React, { useState } from "react";
import { api, type AllData } from "../../api";
import { T, css } from "../../theme";
import { Modal } from "../../ui";
import { Anahtar, Bolum, Etiketli, FormAlt, girdi } from "../forms/parcalar";
import { parolaKaniti, parolaDegistir, parolaSorunu, PAROLA_MIN, ZAYIF_PAROLA_KEY } from "../auth/e2ee";
import { ApiError } from "../../api";
import { BildirimSatiri } from "./BildirimKarti";

/* ————— HESABIM (KULLANICI hesabı) —————
   Bu ekran "Hesaplar" sekmesinden AYRI ve bu bilinçli: orada "hesap" = banka/nakit/aracı
   kurum hesabı, burada "hesap" = giriş yaptığın kullanıcı. İkisi aynı sekmede durunca
   "Hesabı sil" düğmesi bir banka hesabını siliyormuş gibi okunuyordu — en yıkıcı eylemin
   yanlış anlaşılması kabul edilemez.

   Yeniden tasarım (Ekim 2026, grup 8): alt alta kartlar yerine AYAR LİSTESİ — Gizlilik ve
   bildirimler (anahtarlar), Güvenlik (parola), Veri (indir, hesabı sil). Açıklamalar satırın
   altında kısa ve GÖRÜNÜR kalır (gizlilik metni katlanmaz); parola değiştirme ve hesap silme
   alttan açılan sayfada. Yıkıcı satır en altta ve kırmızı. */

/** Bölüm başlığı + satırları çerçeveleyen kutu */
export const Bolumu = ({ baslik, children }: { baslik: string; children: React.ReactNode }) => (
  <div>
    <div style={{ fontSize: 13, fontWeight: 600, color: T.mut, padding: "2px 4px 6px" }}>{baslik}</div>
    <div style={{ ...css.card, padding: 0, overflow: "hidden" }}>{children}</div>
  </div>
);
/** Ayar satırının iç boşluğu ve ayırıcısı (ilk satırda çizgi yok) */
export const ayarSatiri = (ilk: boolean): React.CSSProperties => ({
  padding: "13px 16px", borderTop: ilk ? "none" : `1px solid ${T.line2}`,
});
const Ok = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={T.mut3} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4.5 3l3 3-3 3" /></svg>
);
/** Dokununca bir şey yapan satır (sayfa açar, dosya indirir) */
function EylemSatiri({ etiket, alt, onClick, renk, ilk }: { etiket: string; alt?: React.ReactNode; onClick: () => void; renk?: string; ilk?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="liste-satir" style={{
      ...ayarSatiri(!!ilk), display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
      background: "transparent", border: "none", borderTop: ilk ? "none" : `1px solid ${T.line2}`, cursor: "pointer", fontFamily: T.disp, color: T.text,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: renk ?? T.text }}>{etiket}</span>
        {alt && <span style={{ display: "block", fontSize: 12.5, color: T.mut, lineHeight: 1.45, marginTop: 2 }}>{alt}</span>}
      </span>
      <Ok />
    </button>
  );
}

export function Profil({ user, data, reload, onDeleted }: {
  user: { email: string };
  data: AllData;
  reload: () => void;
  onDeleted: () => void;
}) {
  const [sayfa, setSayfa] = useState<"parola" | "sil" | null>(null);
  const [err, setErr] = useState("");
  const [parolaOk, setParolaOk] = useState("");
  const [zayif, setZayif] = useState(() => { try { return sessionStorage.getItem(ZAYIF_PAROLA_KEY) === "1"; } catch { return false; } });

  /* Asistan anahtarı: kayıt yokken AÇIK sayılır (sunucudaki `asistanAcik` ile aynı kural —
     iki yerde iki varsayılan olursa ekran ile davranış ayrışır). Burada, çünkü bu bir GİZLİLİK
     tercihi: asistanı kullanmak verinin bir kısmının üçüncü bir servise gitmesi demek. */
  const aiAcik = data.settings.ai_enabled !== "0";
  const aiDegistir = async (acik: boolean) => {
    await api.put("settings", { ai_enabled: acik ? "1" : "0" });
    reload();
  };

  const download = async () => {
    setErr("");
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { setErr("Dışa aktarılamadı"); }
  };

  return (<div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
    <div style={{ ...css.card, display: "flex", alignItems: "center", gap: 13, padding: 16 }}>
      <span style={{
        width: 46, height: 46, borderRadius: 14, background: T.accSoft, color: T.acc,
        display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, flexShrink: 0,
      }}>{user.email.slice(0, 2).toUpperCase()}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{user.email.split("@")[0]}</div>
        <div style={{ fontSize: 13, color: T.mut, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
      </div>
    </div>

    <Bolumu baslik="Gizlilik ve bildirimler">
      <div style={ayarSatiri(true)}>
        <Anahtar etiket="Asistan" acik={aiAcik} onChange={aiDegistir}
          alt={<>Açıkken yazdığın mesajlar ve <b>hesap/kart/kategori adların (bakiyelerle)</b> yanıt için seçili model sağlayıcısına gider. Kapalıyken sağlayıcıya hiçbir şey gitmez.</>} />
      </div>
      <BildirimSatiri />
    </Bolumu>

    <Bolumu baslik="Güvenlik">
      <EylemSatiri ilk etiket="Parolayı değiştir" onClick={() => { setSayfa("parola"); setParolaOk(""); }}
        alt={zayif
          ? <span style={{ color: T.warn }}><b>Parolan bugünkü kurallara uymuyor</b> (en az {PAROLA_MIN} karakter, yaygın olmayan) — güçlü bir parolaya geçmeni öneririz.</span>
          : parolaOk ? <span style={{ color: T.pos }}>{parolaOk}</span>
          : "Verilerin parolanla açılan bir anahtarla şifreli. Değiştirmek veriyi yeniden şifrelemez; kurtarma kodun aynı kalır."} />
    </Bolumu>

    <Bolumu baslik="Veri">
      <EylemSatiri ilk etiket="Verilerimi indir" onClick={download}
        alt="Bütün kayıtların (hesaplar, işlemler, portföy, kartlar, plan, asistan sohbetleri) tek JSON dosyası olarak. Yedek almak ya da taşımak için." />
      {/* Yıkıcı satır en altta ve kırmızı — yanlışlıkla dokunulacak yerde durmaz; onay sayfası açar */}
      <EylemSatiri etiket="Hesabımı sil" renk={T.neg} onClick={() => setSayfa("sil")}
        alt="Kullanıcı hesabın ve ona bağlı tüm verilerin kalıcı olarak silinir." />
    </Bolumu>
    {err && <div style={{ fontSize: 13.5, color: T.neg }}>{err}</div>}

    {sayfa === "parola" && (
      <ParolaSayfasi email={user.email} onClose={() => setSayfa(null)}
        onDegisti={() => { setZayif(false); setParolaOk("Parolan değişti. Diğer cihazlardaki oturumlar kapatıldı; kurtarma kodun aynı kaldı."); setSayfa(null); }} />
    )}
    {sayfa === "sil" && <SilSayfasi email={user.email} onIndir={download} onClose={() => setSayfa(null)} onDeleted={onDeleted} />}
  </div>);
}

/* ————— PAROLA (E2EE aşama 6) —————
   Parola değişince veri yeniden şifrelenmez: aynı veri anahtarı yeni parolayla yeniden
   sarılır (anında biter). Kurtarma kodu DEĞİŞMEZ — parolaya bağlı değil. Diğer cihazlardaki
   oturumlar kapanır. Sarılı paket oturuma değil eski parolanın kanıtına verilir. */
function ParolaSayfasi({ email, onClose, onDegisti }: { email: string; onClose: () => void; onDegisti: () => void }) {
  const [eski, setEski] = useState("");
  const [yeni, setYeni] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sorun = yeni ? parolaSorunu(yeni, email) : null;
  const ok = !!eski && !!yeni && !sorun && !busy;
  const kaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      await parolaDegistir(email, eski, yeni);
      try { sessionStorage.removeItem(ZAYIF_PAROLA_KEY); } catch { /* yok say */ }
      onDegisti();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Değiştirilemedi, tekrar dene"); setBusy(false); }
  };
  return (
    <Modal title="Parolayı değiştir" onClose={onClose}>
      <form onSubmit={kaydet}>
        <Bolum>
          <Etiketli etiket="Mevcut parola">
            <input style={girdi} type="password" autoFocus value={eski} onChange={(e) => setEski(e.target.value)} autoComplete="current-password" />
          </Etiketli>
          <Etiketli etiket="Yeni parola" alt={sorun ? <span style={{ color: T.mut }}>{sorun}</span> : undefined}>
            <input style={girdi} type="password" placeholder={`en az ${PAROLA_MIN} karakter`} value={yeni} onChange={(e) => setYeni(e.target.value)} autoComplete="new-password" />
          </Etiketli>
          {err && <div style={{ fontSize: 13.5, color: T.neg }}>{err}</div>}
        </Bolum>
        <FormAlt ok={ok} reason={busy ? "Değiştiriliyor…" : !eski ? "Mevcut parolanı yaz." : !yeni ? "Yeni parolayı yaz." : sorun ?? null} editing
          etiket={busy ? "Değiştiriliyor…" : "Parolayı değiştir"}
          sonuc="Diğer cihazlardaki oturumların kapanır; bu cihazda açık kalır. Kurtarma kodun değişmez." />
      </form>
    </Modal>
  );
}

function SilSayfasi({ email, onIndir, onClose, onDeleted }: { email: string; onIndir: () => void; onClose: () => void; onDeleted: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setErr(""); setBusy(true);
    // parola sunucuya gitmez: hesap türüne göre kanıt (v2: auth_token) burada türetilir
    try { await api.deleteAccount(await parolaKaniti(email, pw)); onDeleted(); }
    catch { setErr("Parola hatalı"); setBusy(false); }
  };
  return (
    <Modal title="Hesabımı sil" onClose={() => !busy && onClose()}>
      <form onSubmit={remove}>
        <Bolum>
          <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>
            <b>Kullanıcı hesabın</b> ve ona bağlı <b>tüm verilerin</b> kalıcı olarak silinir: banka hesapların, işlemlerin,
            portföyün, kart ve plan kayıtların, asistan sohbetlerin. Geri alınamaz.
          </div>
          <div style={{ fontSize: 13.5, color: T.mut }}>
            Önce yedek almak istersen:{" "}
            <button type="button" onClick={onIndir} style={{ background: "none", border: "none", padding: 0, minHeight: 0, color: T.acc, fontFamily: T.disp, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>verilerimi indir</button>
          </div>
          <Etiketli etiket="Onaylamak için parolan">
            <input style={girdi} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </Etiketli>
          {err && <div style={{ fontSize: 13.5, color: T.neg }}>{err}</div>}
        </Bolum>
        <div className="form-alt">
          <button type="submit" disabled={!pw || busy} style={{
            width: "100%", height: 48, border: "none", borderRadius: 13, background: T.neg, color: "#fff",
            fontFamily: T.disp, fontSize: 15.5, fontWeight: 650, cursor: "pointer", opacity: !pw || busy ? 0.45 : 1,
          }}>{busy ? "Siliniyor…" : "Kalıcı olarak sil"}</button>
        </div>
      </form>
    </Modal>
  );
}
