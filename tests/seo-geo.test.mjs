import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildPublicPageMetadata,
  CANONICAL_SITE_URL,
  DISALLOWED_CRAWL_PATHS,
  landingJsonLd,
  OG_IMAGE_URL,
  pricingJsonLd,
  PUBLIC_SEO_COPY,
} from "../apps/dashboard/lib/seo.ts";

const root = path.resolve(import.meta.dirname, "..");

test("robots.ts merges SEO disallow list with GEO AI search crawlers and canonical sitemap", () => {
  assert.equal(existsSync(path.join(root, "apps/dashboard/public")), false, "apps/dashboard must not add a public/ directory");
  const robotsSource = readFileSync(path.join(root, "apps/dashboard/app/robots.ts"), "utf8");
  for (const bot of [
    "OAI-SearchBot",
    "ChatGPT-User",
    "GPTBot",
    "ClaudeBot",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Googlebot",
    "Bingbot",
  ]) {
    assert.ok(robotsSource.includes(`"${bot}"`), `robots.ts must list ${bot}`);
  }
  assert.match(robotsSource, /sitemap:\s*`\$\{CANONICAL_SITE_URL\}\/sitemap\.xml`/);
  for (const disallowed of [
    "/api/",
    "/workspace/",
    "/campaigns/",
    "/content/",
    "/settings/",
    "/super-admin/",
    "/onboarding/",
    "/login/",
    "/signup/",
    "/accept-invite/",
    "/verify-email/",
    "/forgot-password/",
    "/reset-password/",
  ]) {
    assert.ok(DISALLOWED_CRAWL_PATHS.includes(disallowed), `DISALLOWED_CRAWL_PATHS missing ${disallowed}`);
  }
});

test("sitemap.ts lists only canonical public pages with lastModified and zero app routes", () => {
  const sitemapSource = readFileSync(path.join(root, "apps/dashboard/app/sitemap.ts"), "utf8");
  for (const route of ['"/"', '"/pricing"', '"/privacy"', '"/terms"']) {
    assert.ok(sitemapSource.includes(route), `sitemap.ts missing ${route}`);
  }
  for (const forbidden of ["/workspace", "/campaigns", "/settings", "/super-admin", "/login", "/signup", "/api"]) {
    assert.equal(sitemapSource.includes(forbidden), false, `sitemap.ts must not contain ${forbidden}`);
  }
  assert.match(sitemapSource, /lastModified/);
});

test("llms.txt route serves concise, accurate E3lani product and pricing summary", async () => {
  const llmsSource = readFileSync(path.join(root, "apps/dashboard/app/llms.txt/route.ts"), "utf8");
  assert.match(llmsSource, /# E3lani/);
  assert.match(llmsSource, /E3lani \(إعلاني\) is an AI marketing team for small businesses/);
  assert.match(llmsSource, /Starter \$15\/month, Growth \$25\/month, Scale \$50\/month/);
  assert.match(llmsSource, /15 \/ 50 \/ 200 AI campaigns per month/);
  assert.match(llmsSource, /#faq/);
  assert.doesNotMatch(llmsSource, /\/faq\b/);
  assert.match(llmsSource, /text\/plain; charset=utf-8/);
});

test("every public page has unique 50–60 char EN/AR titles, unique descriptions, canonical, hreflang, and OG/Twitter cards", () => {
  const seenEnTitles = new Set();
  const seenArTitles = new Set();
  const seenEnDesc = new Set();
  const seenArDesc = new Set();

  for (const key of ["home", "pricing", "privacy", "terms"]) {
    const entry = PUBLIC_SEO_COPY[key];
    for (const [locale, seenT, seenD] of [
      ["en", seenEnTitles, seenEnDesc],
      ["ar", seenArTitles, seenArDesc],
    ]) {
      const meta = buildPublicPageMetadata(key, locale);
      const title = typeof meta.title === "object" && meta.title && "absolute" in meta.title ? meta.title.absolute : "";
      const description = meta.description || "";
      assert.ok(title.length >= 50 && title.length <= 60, `${key} (${locale}) title length ${title.length} outside 50-60: "${title}"`);
      assert.ok(description.length >= 100 && description.length <= 165, `${key} (${locale}) description length ${description.length} out of range`);
      assert.ok(locale === "ar" ? title.includes("إعلاني") : title.includes("E3lani"), `${key} (${locale}) title must include brand`);
      assert.equal(seenT.has(title), false, `duplicate ${locale} title: ${title}`);
      assert.equal(seenD.has(description), false, `duplicate ${locale} description`);
      seenT.add(title);
      seenD.add(description);

      assert.equal(meta.robots, undefined, `public page ${key} must not set noindex`);
      const expectedCanonical = entry.path === "/" ? `${CANONICAL_SITE_URL}/` : `${CANONICAL_SITE_URL}${entry.path}`;
      assert.equal(meta.alternates?.canonical, expectedCanonical);
      assert.equal(meta.alternates?.languages?.en, expectedCanonical);
      assert.equal(meta.alternates?.languages?.ar, expectedCanonical);
      assert.equal(meta.alternates?.languages?.["x-default"], expectedCanonical);
      assert.equal(meta.openGraph?.url, expectedCanonical);
      assert.equal(meta.twitter?.card, "summary_large_image");
      assert.deepEqual(meta.twitter?.images, [OG_IMAGE_URL]);
    }
  }
});

test("JSON-LD emits Organization, WebSite, and FAQPage schemas cleanly in EN and AR", () => {
  for (const locale of ["en", "ar"]) {
    const home = landingJsonLd(locale);
    assert.equal(home["@context"], "https://schema.org");
    const types = home["@graph"].map((node) => node["@type"]);
    assert.deepEqual(types, ["Organization", "WebSite", "FAQPage"]);
    const faqNode = home["@graph"].find((node) => node["@type"] === "FAQPage");
    assert.equal(faqNode.mainEntity.length, 6);

    const pricing = pricingJsonLd(locale);
    assert.equal(pricing["@type"], "FAQPage");
    assert.equal(pricing.mainEntity.length, 4);
  }
});

test("auth pages carry noindex and proxy permits /opengraph-image", () => {
  for (const file of [
    "apps/dashboard/app/login/page.tsx",
    "apps/dashboard/app/signup/page.tsx",
    "apps/dashboard/app/forgot-password/page.tsx",
    "apps/dashboard/app/reset-password/page.tsx",
    "apps/dashboard/app/verify-email/page.tsx",
    "apps/dashboard/app/accept-invite/page.tsx",
    "apps/dashboard/app/super-admin/page.tsx",
  ]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.match(src, /robots:\s*\{\s*index:\s*false/, `${file} must set robots: { index: false }`);
  }

  const proxy = readFileSync(path.join(root, "apps/dashboard/proxy.ts"), "utf8");
  assert.match(proxy, /"\/opengraph-image"/);

  const publicPages = readFileSync(path.join(root, "apps/dashboard/components/public-pages.tsx"), "utf8");
  assert.match(publicPages, /id="faq" className="public-faq public-faq-landing"/);
  assert.match(publicPages, /headingLevel="h2"/);
  assert.match(publicPages, /E3lani is the AI marketing team for small businesses/);
  assert.match(publicPages, /E3lani gives small businesses and marketing teams flat-rate plans from \$15\/month/);
});
