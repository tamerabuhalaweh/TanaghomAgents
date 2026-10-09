// Creative design browser journeys (Playwright library, driven by the
// disposable design integration harness). Covers designs list, detail with
// local-only preview, AR RTL, mobile, role negatives, and the absence of any
// publish action. Captures Chromium render evidence: double-render PNG
// determinism per corpus case plus a zero-external-request proof, printed as
// ledger lines. No providers, GPU, or production contact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

export async function runCreativeDesignBrowser({ dashboardOrigin, mintToken, subjects, designs }) {
  const browser = await chromium.launch();
  const errors = [];
  async function expectText(page, text) {
    try {
      await page.getByText(text).waitFor({ timeout: 15000 });
    } catch (error) {
      const notices = await page.locator(".creative-notice").allInnerTexts().catch(() => []);
      const errors = await page.locator(".creative-error").allInnerTexts().catch(() => []);
      throw new Error(`missing text ${JSON.stringify(text)}; notices=${JSON.stringify(notices)} errors=${JSON.stringify(errors)} cause=${error.message}`);
    }
  }
  async function contextWith({ subject, locale, viewport }) {
    const context = await browser.newContext(viewport ? { viewport } : {});
    context.on("pageerror", (error) => errors.push(error.message));
    await context.addCookies([
      { name: "tanaghom_access_token", value: await mintToken(subject), url: dashboardOrigin },
    ]);
    if (locale) {
      await context.addCookies([{ name: "tanaghom_locale", value: locale, url: dashboardOrigin }]);
    }
    return context;
  }
  try {
    // Owner EN desktop: designs list, open a global starter, pages render.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative/designs`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Designs" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    const firstDesign = page.locator(".creative-card h2 a").first();
    await firstDesign.waitFor();
    const designHref = await firstDesign.getAttribute("href");
    assert.match(designHref ?? "", /^\/creative\/designs\//);
    await page.goto(`${dashboardOrigin}${designHref}`, { waitUntil: "networkidle" });
    await expectText(page, "Renders run offline with no network access.");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);

    // Owner AR desktop: RTL direction + Arabic copy on the new surfaces.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative/designs`, { waitUntil: "networkidle" });
    assert.equal(await arabic.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "التصاميم" }).waitFor();

    // AR mobile holds layout.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/designs`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");

    // Viewer: designs list visible, no create or version submission UI.
    const viewer = await contextWith({ subject: subjects.viewer });
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(`${dashboardOrigin}/creative/designs`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: /New design|حفظ نسخة|تشغيل/ }).count(), 0);

    // Render evidence: seeded global starters through the preview route.
    // Each case renders twice; bytes must be identical (determinism), and no
    // request may leave the dashboard origin (local-only render proof).
    // Screenshots are CI artifacts for bounded human visual review of Arabic
    // shaping; the ledger lines below are the machine-readable record.
    const evidence = await contextWith({ subject: subjects.owner });
    for (const item of designs) {
      for (let slide = 1; slide <= item.pages; slide += 1) {
        const params = new URLSearchParams({ format: item.format, page: String(slide) });
        const url = `${dashboardOrigin}/api/creative/designs/${item.id}/preview?${params}`;
        const hashes = [];
        let external = 0;
        let bytes = 0;
        const started = Date.now();
        for (let pass = 0; pass < 2; pass += 1) {
          const evidencePage = await evidence.newPage();
          evidencePage.on("request", (request) => {
            if (!request.url().startsWith(dashboardOrigin)) external += 1;
          });
          const response = await evidencePage.goto(url, { waitUntil: "networkidle" });
          assert.equal(response?.status(), 200, `${item.case_id} slide ${slide}`);
          const shot = await evidencePage.screenshot({ fullPage: true });
          bytes = shot.length;
          hashes.push(createHash("sha256").update(shot).digest("hex"));
          await evidencePage.close();
        }
        assert.equal(hashes[0], hashes[1], `${item.case_id} slide ${slide} determinism`);
        assert.equal(external, 0, `${item.case_id} slide ${slide} external requests`);
        console.log(JSON.stringify({
          case_id: `${item.case_id}-p${slide}`, template: item.template, format: item.format,
          page: slide, output_sha256: hashes[0], bytes,
          latency_ms: Date.now() - started, result: "rendered",
        }));
      }
    }
    await evidence.close();
    assert.deepEqual(errors, []);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
}
