"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface KitRow {
  kit_id: string;
  name: string;
  current_version: number;
  versions: number;
}

interface KitDetail {
  kit_id: string;
  name: string;
  current_version: number;
  created_at: string;
}

interface KitVersionRow {
  version_id: string;
  version: number;
  colors: unknown;
  tone: string | null;
  arabic_font: string | null;
  latin_font: string | null;
}

export function BrandKitsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const kits = useCreativeFetch<{ kits: KitRow[] }>(locale, "/api/creative/brand-kits");
  const [name, setName] = useState("");
  const [colors, setColors] = useState('{"primary":"#0ea5e9"}');
  const [tone, setTone] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = colors.trim() ? (JSON.parse(colors) as Record<string, unknown>) : {};
      } catch {
        setNotice("invalid_colors");
        setWorking(false);
        return;
      }
      const body = await api<{ kit_id: string }>(`/api/creative/brand-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kit") },
        body: JSON.stringify({ name: name.trim(), colors: parsed, tone: tone.trim() || null }),
      });
      setNotice(`${t(locale, "brands.created")} (${body.kit_id})`);
      setName("");
      await kits.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "brands.title")}</h1></div>
      {canAdmin && (
        <form className="creative-form" onSubmit={create}>
          <h2>{t(locale, "brands.create")}</h2>
          <label>{t(locale, "brands.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t(locale, "brands.colors")}<textarea value={colors} onChange={(event) => setColors(event.target.value)} dir="ltr" /></label>
          <label>{t(locale, "brands.tone")}<input type="text" value={tone} maxLength={500} onChange={(event) => setTone(event.target.value)} /></label>
          <button type="submit" className="creative-button" disabled={working || !name.trim()}>{t(locale, "common.save")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {kits.loading ? <Loading locale={locale} /> : kits.error ? <LoadError locale={locale} error={kits.error} onRetry={kits.reload} />
        : !kits.data?.kits.length ? <p>{t(locale, "brands.empty")}</p>
        : (
          <ul className="creative-grid">
            {kits.data.kits.map((kit) => (
              <li key={kit.kit_id} className="creative-card">
                <h2><Link href={`/creative/brand-kits/${kit.kit_id}`}>{kit.name}</Link></h2>
                <p>{t(locale, "brands.current")}: {t(locale, "common.version")}{kit.current_version} · {kit.versions}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function BrandKitDetailView({ locale, dir, kitId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; kitId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ kit: KitDetail; versions: KitVersionRow[] }>(locale, `/api/creative/brand-kits/${kitId}`);
  const [colors, setColors] = useState('{"primary":"#111111"}');
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  async function newVersion(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const parsed = JSON.parse(colors) as Record<string, unknown>;
      await api(`/api/creative/brand-kits/${kitId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kitver") },
        body: JSON.stringify({ colors: parsed }),
      });
      setNotice(t(locale, "brands.versionCreated"));
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  async function setCurrent(version: number) {
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/brand-kits/${kitId}/current`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kitcur") },
        body: JSON.stringify({ version }),
      });
      setNotice(t(locale, "brands.setCurrentDone"));
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <p><Link href="/creative/brand-kits">{t(locale, "common.back")}</Link></p>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : detail.data && (
          <>
            <h1>{detail.data.kit.name}</h1>
            <p>{t(locale, "brands.current")}: {t(locale, "common.version")}{detail.data.kit.current_version}</p>
            <ul className="creative-grid">
              {detail.data.versions.map((version) => (
                <li key={version.version_id} className="creative-card">
                  <h2>{t(locale, "common.version")}{version.version}</h2>
                  <p dir="ltr">{JSON.stringify(version.colors)}</p>
                  {canAdmin && version.version !== detail.data!.kit.current_version && (
                    <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => setCurrent(version.version)}>
                      {t(locale, "brands.setCurrent")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canAdmin && (
              <form className="creative-form" onSubmit={newVersion}>
                <h2>{t(locale, "brands.newVersion")}</h2>
                <label>{t(locale, "brands.colors")}<textarea value={colors} onChange={(event) => setColors(event.target.value)} dir="ltr" /></label>
                <button type="submit" className="creative-button" disabled={working}>{t(locale, "common.save")}</button>
              </form>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
          </>
        )}
    </div>
  );
}
