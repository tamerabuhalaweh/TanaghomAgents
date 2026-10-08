"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface PresetDoc {
  presets: Array<{ code: string; display: string }>;
}

interface AssetRow {
  asset_id: string;
  title: string | null;
  capability: string;
  latest_version_id: string;
  latest_version: number;
}

export function ProductView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const presets = useCreativeFetch<PresetDoc>(locale, "/api/creative/product/presets");
  const assets = useCreativeFetch<{ assets: AssetRow[] }>(locale, "/api/creative/assets");
  const [source, setSource] = useState("");
  const [preset, setPreset] = useState("clean_white");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const canOperate = role === "owner" || role === "operator";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ job_id: string }>(`/api/creative/product/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-product") },
        body: JSON.stringify({ source_version_id: source || undefined, preset }),
      });
      setJobId(body.job_id);
      setNotice(t(locale, "product.submitted"));
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "product.title")}</h1></div>
      {presets.loading || assets.loading ? <Loading locale={locale} />
        : presets.error ? <LoadError locale={locale} error={presets.error} onRetry={presets.reload} />
        : assets.error ? <LoadError locale={locale} error={assets.error} onRetry={assets.reload} />
        : canOperate && (
          <form className="creative-form" onSubmit={submit}>
            <label>{t(locale, "product.source")}
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="">—</option>
                {(assets.data?.assets ?? []).map((asset) => (
                  <option key={asset.asset_id} value={asset.latest_version_id}>
                    {(asset.title ?? asset.asset_id.slice(0, 8))} ({t(locale, "assets.version")} {asset.latest_version})
                  </option>
                ))}
              </select>
            </label>
            <label>{t(locale, "product.preset")}
              <select value={preset} onChange={(event) => setPreset(event.target.value)}>
                {(presets.data?.presets ?? []).map((option) => (
                  <option key={option.code} value={option.code}>{option.display}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="creative-button" disabled={working || !source}>{t(locale, "product.submit")}</button>
          </form>
        )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {jobId && <p><Link href={`/creative/jobs/${jobId}`}>{jobId.slice(0, 8)}…</Link></p>}
    </div>
  );
}
