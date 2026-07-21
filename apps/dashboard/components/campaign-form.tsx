"use client";

import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";

export interface CampaignFormValue {
  name: string;
  brief: string;
  product_type: "camp" | "book" | "coaching_program" | "course";
  audience: string;
  geography: string;
  languages: string[];
  budget_target: string;
  revenue_target: string;
  currency: string;
  content_item_target: string;
}

export const emptyCampaignForm: CampaignFormValue = {
  name: "", brief: "", product_type: "course", audience: "", geography: "",
  languages: ["en", "ar"], budget_target: "0", revenue_target: "0",
  currency: "USD", content_item_target: "2",
};

export function CampaignForm({
  initialValue = emptyCampaignForm,
  title,
  description,
  submitLabel,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  initialValue?: CampaignFormValue;
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (value: CampaignFormValue) => Promise<void>;
  onClose?: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  function field<Key extends keyof CampaignFormValue>(key: Key, next: CampaignFormValue[Key]) {
    setValue((current) => ({ ...current, [key]: next }));
  }
  function language(code: string, checked: boolean) {
    field("languages", checked
      ? [...new Set([...value.languages, code])]
      : value.languages.filter((item) => item !== code));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(value);
  }

  return <section className="campaign-composer" aria-labelledby={`${id}-title`}>
    <header>
      <div><h2 id={`${id}-title`}>{title}</h2><p>{description}</p></div>
      {onClose ? <button className="icon-button" type="button" onClick={onClose} aria-label="Close campaign form"><X size={18} /></button> : null}
    </header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="campaign-form-grid">
        <label className="campaign-name-field"><span>Campaign name</span><input required minLength={3} maxLength={200} value={value.name} onChange={(event) => field("name", event.target.value)} placeholder="Family creativity workshop" /></label>
        <label><span>Product or offer</span><select value={value.product_type} onChange={(event) => field("product_type", event.target.value as CampaignFormValue["product_type"])}><option value="course">Course</option><option value="camp">Camp</option><option value="book">Book</option><option value="coaching_program">Coaching program</option></select></label>
        <label className="campaign-brief-field"><span>Campaign brief</span><textarea required minLength={20} maxLength={12000} value={value.brief} onChange={(event) => field("brief", event.target.value)} placeholder="Describe the offer, outcome, proof, constraints, and what the agents must never claim." /><small>Give the Strategist enough verified context to work without inventing facts.</small></label>
        <label className="campaign-audience-field"><span>Target audience</span><textarea required minLength={10} maxLength={1000} value={value.audience} onChange={(event) => field("audience", event.target.value)} placeholder="Parents aged 28–50 with children aged 7–14" /></label>
        <label><span>Target geography</span><input required minLength={2} maxLength={300} value={value.geography} onChange={(event) => field("geography", event.target.value)} placeholder="Amman, Jordan" /></label>
        <fieldset className="campaign-language-field"><legend>Content languages</legend><label><input type="checkbox" checked={value.languages.includes("en")} onChange={(event) => language("en", event.target.checked)} /> English</label><label><input type="checkbox" checked={value.languages.includes("ar")} onChange={(event) => language("ar", event.target.checked)} /> Arabic</label></fieldset>
        <label><span>Budget target</span><input type="number" min="0" step="0.01" value={value.budget_target} onChange={(event) => field("budget_target", event.target.value)} /></label>
        <label><span>Revenue target</span><input type="number" min="0" step="0.01" value={value.revenue_target} onChange={(event) => field("revenue_target", event.target.value)} /></label>
        <label><span>Currency</span><select value={value.currency} onChange={(event) => field("currency", event.target.value)}><option>USD</option><option>JOD</option><option>AED</option><option>SAR</option><option>EUR</option><option>GBP</option></select></label>
        <label><span>First content batch</span><input type="number" min="1" max="12" step="1" value={value.content_item_target} onChange={(event) => field("content_item_target", event.target.value)} /><small>Between 1 and 12 human-reviewed drafts.</small></label>
      </div>
      <footer>
        <div className="campaign-form-safety"><ShieldCheck size={18} /><p>Creates a Tanaghom draft only. Publishing, CRM actions, messaging, and spend remain unavailable.</p></div>
        <div className="campaign-form-submit">
          {error ? <p role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Saving campaign…</> : submitLabel}</button>
        </div>
      </footer>
    </form>
  </section>;
}
