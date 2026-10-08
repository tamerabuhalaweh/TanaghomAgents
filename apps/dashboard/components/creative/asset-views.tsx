"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface AssetVersionRow {
  asset_version_id: string;
  asset_id: string;
  version: number;
  parent_version_id: string | null;
  job_id: string;
  title: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  sha256: string;
  prompt_ref: string | null;
  template_ref: string | null;
  method: string;
  status: string;
  created_at: string;
}

export function AssetDetailView({ locale, dir, assetId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; assetId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ asset: { asset_id: string; capability: string; title: string | null; originating_job_id: string | null }; versions: AssetVersionRow[] }>(
    locale, `/api/creative/assets/${assetId}`,
  );
  const canReview = role === "owner" || role === "reviewer";
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  async function decide(versionId: string, decision: "approved" | "rejected") {
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/assets/versions/${versionId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-decide") },
        body: JSON.stringify({ decision, feedback: feedback.trim() || null }),
      });
      setNotice(t(locale, "assets.decided"));
      setFeedback("");
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <p><Link href="/creative/assets">{t(locale, "common.back")}</Link></p>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : detail.data && (
          <>
            <h1>{detail.data.asset.title ?? detail.data.asset.capability}</h1>
            <h2>{t(locale, "assets.history")}</h2>
            <ul className="creative-grid">
              {detail.data.versions.map((version) => (
                <li key={version.asset_version_id} className="creative-card">
                  <h3>
                    <Link href={`/creative/assets/versions/${version.asset_version_id}`}>
                      {t(locale, "assets.version")} {version.version} · {version.status}
                    </Link>
                  </h3>
                  <dl className="creative-meta">
                    <dt>{t(locale, "assets.job")}</dt><dd>{version.job_id}</dd>
                    <dt>{t(locale, "assets.provenance")}</dt><dd>{version.method} · {version.bytes} B · {version.mime}</dd>
                  </dl>
                  {canReview && ["draft", "in_review"].includes(version.status) && (
                    <div className="creative-row">
                      <button type="button" className="creative-button" disabled={working} onClick={() => decide(version.asset_version_id, "approved")}>
                        {t(locale, "assets.approve")}
                      </button>
                      <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => decide(version.asset_version_id, "rejected")}>
                        {t(locale, "assets.reject")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canReview && (
              <label>
                {t(locale, "assets.feedback")}
                <input type="text" value={feedback} maxLength={2000} onChange={(event) => setFeedback(event.target.value)} />
              </label>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
          </>
        )}
    </div>
  );
}

interface FidelityReview {
  review_id: string;
  overall: string;
  checklist: Record<string, string>;
  override_reason: string | null;
  reviewer_name: string;
  created_at: string;
}

const FIDELITY_KEYS = ["logo", "package_text", "shape", "proportions", "primary_colors", "markings"] as const;

export function VersionDetailView({ locale, dir, versionId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; versionId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ version: AssetVersionRow & { capability: string; fidelity_status: string } }>(locale, `/api/creative/assets/versions/${versionId}`);
  const fidelity = useCreativeFetch<{ reviews: FidelityReview[] }>(locale, `/api/creative/assets/versions/${versionId}/fidelity`);
  const canReview = role === "owner" || role === "reviewer";
  const [feedback, setFeedback] = useState("");
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("passed");
  const [overrideReason, setOverrideReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  async function recordReview(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/assets/versions/${versionId}/fidelity`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-fidelity") },
        body: JSON.stringify({ overall, checklist: checks }),
      });
      setNotice(t(locale, "fidelity.recorded"));
      setChecks({});
      await fidelity.reload();
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  async function decide(decision: "approved" | "rejected") {
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/assets/versions/${versionId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-decide") },
        body: JSON.stringify({ decision, feedback: feedback.trim() || null, fidelity_override_reason: overrideReason.trim() || null }),
      });
      setNotice(t(locale, "assets.decided"));
      setFeedback("");
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : detail.data && (
          <>
            <p><Link href={`/creative/assets/${detail.data.version.asset_id}`}>{t(locale, "common.back")}</Link></p>
            <h1>{detail.data.version.title ?? `${t(locale, "assets.version")} ${detail.data.version.version}`}</h1>
            {detail.data.version.mime.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="creative-preview" src={`/api/creative/assets/versions/${versionId}/preview`} alt="" />
            )}
            <dl className="creative-meta">
              <dt>{t(locale, "assets.version")}</dt><dd>{detail.data.version.version}</dd>
              <dt>{t(locale, "fidelity.status")}</dt><dd>{detail.data.version.fidelity_status}</dd>
              <dt>{t(locale, "assets.job")}</dt>
              <dd><Link href={`/creative/jobs/${detail.data.version.job_id}`}>{detail.data.version.job_id}</Link></dd>
              <dt>{t(locale, "assets.provenance")}</dt>
              <dd>{detail.data.version.method} · {detail.data.version.bytes} B · {detail.data.version.mime} · {detail.data.version.sha256.slice(0, 16)}…</dd>
            </dl>
            <h2>{t(locale, "fidelity.title")}</h2>
            {fidelity.loading ? <Loading locale={locale} />
              : fidelity.error ? <LoadError locale={locale} error={fidelity.error} onRetry={fidelity.reload} />
              : (
                <ul className="creative-grid">
                  {(fidelity.data?.reviews ?? []).map((review) => (
                    <li key={review.review_id} className="creative-card">
                      <h3>{review.overall} · {review.reviewer_name}</h3>
                      <p dir="ltr">{JSON.stringify(review.checklist)}</p>
                      {review.override_reason && <p>{review.override_reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            {canReview && (
              <form className="creative-form" onSubmit={recordReview}>
                <div className="creative-row">
                  {FIDELITY_KEYS.map((key) => (
                    <label key={key}>{t(locale, `fidelity.${key}` as never)}
                      <select value={checks[key] ?? "unreviewed"} onChange={(event) => setChecks({ ...checks, [key]: event.target.value })}>
                        {["pass", "fail", "unreviewed"].map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <label>{t(locale, "fidelity.status")}
                  <select value={overall} onChange={(event) => setOverall(event.target.value)}>
                    {["passed", "failed", "not_reviewed"].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <button type="submit" className="creative-button" disabled={working}>{t(locale, "fidelity.submit")}</button>
              </form>
            )}
            {canReview && ["draft", "in_review"].includes(detail.data.version.status) && (
              <>
                <h2>{t(locale, "assets.review")}</h2>
                <label>
                  {t(locale, "assets.feedback")}
                  <input type="text" value={feedback} maxLength={2000} onChange={(event) => setFeedback(event.target.value)} />
                </label>
                <label>
                  {t(locale, "fidelity.override")}
                  <input type="text" value={overrideReason} maxLength={2000} onChange={(event) => setOverrideReason(event.target.value)} />
                </label>
                <div className="creative-row">
                  <button type="button" className="creative-button" disabled={working} onClick={() => decide("approved")}>
                    {t(locale, "assets.approve")}
                  </button>
                  <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => decide("rejected")}>
                    {t(locale, "assets.reject")}
                  </button>
                </div>
              </>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
          </>
        )}
    </div>
  );
}
