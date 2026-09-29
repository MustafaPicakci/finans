import { bildirimPlani, BILDIRIM_SURUM, type AllData, type Day } from "@finans/engine";
import { api, type PushDurum } from "../api";
import { pushSifrele, b64u, b64uCoz } from "./sifrele";

/* ============================================================================
   Bildirimler — istemci tarafı (Faz 44)
   ----------------------------------------------------------------------------
   Akış: izin + abonelik (bu cihaz) → uygulama her açıldığında plan kurulur (engine bildirimPlani),
   her öğe kullanıcının HER cihazı için o cihazın push anahtarıyla şifrelenir, plan tek istekte
   sunucuya yüklenir. Hangi cihaz açılırsa açılsın tüm cihazların takvimi tazelenir: telefonu hiç
   açmasan da bilgisayarda açtığında telefonun bildirimleri güncellenir.
   Sunucu içeriği göremez; gördüğü tek şey gönderim anı (tarihler zaten düz). */

const te = new TextEncoder();

/** Tarayıcı Web Push'u destekliyor mu. iPhone'da yalnız ANA EKRANA EKLENMİŞ uygulamada true olur. */
export const pushDestekli = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** iPhone/iPad'de tarayıcı sekmesinde miyiz (ana ekrana eklenmemiş) — destek yoksa ne diyeceğimizi seçer */
export const iosSekmede = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone
  && !window.matchMedia("(display-mode: standalone)").matches;

/** Cihaz listesinde görünecek kısa ad ("Android · Chrome") — kullanıcının hangisini kaldıracağını seçebilmesi için */
function cihazAdi(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Cihaz";
  const tr = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  return `${os} · ${tr}`;
}

/* `serviceWorker.ready` servis çalışanı hiç kaydedilmemişse SONSUZA DEK bekler — hata da vermez.
   Böyle bir sayfa var: Vite geliştirme sunucusu (:5173, `devOptions` kapalı); prod'da da ilk
   ziyarette kayıt henüz bitmemiş olabilir. Beklemek düğmeyi "…"da asılı bırakıyordu, sınırlı bekle
   ve ne olduğunu söyle. */
const swYok = () => location.port === "5173" // Vite geliştirme sunucusu
  ? "Geliştirme sunucusunda (:5173) servis çalışanı yok, bildirim burada denenemez. Derlenmiş uygulamayı (:8787) aç."
  : "Uygulama henüz hazır değil. Sayfayı yenileyip tekrar dene.";
async function kayit(): Promise<ServiceWorkerRegistration> {
  const zamanAsimi = new Promise<never>((_, red) => setTimeout(() => red(new Error(swYok())), 8000));
  return Promise.race([navigator.serviceWorker.ready, zamanAsimi]);
}

/** Bu cihazın tarayıcı aboneliği (yoksa null). Servis çalışanı yoksa abonelik de yoktur — beklemez. */
export async function buCihaz(): Promise<PushSubscription | null> {
  if (!pushDestekli()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/* Durum oturum boyunca önbellekte: plan her veri değişiminde yeniden kurulur, her seferinde
   cihaz listesini sormak gereksiz istek olurdu. Abonelik değişince sıfırlanır. */
let durumOnbellek: Promise<PushDurum> | null = null;
export const pushDurum = (taze = false) => {
  if (taze || !durumOnbellek) durumOnbellek = api.pushDurum().catch((e) => { durumOnbellek = null; throw e; });
  return durumOnbellek;
};

/* Abonelik değişince plan HEMEN yüklenmeli (yeni cihaz bir sonraki veri değişimini beklemesin):
   App bu sinyale abone olur ve plan efektini yeniden tetikler. */
const dinleyiciler = new Set<() => void>();
export const abonelikDegisti = (fn: () => void) => { dinleyiciler.add(fn); return () => { dinleyiciler.delete(fn); }; };
const haberVer = () => dinleyiciler.forEach((f) => f());

/** İzin iste + abone ol + sunucuya kaydet. Dönen metin kullanıcıya gösterilecek sonuçtur. */
export async function bildirimAc(): Promise<{ ok: boolean; mesaj: string }> {
  if (!pushDestekli()) return { ok: false, mesaj: iosSekmede() ? "iPhone'da önce Safari'de Paylaş → Ana Ekrana Ekle, sonra uygulamayı oradan aç." : "Bu tarayıcı bildirim desteklemiyor." };
  /* İzin HER ŞEYDEN ÖNCE, araya await girmeden: Safari izin penceresini yalnız dokunuşa doğrudan
     bağlı çağrıda açar, önünde bir ağ isteği beklemek onu sessizce reddettirebilir. Sunucu durumu
     ve servis çalışanı aynı anda sorulur; kart zaten yapılandırılmamış sunucuda düğmeyi göstermiyor. */
  const izinP = Notification.requestPermission();
  const [izin, d, reg] = await Promise.all([izinP, pushDurum(true), kayit()]);
  if (!d.acik || !d.publicKey) return { ok: false, mesaj: "Bildirimler sunucuda henüz yapılandırılmamış." };
  if (izin !== "granted") return { ok: false, mesaj: izin === "denied" ? "Bildirim izni engelli. Tarayıcının site ayarlarından bu site için izni açabilirsin." : "İzin verilmedi." };
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uCoz(d.publicKey) as BufferSource });
  const k = sub.toJSON().keys ?? {};
  if (!k.p256dh || !k.auth) return { ok: false, mesaj: "Tarayıcı abonelik anahtarı vermedi." };
  await api.pushAbone({ endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, cihaz: cihazAdi() });
  await pushDurum(true);
  sonParmakIzi = null; // yeni cihaz planı almalı
  haberVer();
  return { ok: true, mesaj: "Bildirimler bu cihazda açık." };
}

/** Bu cihazı bildirimlerden çıkarır (sunucudan siler + tarayıcı aboneliğini bitirir). Çıkışta da çağrılır:
    satılan/devredilen bir telefona tutarlı bildirim gitmeye devam etmesin. */
export async function bildirimKapat(): Promise<void> {
  const sub = await buCihaz();
  if (!sub) return;
  try {
    const d = await pushDurum(true);
    const benim = d.abonelikler.find((a) => a.endpoint === sub.endpoint);
    if (benim) await api.pushAboneSil(benim.id);
  } finally {
    await sub.unsubscribe().catch(() => {});
    durumOnbellek = null;
    sonParmakIzi = null;
  }
}

/** "Deneme bildirimi gönder": zinciri (izin → abonelik → şifre → sunucu → push servisi → cihaz) uçtan uca sınar. */
export async function denemeGonder(): Promise<{ ok: boolean; mesaj: string }> {
  const sub = await buCihaz();
  const d = await pushDurum(true);
  const a = sub && d.abonelikler.find((x) => x.endpoint === sub.endpoint);
  if (!a) return { ok: false, mesaj: "Bu cihazda bildirim açık değil." };
  const govde = b64u(await pushSifrele(b64uCoz(a.p256dh), b64uCoz(a.auth), te.encode(JSON.stringify({
    anahtar: "deneme", baslik: "Finans", govde: "Bildirimler çalışıyor. Ödemelerden 3 gün önce burada haber vereceğim.", url: "/profil",
  }))));
  const r = await api.pushDene(a.id, govde);
  return r.durum >= 200 && r.durum < 300
    ? { ok: true, mesaj: "Gönderildi — birkaç saniye içinde gelmeli." }
    : { ok: false, mesaj: `Push servisi ${r.durum || "cevap vermedi"} döndü.` };
}

/* Aynı plan aynı cihaz listesine iki kez yüklenmesin (her mutasyon sonrası reload() planı yeniden
   kurar; çoğu mutasyon bildirimleri değiştirmez). Parmak izi DÜZ planın özeti, şifreli hâlin değil —
   şifreli hâl her seferinde farklıdır (tek kullanımlık anahtar + tuz). */
let sonParmakIzi: string | null = null;

/** Planı kur, şifrele, yükle. Hiç bildirim alan cihaz yoksa hiçbir şey yapmaz. Sessizdir: hata yalnız loglanır. */
/** Başka bir cihaz Hesabım'dan kaldırıldığında da çağrılır: kalan cihazların listesi değişti. */
export function durumuTazele() { durumOnbellek = null; sonParmakIzi = null; haberVer(); }

export async function planYukle(data: AllData, days: Day[]): Promise<void> {
  const d = await pushDurum();
  if (!d.acik || !d.abonelikler.length) return;
  const plan = bildirimPlani(data, days, new Date());
  const iz = JSON.stringify([d.abonelikler.map((a) => a.id), plan]);
  if (iz === sonParmakIzi) return;
  const ogeler = [];
  for (const a of d.abonelikler) {
    const pub = b64uCoz(a.p256dh), auth = b64uCoz(a.auth);
    for (const o of plan) {
      const duz = te.encode(JSON.stringify({ anahtar: o.anahtar, baslik: o.baslik, govde: o.govde, url: o.url }));
      ogeler.push({ abonelik_id: a.id, anahtar: o.anahtar, zaman: o.zaman, bitis: o.bitis, govde: b64u(await pushSifrele(pub, auth, duz)) });
    }
  }
  await api.pushPlan(BILDIRIM_SURUM, ogeler);
  sonParmakIzi = iz;
}
