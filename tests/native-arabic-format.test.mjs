import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const easternDigits = /[\u0660-\u0669\u06F0-\u06F9]/;

test("Arabic UI ships Western digits only", () => {
  const files = [
    "apps/dashboard/components/agency-workspace.tsx",
    "apps/dashboard/components/billing-settings.tsx",
    "apps/dashboard/components/overview-dashboard.tsx",
    "apps/dashboard/components/public-pages.tsx",
    "apps/dashboard/components/security-settings.tsx",
    "apps/dashboard/components/super-admin-console.tsx",
    "apps/dashboard/lib/i18n/auth-email.ts",
    "apps/dashboard/lib/i18n/auth.ts",
    "apps/dashboard/lib/i18n/onboarding.ts",
  ];
  for (const file of files) assert.doesNotMatch(read(file), easternDigits, file);
});

test("Arabic formatters pin ar-SA-u-nu-latn and normalize typed digits", () => {
  const format = read("apps/dashboard/lib/i18n/format.ts");
  assert.match(format, /ARABIC_NUMERIC_LOCALE = "ar-SA-u-nu-latn"/);
  assert.match(format, /ARABIC_DATE_LOCALE = "ar-SA-u-nu-latn"/);
  assert.match(format, /export function normalizeDigits/);
  assert.match(format, /export function normalizeNumericInput/);
  assert.match(format, /month: "long"/);
  assert.match(format, /\$\{number\}%/);
});

test("Arabic typography loads IBM Plex Sans Arabic with W3C RTL rules", () => {
  const layout = read("apps/dashboard/app/layout.tsx");
  const css = read("apps/dashboard/app/globals.css");
  assert.match(layout, /IBM_Plex_Sans_Arabic/);
  assert.match(layout, /weight: \["400", "500", "700"\]/);
  assert.match(layout, /display: "swap"/);
  assert.match(layout, /--font-arabic/);
  assert.match(css, /html:lang\(ar\) \{ font-size: 106\.25%; \}/);
  assert.match(css, /letter-spacing: 0 !important/);
  assert.match(css, /line-height: 1\.7/);
  assert.match(css, /line-height: 1\.35/);
  assert.match(css, /scaleX\(-1\)/);
});

test("public Arabic copy isolates Latin tokens and keeps launch copy", () => {
  const page = read("apps/dashboard/components/public-pages.tsx");
  assert.match(page, /<bdi dir="ltr">LAUNCH100<\/bdi>/);
  assert.match(page, /<bdi dir="ltr">Tanaghom<\/bdi>/);
  assert.match(page, /لا يُنشر شيء حتى تقول نعم\./);
  assert.match(page, /مبني بالعربية\. وليس مترجمًا إليها\./);
  assert.match(page, /خطّط\. أنشئ\. وافق\. انشر\. قِس\. في مكان واحد\./);
});
