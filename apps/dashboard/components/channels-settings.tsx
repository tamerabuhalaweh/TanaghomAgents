"use client";

import { Link2, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { PageHeading } from "./page-heading";
import { SettingsNavigation } from "./settings-navigation";
import { StatusPill } from "./status-pill";

type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";

interface SupportedPlatform {
  platform: Platform;
  postiz_integration: string;
}

interface Channel {
  id: string;
  platform: Platform;
  identifier: string;
  name: string;
  profile: string;
  disabled: boolean;
  mapped_for_drafts: boolean;
}

interface ChannelsPayload {
  provisioning_ready: boolean;
  human_approval_required: boolean;
  supported_platforms: SupportedPlatform[];
  channels: Channel[];
}

const copy = {
  en: {
    title: "Social channels",
    lede: "Connect the social accounts your team may draft for. Each Tanaghom workspace gets its own isolated Postiz organization and API key; publishing still requires a human in the social network.",
    privacy: "Credentials stay encrypted in Tanaghom and are never returned to this browser.",
    human: "Human approval is required before anything can publish.",
    supported: "Connect a channel",
    connected: "Connected channels",
    empty: "No social accounts are connected yet.",
    emptyHint: "Choose a network above. The provider opens its own secure sign-in page; Tanaghom never receives your social password.",
    connect: "Connect",
    connecting: "Opening…",
    disconnect: "Disconnect workspace",
    disconnecting: "Disconnecting…",
    refresh: "Refresh",
    mapped: "Ready for drafts",
    unmapped: "Not mapped for drafts",
    disabled: "Disabled in Postiz",
    unavailableTitle: "Channel connection is not configured on this server",
    unavailableCopy: "An owner or operator can connect channels once the Postiz tenant database and credential encryption are configured.",
    providerMissing: "This social network is not configured yet. Ask the platform owner to finish the provider app credentials, then try again.",
    providerMissingTitle: "Provider setup is incomplete",
    connectError: "Tanaghom could not start the sign-in flow. Try again shortly.",
    loadError: "Tanaghom could not load your social channels.",
    forbidden: "Only an owner or operator can connect or disconnect social channels.",
    load: "Loading social channels…",
    confirmDisconnect: "Disconnect this workspace? The social accounts stay in Postiz and can be reconnected later.",
  },
  ar: {
    title: "قنوات التواصل",
    lede: "اربط حسابات التواصل التي يمكن لفريقك إعداد مسودات لها. لكل مساحة عمل تناغم منظمة Postiz ومفتاح API معزولان؛ ولا يزال النشر يتطلب موافقة بشرية داخل شبكة التواصل.",
    privacy: "تبقى بيانات الاعتماد مشفرة في تناغم ولا تُعاد أبدًا إلى هذا المتصفح.",
    human: "الموافقة البشرية مطلوبة قبل أي نشر.",
    supported: "اربط قناة",
    connected: "القنوات المتصلة",
    empty: "لا توجد حسابات تواصل متصلة بعد.",
    emptyHint: "اختر شبكة أعلاه. تفتح المنصة صفحة تسجيل دخول آمنة خاصة بها؛ ولا تستلم تناغم كلمة مرورك الاجتماعية.",
    connect: "ربط",
    connecting: "جارٍ الفتح…",
    disconnect: "فصل مساحة العمل",
    disconnecting: "جارٍ الفصل…",
    refresh: "تحديث",
    mapped: "جاهزة للمسودات",
    unmapped: "غير مرتبطة بالمسودات",
    disabled: "معطلة في Postiz",
    unavailableTitle: "ربط القنوات غير مهيأ على هذا الخادم",
    unavailableCopy: "يمكن للمالك أو المشغل ربط القنوات بعد تهيئة قاعدة بيانات Postiz وتشفير بيانات الاعتماد.",
    providerMissing: "شبكة التواصل هذه غير مهيأة بعد. اطلب من مالك المنصة إكمال بيانات تطبيق المزود ثم حاول مجددًا.",
    providerMissingTitle: "إعداد المزود غير مكتمل",
    connectError: "تعذر على تناغم بدء تسجيل الدخول. حاول بعد قليل.",
    loadError: "تعذر على تناغم تحميل قنوات التواصل.",
    forbidden: "يمكن للمالك أو المشغل فقط ربط أو فصل قنوات التواصل.",
    load: "جارٍ تحميل قنوات التواصل…",
    confirmDisconnect: "فصل مساحة العمل؟ تبقى حسابات التواصل في Postiz ويمكن إعادة ربطها لاحقًا.",
  },
} as const;

function platformLabel(platform: Platform, arabic: boolean) {
  const labels: Record<Platform, [string, string]> = {
    instagram: ["Instagram", "إنستغرام"],
    facebook: ["Facebook", "فيسبوك"],
    linkedin: ["LinkedIn", "لينكدإن"],
    tiktok: ["TikTok", "تيك توك"],
    x: ["X", "إكس"],
  };
  return labels[platform][arabic ? 1 : 0];
}

export function ChannelsSettings() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const text = copy[locale];
  const [payload, setPayload] = useState<ChannelsPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setNotice("");
    try {
      const response = await authenticatedFetch("/api/settings/channels", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("load_failed");
      setPayload(await response.json() as ChannelsPayload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect(platform: Platform, variant?: "instagram-standalone" | "linkedin") {
    if (busy) return;
    setBusy(platform);
    setNotice("");
    try {
      const response = await authenticatedFetch("/api/settings/channels/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, ...(variant ? { variant } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; url?: string };
      if (response.status === 409 && body.error === "social_provider_not_configured") {
        setNotice(text.providerMissing);
        return;
      }
      if (!response.ok || !body.url) {
        setNotice(response.status === 403 ? text.forbidden : text.connectError);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNotice(text.connectError);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (busy || !window.confirm(text.confirmDisconnect)) return;
    setBusy("disconnect");
    try {
      const response = await authenticatedFetch("/api/settings/channels", { method: "DELETE" });
      if (!response.ok) {
        setNotice(response.status === 403 ? text.forbidden : text.connectError);
        return;
      }
      await load();
    } catch {
      setNotice(text.connectError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-stack channels-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PageHeading title={text.title} description={text.lede} />
      <SettingsNavigation />
      <section className="credential-safety">
        <ShieldCheck size={20} />
        <div><strong>{text.privacy}</strong><p>{text.human}</p></div>
        <StatusPill tone="success">{text.human}</StatusPill>
      </section>
      {notice ? <p className="channel-notice" role="status"><Link2 size={16} /> {notice}</p> : null}
      {state === "loading" ? <p className="channel-loading"><LoaderCircle className="spin" size={18} /> {text.load}</p> : null}
      {state === "forbidden" ? <p className="channel-notice" role="alert">{text.forbidden}</p> : null}
      {state === "error" ? <div className="channel-empty"><Link2 size={18} /><span><strong>{text.loadError}</strong><small>{text.emptyHint}</small></span><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} /> {text.refresh}</button></div> : null}
      {state === "ready" && payload ? <>
        <section className="channels-section" aria-labelledby="channel-connect-title">
          <div className="channels-heading"><div><h2 id="channel-connect-title">{text.supported}</h2><p>{text.emptyHint}</p></div></div>
          <div className="channel-grid">
            {payload.supported_platforms.map((item) => <article className="channel-card" key={item.platform}>
              <div className="channel-tile" aria-hidden="true">{platformLabel(item.platform, ar).slice(0, 2)}</div>
              <div><h3>{platformLabel(item.platform, ar)}</h3><small>{item.postiz_integration}</small></div>
              <button type="button" className="primary-button" disabled={busy !== null || !payload.provisioning_ready} onClick={() => void connect(item.platform)}>
                {busy === item.platform ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} {busy === item.platform ? text.connecting : text.connect}
              </button>
              {item.platform === "instagram" ? <button type="button" className="secondary-button" disabled={busy !== null || !payload.provisioning_ready} onClick={() => void connect("instagram", "instagram-standalone")}>{ar ? "إنستغرام مستقل" : "Instagram standalone"}</button> : null}
              {item.platform === "linkedin" ? <button type="button" className="secondary-button" disabled={busy !== null || !payload.provisioning_ready} onClick={() => void connect("linkedin", "linkedin")}>{ar ? "لينكدإن شخصي" : "LinkedIn personal"}</button> : null}
            </article>)}
          </div>
          {!payload.provisioning_ready ? <div className="channel-empty"><ShieldCheck size={18} /><span><strong>{text.unavailableTitle}</strong><small>{text.unavailableCopy}</small></span></div> : null}
          {payload.provisioning_ready ? <div className="channels-heading"><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void disconnect()}><Unplug size={16} /> {busy === "disconnect" ? text.disconnecting : text.disconnect}</button></div> : null}
        </section>
        <section className="channels-section" aria-labelledby="channel-connected-title">
          <div className="channels-heading"><div><h2 id="channel-connected-title">{text.connected}</h2><p>{text.human}</p></div><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void load()}><RefreshCw size={16} /> {text.refresh}</button></div>
          {payload.channels.length === 0 ? <div className="channel-empty"><Link2 size={18} /><span><strong>{text.empty}</strong><small>{text.emptyHint}</small></span></div> : <div className="channel-list">
            {payload.channels.map((channel) => <article className={`channel-row ${channel.disabled ? "channel-row-disabled" : ""}`} key={channel.id}>
              <div className="channel-tile" aria-hidden="true">{platformLabel(channel.platform, ar).slice(0, 2)}</div>
              <div><h3>{channel.name}</h3><small>{platformLabel(channel.platform, ar)}{channel.profile ? ` · ${channel.profile}` : ""}</small></div>
              <StatusPill tone={channel.disabled ? "neutral" : channel.mapped_for_drafts ? "success" : "attention"}>{channel.disabled ? text.disabled : channel.mapped_for_drafts ? text.mapped : text.unmapped}</StatusPill>
            </article>)}
          </div>}
        </section>
      </> : null}
    </div>
  );
}
