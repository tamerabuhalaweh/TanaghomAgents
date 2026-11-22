import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as creativeI18n from "../apps/dashboard/lib/i18n/creative.ts";
import * as formatI18n from "../apps/dashboard/lib/i18n/format.ts";
import * as seo from "../apps/dashboard/lib/seo.ts";

const {
  buildPublicPageMetadata,
  CANONICAL_SITE_URL,
  DISALLOWED_CRAWL_PATHS,
  landingJsonLd,
  OG_IMAGE_URL,
  pricingJsonLd,
  PUBLIC_SEO_COPY,
} = seo;

const root = path.resolve(import.meta.dirname, "..");
const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");

function loadTsModule(relPath, extraImports = {}) {
  const source = readFileSync(path.join(root, relPath), "utf8");
  const js = ts.transpileModule(source, {
    fileName: path.basename(relPath),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const resolve = (id) => {
    if (id in extraImports) return extraImports[id];
    if (id === "react") return requireCjs("react");
    if (id === "react/jsx-runtime") return requireCjs("react/jsx-runtime");
    if (id === "@/lib/seo") return seo;
    if (id === "@/lib/i18n/creative") return creativeI18n;
    if (id === "@/lib/i18n/format") return formatI18n;
    if (id === "lucide-react") return new Proxy({}, { get: () => () => null });
    if (id === "next/link") {
      return function LinkStub({ href, children, ...props }) {
        return createElement("a", { href, ...props }, children);
      };
    }
    throw new Error(`unexpected import in ${relPath}: ${id}`);
  };
  new Function("require", "module", "exports", js)(resolve, mod, mod.exports);
  return mod.exports;
}

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
    const orgNode = home["@graph"].find((node) => node["@type"] === "Organization");
    assert.equal(orgNode.email, "Tamer@itis-uk.org");
    const faqNode = home["@graph"].find((node) => node["@type"] === "FAQPage");
    assert.equal(faqNode.mainEntity.length, 7);
    assert.match(faqNode.mainEntity[6].acceptedAnswer.text, /Tamer@itis-uk\.org/);

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

test("Google Search Console HTML verification route and Caddy allowlist are wired", () => {
  const route = readFileSync(path.join(root, "apps/dashboard/app/google0248b443482441b0.html/route.ts"), "utf8");
  const caddyEntry = readFileSync(path.join(root, "deployment/dashboard-demo/caddy/entrypoint.sh"), "utf8");
  assert.match(route, /google-site-verification: google0248b443482441b0\.html/);
  assert.match(caddyEntry, /\/google\*\.html/);
});

test("blog-articles module exposes exact EN/AR metadata, reciprocal hreflang, and BlogPosting + FAQPage JSON-LD", () => {
  const blogArticlesMod = loadTsModule("apps/dashboard/lib/blog-articles.ts");
  const { BLOG_ARTICLES, BLOG_ARTICLE_PATHS, buildBlogArticleMetadata, blogArticleJsonLd } = blogArticlesMod;

  const enSlug = "ai-social-media-manager-small-business";
  const arSlug = "ai-social-media-management-small-business";
  assert.deepEqual([...BLOG_ARTICLE_PATHS], [`/blog/${enSlug}`, `/blog/${arSlug}`]);

  const enUrl = `${CANONICAL_SITE_URL}/blog/${enSlug}`;
  const arUrl = `${CANONICAL_SITE_URL}/blog/${arSlug}`;

  const enMeta = buildBlogArticleMetadata(enSlug);
  assert.equal(enMeta.title.absolute, "AI Social Media Manager for Small Business | E3lani");
  assert.match(enMeta.description, /nothing publishes until you approve it/);
  assert.equal(enMeta.alternates.canonical, enUrl);
  assert.deepEqual(enMeta.alternates.languages, { en: enUrl, ar: arUrl, "x-default": enUrl });
  assert.equal(enMeta.openGraph.type, "article");

  const arMeta = buildBlogArticleMetadata(arSlug);
  assert.equal(arMeta.title.absolute, "إدارة السوشيال ميديا بالذكاء الاصطناعي للشركات الصغيرة | إعلاني");
  assert.match(arMeta.description, /ولا يُنشر شيء قبل موافقتك/);
  assert.equal(arMeta.alternates.canonical, arUrl);
  assert.deepEqual(arMeta.alternates.languages, { en: enUrl, ar: arUrl, "x-default": enUrl });
  assert.equal(arMeta.openGraph.type, "article");

  for (const [slug, expectedLocale, expectedUrl, honestPhrase] of [
    [enSlug, "en", enUrl, /WhatsApp and Meta ad buying are not available yet/],
    [arSlug, "ar", arUrl, /واتساب وشراء إعلانات ميتا غير متاحين بعد/],
  ]) {
    const schema = blogArticleJsonLd(slug);
    assert.equal(schema["@context"], "https://schema.org");
    const types = schema["@graph"].map((node) => node["@type"]);
    assert.deepEqual(types, ["BlogPosting", "FAQPage"]);

    const postNode = schema["@graph"].find((node) => node["@type"] === "BlogPosting");
    assert.equal(postNode.inLanguage, expectedLocale);
    assert.equal(postNode.url, expectedUrl);
    assert.equal(postNode.headline, BLOG_ARTICLES[slug].h1);

    const faqNode = schema["@graph"].find((node) => node["@type"] === "FAQPage");
    assert.equal(faqNode.mainEntity.length, 5);
    assert.deepEqual(
      faqNode.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text })),
      BLOG_ARTICLES[slug].faqs,
    );
    assert.match(faqNode.mainEntity[4].acceptedAnswer.text, honestPhrase);
  }
});

test("blog article pages render EN LTR and AR RTL HTML with cross-links, FAQ accordions, and footer guide links", () => {
  const blogArticlesMod = loadTsModule("apps/dashboard/lib/blog-articles.ts");
  const publicPagesMod = loadTsModule("apps/dashboard/components/public-pages.tsx", {
    "@/components/brand-mark": { BrandMark: () => null },
    "@/components/creative/locale-toggle": { LocaleToggle: () => null },
    "@/components/waitlist-form": { WaitlistForm: () => null },
  });
  const blogPageMod = loadTsModule("apps/dashboard/components/public-blog-page.tsx", {
    "@/components/public-pages": publicPagesMod,
    "@/lib/blog-articles": blogArticlesMod,
  });
  const { PublicBlogArticlePage } = blogPageMod;

  const enHtml = renderToStaticMarkup(
    createElement(PublicBlogArticlePage, { slug: "ai-social-media-manager-small-business" }),
  );
  assert.match(enHtml, /<main class="public-page" dir="ltr" lang="en">/);
  assert.match(enHtml, /<h1>AI Social Media Manager for a Small Business: What It Actually Does, What It Costs, and What Still Needs a Human<\/h1>/);
  assert.match(enHtml, /<a [^>]*href="\/blog\/ai-social-media-management-small-business"[^>]*hrefLang="ar"/i);
  assert.match(enHtml, /href="\/blog\/ai-social-media-manager-small-business">AI Social Media Guide<\/a>/);
  assert.match(enHtml, /WhatsApp and Meta ad buying are not available yet\./);
  assert.match(enHtml, /Nothing publishes until you approve it\./);

  const arHtml = renderToStaticMarkup(
    createElement(PublicBlogArticlePage, { slug: "ai-social-media-management-small-business" }),
  );
  assert.match(arHtml, /<main class="public-page" dir="rtl" lang="ar">/);
  assert.match(arHtml, /<h1>إدارة السوشيال ميديا بالذكاء الاصطناعي للشركات الصغيرة: ما الذي تفعله الأداة، وما الذي يبقى بيدك؟<\/h1>/);
  assert.match(arHtml, /<a [^>]*href="\/blog\/ai-social-media-manager-small-business"[^>]*hrefLang="en"/i);
  assert.match(arHtml, /href="\/blog\/ai-social-media-management-small-business">دليل السوشيال ميديا<\/a>/);
  assert.match(arHtml, /واتساب وشراء إعلانات ميتا غير متاحين بعد\./);
  assert.match(arHtml, /لا يُنشر شيء قبل موافقتك\./);
});

test("sitemap, llms.txt, proxy, root-frame, route pages, and Caddy wire both /blog guides publicly", () => {
  const sitemapMod = loadTsModule("apps/dashboard/app/sitemap.ts");
  const entries = sitemapMod.default();
  const urls = entries.map((entry) => entry.url);
  const enUrl = `${CANONICAL_SITE_URL}/blog/ai-social-media-manager-small-business`;
  const arUrl = `${CANONICAL_SITE_URL}/blog/ai-social-media-management-small-business`;
  assert.ok(urls.includes(enUrl), "sitemap() missing EN blog URL");
  assert.ok(urls.includes(arUrl), "sitemap() missing AR blog URL");
  for (const url of [enUrl, arUrl]) {
    const entry = entries.find((item) => item.url === url);
    assert.ok(entry.lastModified instanceof Date);
    assert.deepEqual(entry.alternates?.languages, { en: enUrl, ar: arUrl });
  }

  const llmsSource = readFileSync(path.join(root, "apps/dashboard/app/llms.txt/route.ts"), "utf8");
  assert.match(llmsSource, /\/blog\/ai-social-media-manager-small-business/);
  assert.match(llmsSource, /\/blog\/ai-social-media-management-small-business/);

  const proxy = readFileSync(path.join(root, "apps/dashboard/proxy.ts"), "utf8");
  const frame = readFileSync(path.join(root, "apps/dashboard/components/root-frame.tsx"), "utf8");
  const caddyEntry = readFileSync(path.join(root, "deployment/dashboard-demo/caddy/entrypoint.sh"), "utf8");

  for (const route of [
    "/blog/ai-social-media-manager-small-business",
    "/blog/ai-social-media-management-small-business",
  ]) {
    assert.ok(proxy.includes(`"${route}"`), `proxy.ts missing ${route}`);
    assert.ok(frame.includes(`"${route}"`), `root-frame.tsx missing ${route}`);
    const pageSource = readFileSync(path.join(root, `apps/dashboard/app${route}/page.tsx`), "utf8");
    assert.match(pageSource, /export const dynamic = "force-dynamic"/);
    assert.match(pageSource, /buildBlogArticleMetadata/);
    assert.match(pageSource, /blogArticleJsonLd/);
  }

  assert.match(caddyEntry, /@marketingCanonical path \/pricing \/privacy \/terms \/blog \/blog\/\*/);
  assert.match(caddyEntry, /@marketingPublic path \/ \/pricing \/privacy \/terms \/blog \/blog\/\*/);
});
