"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";
import {
  ONBOARDING_KNOWLEDGE_CATEGORIES,
  type OnboardingKnowledgeCategory,
} from "@/lib/onboarding-knowledge";

type Status = "loading" | "ready" | "load_error" | "saving" | "saved" | "error";

const SOURCE_KEY = /^[a-z][a-z0-9_-]{2,79}$/;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 72);
}

function generatedKey(title: string) {
  const slug = slugify(title);
  if (slug.length >= 3 && /^[a-z]/.test(slug)) return slug;
  return `topic_${Date.now().toString(36)}`;
}

export function OnboardingKnowledgeStep({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const [status, setStatus] = useState<Status>("loading");
  const [sources, setSources] = useState(0);
  const [sourceKey, setSourceKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<OnboardingKnowledgeCategory>("faq");
  const [language, setLanguage] = useState<"en" | "ar">(locale);
  const [content, setContent] = useState("");

  useEffect(() => {
    let active = true;
    void authenticatedFetch("/api/admin/knowledge", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setStatus("load_error");
          return;
        }
        const payload = await response.json() as { counts?: { sources?: number } };
        if (!active) return;
        setSources(payload.counts?.sources ?? 0);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("load_error");
      });
    return () => {
      active = false;
    };
  }, []);

  function changeTitle(value: string) {
    setTitle(value);
    if (!keyTouched) setSourceKey(value.trim() ? generatedKey(value) : "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const response = await authenticatedFetch("/api/admin/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_key: sourceKey,
        title: title.trim(),
        category,
        language,
        content: content.trim(),
        provenance_type: "customer_entry",
        provenance_ref: "",
        structured_facts: [],
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
  }

  const stepHeader = (
    <>
      <p className="onboarding-step">{copy.step3Label}</p>
      <h2 className="onboarding-title">{copy.knowledgeTitle}</h2>
      <p className="onboarding-lede">{copy.knowledgeLede}</p>
    </>
  );

  if (status === "loading") {
    return <section className="onboarding-form">{stepHeader}<p className="onboarding-message" aria-live="polite">{copy.knowledgeLoading}</p></section>;
  }
  if (status === "load_error") {
    return <section className="onboarding-form">{stepHeader}<p className="onboarding-message" role="alert">{copy.knowledgeError}</p></section>;
  }
  if (status === "saved") {
    return (
      <section className="onboarding-form">
        {stepHeader}
        <p className="onboarding-message" role="status" aria-live="polite">{copy.knowledgeSaved}</p>
        <p className="onboarding-note">{copy.knowledgeDraftNote}</p>
        <Link className="onboarding-link" href="/knowledge">{copy.knowledgeOpen}</Link>
      </section>
    );
  }

  return (
    <form className="onboarding-form" onSubmit={submit} dir={locale === "ar" ? "rtl" : "ltr"}>
      {stepHeader}
      {sources > 0 ? <p className="onboarding-note">{copy.knowledgeExisting}</p> : null}

      <div className="onboarding-grid">
        <label className="onboarding-field">
          <span>{copy.knowledgeTitleLabel}</span>
          <input type="text" value={title} required minLength={3} maxLength={200} placeholder={copy.knowledgeTitlePlaceholder} onChange={(event) => changeTitle(event.target.value)} />
        </label>

        <label className="onboarding-field">
          <span>{copy.knowledgeSourceKeyLabel}</span>
          <input
            type="text"
            value={sourceKey}
            required
            pattern="[a-z][a-z0-9_-]{2,79}"
            maxLength={80}
            dir="ltr"
            onChange={(event) => {
              setKeyTouched(true);
              setSourceKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
            }}
          />
          <small>{copy.knowledgeSourceKeyHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.knowledgeCategoryLabel}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as OnboardingKnowledgeCategory)}>
            {ONBOARDING_KNOWLEDGE_CATEGORIES.map((value) => (
              <option key={value} value={value}>{copy.knowledgeCategories[value]}</option>
            ))}
          </select>
        </label>

        <label className="onboarding-field">
          <span>{copy.knowledgeLanguageLabel}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ar")}>
            <option value="en">{copy.languages.en}</option>
            <option value="ar">{copy.languages.ar}</option>
          </select>
        </label>

        <label className="onboarding-field onboarding-wide">
          <span>{copy.knowledgeContentLabel}</span>
          <textarea
            value={content}
            required
            minLength={3}
            maxLength={30000}
            rows={7}
            dir={language === "ar" ? "rtl" : "ltr"}
            placeholder={copy.knowledgeContentPlaceholder}
            onChange={(event) => setContent(event.target.value)}
          />
          <small>{copy.knowledgeContentHint}</small>
        </label>
      </div>

      <p className="onboarding-note">{copy.knowledgeDraftNote}</p>
      <p className="onboarding-message" role={status === "error" ? "alert" : undefined} aria-live="polite">
        {status === "error" ? copy.knowledgeError : ""}
      </p>

      <button
        className="onboarding-submit"
        type="submit"
        disabled={status === "saving" || title.trim().length < 3 || content.trim().length < 3 || !SOURCE_KEY.test(sourceKey)}
      >
        {status === "saving" ? copy.knowledgeSaving : copy.knowledgeSave}
      </button>
    </form>
  );
}
