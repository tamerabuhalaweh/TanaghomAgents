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

interface SegmentJobRow {
  job_id: string;
  status: string;
}

export function ProductView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const presets = useCreativeFetch<PresetDoc>(locale, "/api/creative/product/presets");
  const assets = useCreativeFetch<{ assets: AssetRow[] }>(locale, "/api/creative/assets");
  const segmentJobs = useCreativeFetch<{ jobs: SegmentJobRow[] }>(locale, "/api/creative/segment/jobs");
  const [source, setSource] = useState("");
  const [preset, setPreset] = useState("clean_white");
  const [segmentSource, setSegmentSource] = useState("");
  const [engine, setEngine] = useState("local-deterministic");
  const [feather, setFeather] = useState(1);
  const [cutoutVersionId, setCutoutVersionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [segmentJobId, setSegmentJobId] = useState<string | null>(null);
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
  async function submitSegment(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    setCutoutVersionId(null);
    try {
      const body = await api<{ job_id: string }>(`/api/creative/segment/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-segment") },
        body: JSON.stringify({
          source_version_id: segmentSource,
          engine,
          refine: { feather_px: feather },
          correlation_id: crypto.randomUUID(),
        }),
      });
      setSegmentJobId(body.job_id);
      setNotice(t(locale, "segment.submitted"));
      await pollSegmentCutout(body.job_id);
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  async function pollSegmentCutout(targetJobId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const job = await api<{ job: { status: string; output_asset_ids?: string[] } }>(`/api/creative/jobs/${targetJobId}`);
        if (job.job.status === "succeeded") {
          const assetId = (job.job.output_asset_ids ?? [])[0];
          if (!assetId) return;
          const detail = await api<{ versions: Array<{ asset_version_id: string; version: number }> }>(`/api/creative/assets/${assetId}`);
          const latest = detail.versions[detail.versions.length - 1];
          if (latest) {
            setCutoutVersionId(latest.asset_version_id);
            setNotice(t(locale, "segment.cutoutReady"));
            await assets.reload();
          }
          return;
        }
        if (["failed", "cancelled", "expired"].includes(job.job.status)) return;
      } catch {
        return;
      }
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "product.title")}</h1></div>
      <div className="creative-notice" role="note"><p>{t(locale, "product.segmentation")}</p></div>
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
      {canOperate && (
        <form className="creative-form" onSubmit={submitSegment}>
          <h2>{t(locale, "segment.title")}</h2>
          <label>{t(locale, "product.source")}
            <select value={segmentSource} onChange={(event) => setSegmentSource(event.target.value)}>
              <option value="">—</option>
              {(assets.data?.assets ?? []).map((asset) => (
                <option key={asset.asset_id} value={asset.latest_version_id}>
                  {(asset.title ?? asset.asset_id.slice(0, 8))} ({t(locale, "assets.version")} {asset.latest_version})
                </option>
              ))}
            </select>
          </label>
          <label>{t(locale, "segment.engine")}
            <select value={engine} onChange={(event) => setEngine(event.target.value)}>
              <option value="local-deterministic">{t(locale, "segment.localEngine")}</option>
              <option value="birefnet">{t(locale, "segment.mlEngine")}</option>
            </select>
          </label>
          <label>{t(locale, "segment.feather")}
            <input type="number" value={feather} min={0} max={8} onChange={(event) => setFeather(Number(event.target.value))} />
          </label>
          <button type="submit" className="creative-button" disabled={working || !segmentSource}>{t(locale, "segment.submit")}</button>
        </form>
      )}
      {segmentJobId && <p><Link href={`/creative/jobs/${segmentJobId}`}>{segmentJobId.slice(0, 8)}…</Link></p>}
      {cutoutVersionId && (
        <div className="creative-card">
          <img src={`/api/creative/assets/versions/${cutoutVersionId}/preview`} alt="" width={360} style={{ background: "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 24px 24px" }} />
          <div className="creative-row">
            <button type="button" className="creative-button creative-button-secondary" onClick={() => setSource(cutoutVersionId)}>{t(locale, "segment.useCutout")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
