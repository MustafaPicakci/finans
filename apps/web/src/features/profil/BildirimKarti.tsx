import React, { useEffect, useState } from "react";
import { T } from "../../theme";
import { SilDugmesi } from "../../ui";
import { Anahtar } from "../forms/parcalar";
import { api, type PushDurum } from "../../api";
import { pushDestekli, iosSekmede, buCihaz, pushDurum, bildirimAc, bildirimKapat, denemeGonder, durumuTazele } from "../../bildirim";

/* ————— Bildirimler (Faz 44) —————
   Hesabım'da, çünkü bildirim bir CİHAZ ayarıdır ve cihaz listesi (kaldır) kullanıcının hesabına
   aittir. Cihaz listesi şart: tutarlar bildirimde görünüyor, satılan ya da başkasına verilen bir
   telefona bildirim gitmeye devam etmemeli (çıkış yapınca o cihaz zaten kendiliğinden düşer). */
export function BildirimSatiri() {
  const [durum, setDurum] = useState<PushDurum | null>(null);
  const [buUc, setBuUc] = useState<string | null>(null); // bu cihazın abonelik adresi
  const [mesgul, setMesgul] = useState(false);
  const [mesaj, setMesaj] = useState<{ ok: boolean; mesaj: string } | null>(null);
  const destek = pushDestekli();
  const izinEngelli = destek && Notification.permission === "denied";

  const yukle = async () => {
    try {
      setDurum(await pushDurum(true));
      setBuUc((await buCihaz())?.endpoint ?? null);
    } catch { setDurum({ acik: false, publicKey: null, abonelikler: [] }); }
  };
  useEffect(() => { yukle(); }, []);
  const yap = async (fn: () => Promise<{ ok: boolean; mesaj: string } | void>) => {
    setMesgul(true); setMesaj(null);
    try { const r = await fn(); if (r) setMesaj(r); } catch (e) { setMesaj({ ok: false, mesaj: e instanceof Error ? e.message : String(e) }); }
    finally { setMesgul(false); await yukle(); }
  };

  const buCihazAcik = !!durum?.abonelikler.some((a) => a.endpoint === buUc);
  const tarih = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");

  /* Yeniden tasarım (grup 8): kart değil, Hesabım'daki "Gizlilik ve bildirimler" bölümünün satırı.
     Açma/kapama bir anahtar; desteklenmeyen / sunucuda kapalı / izin engelli hâllerde anahtar yerine
     nedeni yazan satır. Cihaz listesi aynı bölümün alt satırlarında (satılan telefon kaldırılabilsin). */
  const aciklama = <>Ödeme ve kesim günlerinden <b>3 gün önce</b>, tutarıyla haber verir. İçerik bu cihazda şifrelenir; sunucu okuyamaz.</>;
  const engel = !destek
    ? (iosSekmede()
      ? <>iPhone'da bildirim yalnız ana ekrana eklenmiş uygulamada çalışır: Safari'de <b>Paylaş → Ana Ekrana Ekle</b>, sonra uygulamayı oradan aç.</>
      : "Bu tarayıcı bildirim desteklemiyor.")
    : durum && !durum.acik ? "Bildirimler sunucuda henüz yapılandırılmamış."
    : izinEngelli && !buCihazAcik ? "Bu tarayıcıda bildirim izni engelli. Tarayıcının site ayarlarından bu site için izni açabilirsin."
    : null;
  return (<>
    <div style={{ padding: "13px 16px", borderTop: `1px solid ${T.line2}`, opacity: mesgul ? 0.6 : 1 }}>
      {engel ? (
        <div>
          <div style={{ fontSize: 15 }}>Bildirimler · bu cihaz</div>
          <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.45, marginTop: 2 }}>{engel}</div>
        </div>
      ) : (
        <Anahtar etiket="Bildirimler · bu cihaz" acik={buCihazAcik} alt={aciklama}
          onChange={(ac) => { if (mesgul || !durum) return; yap(ac ? bildirimAc : async () => { await bildirimKapat(); return { ok: true, mesaj: "Bu cihazda kapatıldı." }; }); }} />
      )}
      {buCihazAcik && !engel && (
        <button type="button" disabled={mesgul} onClick={() => yap(denemeGonder)} style={{ background: "none", border: "none", padding: "8px 0 0", minHeight: 0, color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Deneme gönder</button>
      )}
      {mesaj && <div style={{ fontSize: 13, color: mesaj.ok ? T.mut : T.neg, marginTop: 6 }}>{mesaj.mesaj}</div>}
    </div>
    {!!durum?.abonelikler.length && durum.abonelikler.map((a) => (
      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 10px 28px", borderTop: `1px solid ${T.line2}` }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          {a.cihaz ?? "Cihaz"}{a.endpoint === buUc && <span style={{ color: T.acc, fontSize: 12.5 }}> · bu cihaz</span>}
          <span style={{ display: "block", fontSize: 12, color: T.mut }}>eklendi {tarih(a.created_at)} · son bildirim {tarih(a.son_basari)}</span>
        </span>
        <SilDugmesi className="" ikon="Kaldır" ad={a.cihaz ?? "Cihaz"} title="Cihazı kaldır"
          style={{ fontSize: 13.5, color: T.mut, padding: "4px 0" }}
          onSil={async () => { await api.pushAboneSil(a.id); durumuTazele(); await yukle(); }}
          sonuc="Bu cihaza bir daha bildirim gitmez. Cihazın kendisinde yeniden açılabilir." />
      </div>
    ))}
  </>);
}
