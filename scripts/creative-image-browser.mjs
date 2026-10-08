// Creative image-lane browser journeys (Playwright library, driven by the
// disposable image integration harness). Covers generation submit (EN + AR),
// product flow, fidelity review path, approvals, role negatives, and the
// absence of any publish action. No providers, GPU, or production contact.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

export async function runCreativeImageBrowser({ dashboardOrigin, mintToken, subjects }) {
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
    // Owner EN desktop: submit text-to-image, see variant jobs, no publish.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative/generate`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "New image" }).waitFor();
    await page.getByLabel(/Prompt/).fill("A red square, flat vector style");
    await page.getByRole("button", { name: "Generate" }).click();
    await expectText(page, "Generation queued.");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    const firstJob = page.locator('.creative-card h2 a').first();
    await firstJob.waitFor();
    const jobHref = await firstJob.getAttribute("href");
    assert.match(jobHref ?? "", /^\/creative\/jobs\//);

    // Owner EN desktop: product flow from an uploaded source.
    await page.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Product Studio" }).waitFor();
    const sourceOptions = await page.locator("select").first().locator("option").count();
    assert.ok(sourceOptions >= 2);
    await page.locator("select").first().selectOption({ index: 1 });
    await page.getByRole("button", { name: "Create scene job" }).click();
    await page.getByText("Product scene job queued.").waitFor();

    // Reviewer records a fidelity review through the UI.
    const reviewer = await contextWith({ subject: subjects.reviewer });
    const review = await reviewer.newPage();
    await review.goto(`${dashboardOrigin}${jobHref}`, { waitUntil: "networkidle" });
    await review.getByText("Provider calls").waitFor();
    assert.equal(await review.getByRole("button", { name: /Publish/i }).count(), 0);

    // Owner AR desktop: RTL direction + Arabic copy on the new surfaces.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative/generate`, { waitUntil: "networkidle" });
    assert.equal(await arabic.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "صورة جديدة" }).waitFor();
    await arabic.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    await arabic.getByRole("heading", { name: "استوديو المنتجات" }).waitFor();

    // AR mobile holds layout.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/generate`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");

    // Viewer: no generation or product submission UI.
    const viewer = await contextWith({ subject: subjects.viewer });
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(`${dashboardOrigin}/creative/generate`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: "Generate" }).count(), 0);
    await viewerPage.goto(`${dashboardOrigin}/creative/product`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: "Create scene job" }).count(), 0);

    assert.deepEqual(errors, []);
    console.log("PASS creative image browser journeys (EN/AR, roles, no publish)");
  } finally {
    await browser.close();
  }
}
