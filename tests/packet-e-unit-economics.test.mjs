import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Packet E defines per-tier token ceilings and the per-campaign retry cap", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  const ui = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(quota, /SANDBOX_MONTHLY_TOKEN_LIMIT = 100_000/);
  assert.match(quota, /starter: 600_000,\s+growth: 2_000_000,\s+scale: 8_000_000/);
  assert.match(quota, /MAX_RETRIES_PER_CAMPAIGN = 3/);
  assert.match(quota, /tokens_used: number/);
  assert.match(quota, /tokens_limit: number/);
  assert.match(quota, /max_retries_per_campaign: number/);
  assert.match(quota, /quota\.tokens_used >= quota\.tokens_limit/);
  assert.match(quota, /quota\.is_sandbox \? "subscription_required_for_more_campaigns" : "plan_monthly_token_limit_reached"/);
  assert.match(quota, /quota\.is_sandbox \? 402 : 409/);
  assert.match(quota, /event_type = 'resumed'/);
  assert.match(quota, /COALESCE\(\(evidence->>'retried_from_failed'\)::boolean, false\) = true/);
  assert.match(quota, /WorkspaceQuotaError\("workspace_retry_limit_reached", 409\)/);
  assert.match(ui, /plan_monthly_token_limit_reached/);
  assert.match(ui, /workspace_retry_limit_reached/);
  assert.match(ui, /limit المحاولات الثلاث|حد المحاولات الثلاث/);
  assert.match(ui, /quota\.tokens_used/);
  assert.match(ui, /quota\.tokens_limit/);
});

test("campaign quota counts active or delivered work, never a zero-deliverable failure", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  assert.match(quota, /workspace\.status IN \('queued', 'running', 'in_progress', 'waiting_review', 'approved', 'paused', 'rejected'\)/);
  assert.match(quota, /workspace\.status = 'failed' AND EXISTS \(/);
  assert.match(quota, /task\.status = 'succeeded'/);
  assert.doesNotMatch(quota, /workspace\.status <> 'draft'/);
  assert.match(quota, /task\.result->'usage' IS NOT NULL/);
});

test("unit economics uses one shared four-decimal AI cost estimator", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  const superAdmin = read("apps/dashboard/lib/server/super-admin.ts");
  assert.match(quota, /promptTokens \/ 1_000_000\) \* GEMINI_INPUT_USD_PER_MILLION/);
  assert.match(quota, /completionTokens \/ 1_000_000\) \* GEMINI_OUTPUT_USD_PER_MILLION/);
  assert.match(quota, /GEMINI_INPUT_USD_PER_MILLION = 0\.3/);
  assert.match(quota, /GEMINI_OUTPUT_USD_PER_MILLION = 2\.5/);
  assert.match(quota, /\.toFixed\(4\)/);
  assert.match(superAdmin, /estimatedAiCostUsd/);
  assert.match(superAdmin, /unit_economics: unitEconomics/);
  assert.match(superAdmin, /monthly_revenue_usd/);
  assert.match(superAdmin, /month_campaigns_used/);
  assert.match(superAdmin, /workspace\.status IN \('queued', 'running', 'in_progress', 'waiting_review', 'approved', 'paused', 'rejected'\)/);
  assert.doesNotMatch(superAdmin, /workspace\.status <> 'draft'/);
  assert.match(superAdmin, /month_total_tokens/);
  assert.match(superAdmin, /net_margin_usd/);
  assert.match(superAdmin, /gross_margin_pct/);
  assert.match(superAdmin, /margin_status/);
  assert.match(superAdmin, /cost > revenue \* 0\.4/);
  assert.match(superAdmin, /cost > revenue \* 0\.2/);
  assert.match(superAdmin, /tokens >= 100_000/);
  assert.match(superAdmin, /tokens >= 70_000/);
  assert.match(superAdmin, /gross_margin_usd: grossMargin/);
  assert.match(superAdmin, /at_risk_workspaces_count/);
  assert.match(superAdmin, /unitEconomics\.slice\(0, 50\)/);
});

test("cockpit renders the bilingual Customer Unit Economics & Cost Center table", () => {
  const ui = read("apps/dashboard/components/super-admin-console.tsx");
  const css = read("apps/dashboard/app/globals.css");
  assert.match(ui, /Customer Unit Economics & Cost Center/);
  assert.match(ui, /مركز تكلفة العملاء واقتصاديات الوحدة/);
  assert.match(ui, /Plan & monthly revenue/);
  assert.match(ui, /Monthly AI tokens/);
  assert.match(ui, /Estimated AI cost/);
  assert.match(ui, /Margin health/);
  assert.match(ui, /marginHealthy: "Healthy"/);
  assert.match(ui, /marginHealthy: "سليم"/);
  assert.match(ui, /marginWatch: "مراقبة"/);
  assert.match(ui, /marginAtRisk: "مرتفع التكلفة"/);
  assert.match(ui, /marginSandbox: "تجريبي"/);
  assert.match(ui, /money\(workspace\.monthly_revenue_usd, locale, 2\)/);
  assert.match(ui, /workspace\.month_total_tokens/);
  assert.match(ui, /workspace\.tokens_limit/);
  assert.match(css, /\.super-margin-at_risk/);
});

test("active subscribers switch plans through Stripe Billing Portal without a second Checkout", () => {
  const route = read("apps/dashboard/app/api/billing/checkout/route.ts");
  const ui = read("apps/dashboard/components/billing-settings.tsx");
  assert.match(route, /row\.status === "active" && row\.stripe_customer_id/);
  assert.match(route, /createStripePortalSession\(row\.stripe_customer_id\)/);
  assert.match(route, /billing\.portal_upgrade_opened/);
  assert.match(route, /requested_plan_tier: planId/);
  assert.match(route, /via: "portal"/);
  assert.match(ui, /via\?: "portal"/);
  assert.match(ui, /Plan upgrades and downgrades modify your active subscription/);
  assert.match(ui, /يعدّل تغيير خطتك اشتراكك الحالي/);
  assert.match(ui, /التناسب الزمني تلقائيًا/);
});

test("anti-bot helpers block disposable email and verify Turnstile only when configured", async () => {
  const source = read("apps/dashboard/lib/server/turnstile.ts");
  const { isDisposableEmail, rightmostForwardedIp, verifyTurnstileToken } = await import(
    "../apps/dashboard/lib/server/turnstile.ts"
  );
  for (const domain of [
    "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com",
    "temp-mail.org", "yopmail.com", "sharklasers.com", "trashmail.com",
    "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com",
    "throwawaymail.com",
  ]) {
    assert.match(source, new RegExp(domain.replace(".", "\\.")));
    assert.equal(isDisposableEmail(`person@${domain}`), true);
    assert.equal(isDisposableEmail(`PERSON@${domain.toUpperCase()}`), true);
  }
  assert.equal(isDisposableEmail("owner@company.com"), false);
  assert.equal(rightmostForwardedIp("203.0.113.5, 198.51.100.8"), "198.51.100.8");
  assert.equal(rightmostForwardedIp(null), null);

  delete process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY_FILE = "/run/secrets/turnstile_secret_key_missing";
  assert.deepEqual(await verifyTurnstileToken("", null), { ok: true, skipped: true });

  const originalFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    const form = init.body;
    assert.equal(form.get("secret"), "turnstile-test-secret");
    assert.equal(form.get("response"), "valid-token");
    assert.equal(form.get("remoteip"), "198.51.100.8");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    assert.deepEqual(
      await verifyTurnstileToken("valid-token", "198.51.100.8"),
      { ok: true },
    );
    assert.deepEqual(await verifyTurnstileToken("", null), { ok: false });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SECRET_KEY_FILE;
  }
  assert.match(source, /AbortSignal\.timeout\(8_000\)/);
});

test("signup and waitlist enforce anti-bot checks and use the rightmost proxy hop", () => {
  const signup = read("apps/dashboard/app/api/auth/signup/route.ts");
  const waitlist = read("apps/dashboard/app/api/waitlist/route.ts");
  const signupForm = read("apps/dashboard/components/signup-form.tsx");
  const waitlistForm = read("apps/dashboard/components/waitlist-form.tsx");
  const widget = read("apps/dashboard/components/turnstile-widget.tsx");
  for (const route of [signup, waitlist]) {
    assert.match(route, /isDisposableEmail/);
    assert.match(route, /disposable_email_not_allowed/);
    assert.match(route, /verifyTurnstileToken/);
    assert.match(route, /captcha_verification_failed/);
  }
  assert.match(waitlist, /rightmostForwardedIp/);
  assert.match(waitlist, /request\.headers\.get\("x-forwarded-for"\)/);
  assert.match(signupForm, /Temporary email addresses are not accepted/);
  assert.match(signupForm, /عناوين البريد المؤقتة/);
  assert.match(waitlistForm, /Temporary email addresses are not accepted/);
  assert.match(waitlistForm, /عناوين البريد المؤقتة/);
  assert.match(widget, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(widget, /render=explicit/);
  assert.match(widget, /challenges\.cloudflare\.com/);
});

test("deployment passes Turnstile keys and an optional secret mount through Compose", () => {
  const compose = read("deployment/dashboard-demo/compose.yml");
  const example = read("deployment/dashboard-demo/.env.example");
  const rootExample = read(".env.example");
  const validator = read("deployment/dashboard-demo/scripts/validate-compose.py");
  assert.match(compose, /TURNSTILE_SECRET_KEY: \$\{TURNSTILE_SECRET_KEY:-\}/);
  assert.match(compose, /TURNSTILE_SECRET_KEY_FILE: \$\{TURNSTILE_SECRET_KEY_FILE:-\/run\/secrets\/turnstile_secret_key\}/);
  assert.match(compose, /NEXT_PUBLIC_TURNSTILE_SITE_KEY: \$\{NEXT_PUBLIC_TURNSTILE_SITE_KEY:-\}/);
  assert.match(compose, /- turnstile_secret_key/);
  assert.match(example, /^NEXT_PUBLIC_TURNSTILE_SITE_KEY=/m);
  assert.match(example, /^TURNSTILE_SECRET_KEY=/m);
  assert.match(rootExample, /^NEXT_PUBLIC_TURNSTILE_SITE_KEY=/m);
  assert.match(rootExample, /^TURNSTILE_SECRET_KEY=/m);
  assert.match(validator, /TURNSTILE_SECRET_KEY_FILE/);
  assert.match(validator, /turnstile_secret_key/);
});

test("the migration ledger tracks the current chain", () => {
  const ledger = read("deployment/dashboard-demo/scripts/validate-compose.py");
  assert.match(ledger, /len\(migrations\) == 51/);
  assert.match(ledger, /0054_workspace_image_quotas\.up\.sql/);
});
