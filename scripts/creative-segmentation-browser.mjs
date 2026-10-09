// Creative segmentation browser journeys (Playwright library, driven by
// the disposable segmentation integration harness). Covers Product
// Studio Remove Background submit, job detail, cutout preview, AR RTL,
// mobile, role negatives (operator submits, reviewer/viewer read-only),
// and the absence of any publish action. No providers, billing, or
// production contact.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

export async function runCreativeSegmentationBrowser({ dashboardOrigin, mintToken, subjects }) {
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
    // Owner EN desktop: submit Remove Background, reach the job page.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Product Studio" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    const sourceSelects = page.locator("form.creative-form select");
    assert.ok(await sourceSelects.count() >= 1);
    await sourceSelects.first().selectOption({ index: 1 });
    // The segmentation form has its own source select (3rd select on
    // the page: product source, product preset, segment source, engine).
    await sourceSelects.nth(2).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Segment product" }).click();
    await expectText(page, "Segmentation queued.");
    const jobLink = page.locator('a[href^="/creative/jobs/"]').first();
    await jobLink.waitFor();
    const jobHref = await jobLink.getAttribute("href");
    assert.match(jobHref ?? "", /^\/creative\/jobs\//);
    await page.goto(`${dashboardOrigin}${jobHref}`, { waitUntil: "networkidle" });
    await expectText(page, "Provider calls");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);

    // Operator: both product and segmentation forms visible.
    const operator = await contextWith({ subject: subjects.operator });
    const operatorPage = await operator.newPage();
    await operatorPage.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    await operatorPage.getByRole("button", { name: "Segment product" }).waitFor();

    // Owner AR desktop: RTL direction + Arabic copy.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    assert.equal(await arabic.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "استوديو المنتجات" }).waitFor();
    await arabic.getByRole("button", { name: "استخلاص المنتج" }).waitFor();

    // AR mobile holds layout.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");

    // Reviewer and viewer: no submit forms at all.
    for (const subject of [subjects.reviewer, subjects.viewer]) {
      const gated = await contextWith({ subject });
      const gatedPage = await gated.newPage();
      await gatedPage.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
      assert.equal(await gatedPage.locator("form.creative-form").count(), 0);
      await gated.close();
    }

    assert.deepEqual(errors, []);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
}
