import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Item 8: Product Studio keeps its shell when image generation is disabled", () => {
  const product = read("apps/dashboard/lib/server/creative/product.ts");
  const presets = product.slice(
    product.indexOf("export async function listImagePresets"),
    product.indexOf("export async function submitProductScene"),
  );
  assert.doesNotMatch(presets, /image_generation_disabled/);
  assert.match(presets, /await authorize\(request/);

  const view = read("apps/dashboard/components/creative/product-view.tsx");
  assert.match(view, /GENERATION_DISABLED_CODES/);
  assert.match(view, /product\.disabledReason/);
  // A preset failure no longer replaces the whole page with one error banner.
  assert.match(view, /\{presets\.error \? <LoadError/);
  assert.match(view, /onRetry=\{presets\.reload\} \/> : null\}/);
  assert.match(view, /\{!presets\.loading && !presets\.error && canOperate && \(/);
});

test("Item 9: previews scale the fixed creative canvas instead of cropping it", () => {
  assert.ok(existsSync(new URL("../apps/dashboard/components/creative/scaled-preview.tsx", import.meta.url)));
  const scaled = read("apps/dashboard/components/creative/scaled-preview.tsx");
  assert.match(scaled, /ResizeObserver/);
  assert.match(scaled, /transform: `scale\(\$\{scale\}\)`/);

  const design = read("apps/dashboard/components/creative/design-editor-view.tsx");
  const motion = read("apps/dashboard/components/creative/motion-editor-view.tsx");
  assert.match(design, /<ScaledPreview/);
  assert.match(motion, /<ScaledPreview/);
  assert.doesNotMatch(motion, /<iframe title="motion-preview"/);

  const css = read("apps/dashboard/app/creative.css");
  assert.match(css, /\.creative-scaled-frame \{/);
  assert.match(css, /\.creative-card label \{\s*display: grid/);
});

test("Item 10: Campaigns, Approvals and Agent actions gained search, filter and sort", () => {
  for (const path of [
    "apps/dashboard/components/campaigns-view.tsx",
    "apps/dashboard/components/approval-workspace.tsx",
    "apps/dashboard/components/ghl-action-review.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /className="list-toolbar/, `${path} has no list toolbar`);
    assert.match(source, /className="search-field"/, `${path} has no search field`);
    assert.match(source, /className="list-select"/, `${path} has no filter/sort selects`);
  }
  const campaigns = read("apps/dashboard/components/campaigns-view.tsx");
  assert.match(campaigns, /visible\.map\(/);
  assert.doesNotMatch(campaigns, /campaign-portfolio[^>]*>\{operations\.data\.campaigns\.map/);
});

test("Item 11: Request changes needs three characters in both review surfaces", () => {
  const approvals = read("apps/dashboard/components/approval-workspace.tsx");
  assert.match(approvals, /const MIN_FEEDBACK = 3;/);
  assert.match(approvals, /reason\.trim\(\)\.length < MIN_FEEDBACK \|\| submitting/);
  assert.match(approvals, /review-feedback-hint/);

  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /at least 3 characters/);
});

test("Item 12: Billing exposes the portal and an invoice history section with reasons", () => {
  const billing = read("apps/dashboard/components/billing-settings.tsx");
  assert.match(billing, /invoicesTitle/);
  assert.match(billing, /billing-invoices/);
  assert.match(billing, /billing-invoices-empty/);
  // The portal control is rendered for owners even before a Stripe customer exists.
  assert.match(billing, /\{payload\.can_manage_billing \? <div className="billing-actions">/);
  assert.match(billing, /!payload\.billing_configured \|\| !payload\.has_stripe_customer/);
  assert.match(billing, /const lockedReason = current/);
  assert.match(billing, /title=\{lockedReason \|\| undefined\}/);
});

test("Item 13: Content Library work-pack cards preview every specialist", () => {
  const library = read("apps/dashboard/components/content-library.tsx");
  assert.match(library, /content-pack-preview/);
  assert.match(library, /deliverables\.map\(\(deliverable\) => <div key=\{deliverable\.sequence\}>/);
  assert.match(library, /item\.content_type === "work_pack" && !isExpanded && deliverables\.length > 1/);
});

test("Item 14: disabled creative buttons render as unavailable, not teal", () => {
  const css = read("apps/dashboard/app/creative.css");
  const disabled = css.slice(css.indexOf(".creative-button[disabled] {"));
  assert.match(disabled, /background: var\(--surface/);
  assert.match(disabled, /color: var\(--muted-foreground/);
  assert.match(disabled, /cursor: not-allowed/);
});

test("Item 15: form hints are labelled as examples, not prefilled drafts", () => {
  assert.match(read("apps/dashboard/components/agency-workspace.tsx"), /e\.g\. Summer course campaign work pack/);
  const knowledge = read("apps/dashboard/components/knowledge-management.tsx");
  assert.match(knowledge, /e\.g\. pricing_standard/);
  assert.match(knowledge, /e\.g\. Standard service pricing/);
  assert.doesNotMatch(knowledge, /useState\("pricing_standard"\)/);
});

test("Item 16: minors — system label, bilingual presenter option, Arabic dates, localised 404", () => {
  const shell = read("apps/dashboard/components/app-shell.tsx");
  assert.match(shell, /System monitoring/);
  assert.doesNotMatch(shell, /<span>\{ar \? "التنبيهات" : "Alerts"\}<\/span>/);

  const presenter = read("apps/dashboard/components/creative/presenter-view.tsx");
  assert.match(presenter, /\{c\.bilingual\}/);

  const approvals = read("apps/dashboard/components/approval-workspace.tsx");
  assert.match(approvals, /formatDateTime\(value, ar \? "ar" : "en"/);
  assert.match(approvals, /withoutDuplicateHeading/);

  assert.ok(existsSync(new URL("../apps/dashboard/app/not-found.tsx", import.meta.url)));
  const notFound = read("apps/dashboard/app/not-found.tsx");
  assert.match(notFound, /creativeLocale/);
  assert.match(notFound, /هذه الصفحة غير موجودة/);
});
