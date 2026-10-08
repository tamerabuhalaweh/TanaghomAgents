"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface AssetRow {
  asset_id: string;
  capability: string;
  title: string | null;
  originating_job_id: string | null;
  latest_version: number;
  review_status: string;
  created_at: string;
}

export function AssetsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const assets = useCreativeFetch<{ assets: AssetRow[] }>(locale, "/api/creative/assets");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canUpload = role === "owner" || role === "operator";
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setWorking(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      if (title.trim()) form.set("title", title.trim());
      const body = await api<{ asset_id: string }>(`/api/creative/uploads`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("creative-upload") },
        body: form,
      });
      setNotice(`${t(locale, "assets.uploaded")} (${body.asset_id})`);
      setFile(null);
      setTitle("");
      await assets.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "assets.title")}</h1></div>
      {canUpload && (
        <form className="creative-form" onSubmit={upload}>
          <h2>{t(locale, "assets.uploadTitle")}</h2>
          <label>
            {t(locale, "assets.file")}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label>
            {t(locale, "assets.name")}
            <input type="text" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button type="submit" className="creative-button" disabled={working || !file}>
            {t(locale, "assets.uploadCta")}
          </button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {assets.loading ? <Loading locale={locale} /> : assets.error ? <LoadError locale={locale} error={assets.error} onRetry={assets.reload} />
        : !assets.data?.assets.length ? <p>{t(locale, "assets.empty")}</p>
        : (
          <ul className="creative-grid">
            {assets.data.assets.map((asset) => (
              <li key={asset.asset_id} className="creative-card">
                <h2><Link href={`/creative/assets/${asset.asset_id}`}>{asset.title ?? asset.capability}</Link></h2>
                <p>{t(locale, "assets.version")} {asset.latest_version} · {asset.review_status}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
