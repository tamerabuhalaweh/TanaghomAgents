"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface ProviderCallRow {
  provider: string;
  model: string;
  model_version: string | null;
  operation: string;
  provider_request_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  units: unknown;
  estimated_cost_usd: string | null;
  actual_cost_usd: string | null;
  retry_count: number;
  error_class: string | null;
  attempt_no: number;
}

interface JobDetail {
  job_id: string;
  capability: string;
  lane: string;
  status: string;
  attempt: number;
  max_attempts: number;
  correlation_id: string;
  cancel_requested: boolean;
  error_class: string | null;
  output_asset_ids: string[];
  created_at: string;
  updated_at: string;
}

interface TimelineEntry {
  from_status?: string | null;
  to_status?: string | null;
  action?: string;
  actor_kind?: string;
  actor_ref?: string;
  payload?: unknown;
  result?: string | null;
  reason?: string | null;
  created_at: string;
}

export function JobDetailView({ locale, dir, jobId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; jobId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ job: JobDetail; timeline: { transitions: TimelineEntry[]; events: TimelineEntry[] }; provider_calls: ProviderCallRow[] }>(locale, `/api/creative/jobs/${jobId}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canOperate = role === "owner" || role === "operator";
  async function cancel() {
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ status: string }>(`/api/creative/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("creative-cancel") },
      });
      setNotice(`${t(locale, "jobs.cancelled")} (${body.status})`);
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <p><Link href="/creative/jobs">{t(locale, "common.back")}</Link></p>
      <h1>{t(locale, "jobs.detail")}</h1>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : detail.data && (
          <>
            <dl className="creative-meta">
              <dt>{t(locale, "jobs.capability")}</dt><dd>{detail.data.job.capability}</dd>
              <dt>{t(locale, "jobs.lane")}</dt><dd>{detail.data.job.lane}</dd>
              <dt>{t(locale, "jobs.status")}</dt><dd>{detail.data.job.status}</dd>
              <dt>{t(locale, "jobs.attempt")}</dt><dd>{detail.data.job.attempt}/{detail.data.job.max_attempts}</dd>
              <dt>{t(locale, "jobs.correlation")}</dt><dd>{detail.data.job.correlation_id}</dd>
              <dt>{t(locale, "jobs.error")}</dt><dd>{detail.data.job.error_class ?? "—"}</dd>
              <dt>{t(locale, "jobs.outputs")}</dt>
              <dd>{detail.data.job.output_asset_ids.length ? detail.data.job.output_asset_ids.join(", ") : "—"}</dd>
            </dl>
            {canOperate && ["queued", "claimed", "running"].includes(detail.data.job.status) && (
              <div className="creative-row">
                <button type="button" className="creative-button" disabled={working} onClick={cancel}>
                  {t(locale, "jobs.cancel")}
                </button>
              </div>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
            <h2>{t(locale, "jobs.provider")}</h2>
            {!detail.data.provider_calls.length ? <p>{t(locale, "overview.empty")}</p> : (
              <div className="creative-table-scroll">
                <table>
                  <thead><tr><th>provider</th><th>model</th><th>op</th><th>status</th><th>{t(locale, "jobs.cost")}</th></tr></thead>
                  <tbody>
                    {detail.data.provider_calls.map((call, index) => (
                      <tr key={index}>
                        <td>{call.provider}</td>
                        <td dir="ltr">{call.model}{call.model_version ? ` (${call.model_version})` : ""}</td>
                        <td>{call.operation} · #{call.attempt_no}</td>
                        <td>{call.status}{call.error_class ? ` (${call.error_class})` : ""}</td>
                        <td dir="ltr">est {call.estimated_cost_usd ?? "—"} / act {call.actual_cost_usd ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2>{t(locale, "jobs.timeline")}</h2>
            <div className="creative-table-scroll">
              <table>
                <thead><tr><th>—</th><th>—</th></tr></thead>
                <tbody>
                  {detail.data.timeline.transitions.map((entry, index) => (
                    <tr key={`t-${index}`}>
                      <td>{entry.from_status ?? "∅"} → {entry.to_status}</td>
                      <td>{entry.actor_kind}/{entry.actor_ref} · {entry.created_at}</td>
                    </tr>
                  ))}
                  {detail.data.timeline.events.map((entry, index) => (
                    <tr key={`e-${index}`}>
                      <td>{entry.action}</td>
                      <td>{entry.result ?? ""} · {entry.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  );
}
