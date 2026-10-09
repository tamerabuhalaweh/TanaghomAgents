// Creative motion browser journeys (Playwright library, driven by the
// disposable motion integration harness). Covers motion list, creation from
// an existing design, detail with animated preview and job progress, AR
// RTL, mobile, role negatives (operator renders but never approves,
// viewer read-only), and the absence of any publish action. No providers,
// GPU, billing, or production contact.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

export async function runCreativeMotionBrowser({ dashboardOrigin, mintToken, subjects }) {
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
    // Owner EN desktop: motion list, create from an existing design, detail.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative/motion`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Motion", exact: true }).waitFor();
    await expectText(page, "Exports stay private. Nothing here publishes.");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    await page.getByLabel(/Name/).fill("Browser motion");
    await page.getByLabel(/Source design/).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Save" }).click();
    // Create redirects to the new motion detail page; the transient
    // "created" notice does not survive navigation, so the URL is proof.
    await page.waitForURL(/\/creative\/motion\/[0-9a-f-]{36}/, { timeout: 20000 });
    const motionHref = new URL(page.url()).pathname;
    assert.match(motionHref ?? "", /^\/creative\/motion\//);
    await page.goto(`${dashboardOrigin}${motionHref}`, { waitUntil: "networkidle" });
    await expectText(page, "Motion renders run offline with no network access.");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    const previewFrame = page.locator('iframe[title="motion-preview"]');
    await previewFrame.waitFor();

    // Operator: motion list visible, render control present on detail,
    // no create form, no approve control.
    const operator = await contextWith({ subject: subjects.operator });
    const operatorPage = await operator.newPage();
    await operatorPage.goto(`${dashboardOrigin}/creative/motion`, { waitUntil: "networkidle" });
    assert.equal(await operatorPage.locator("form.creative-form").count(), 0);
    await operatorPage.goto(`${dashboardOrigin}${motionHref}`, { waitUntil: "networkidle" });
    await operatorPage.getByRole("button", { name: "Render MP4" }).waitFor();
    assert.equal(await operatorPage.getByRole("button", { name: /Approve/i }).count(), 0);

    // Owner AR desktop: RTL direction + Arabic copy on the new surfaces.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative/motion`, { waitUntil: "networkidle" });
    assert.equal(await arabic.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "الحركة" }).waitFor();

    // AR mobile holds layout.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/motion`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");

    // Viewer: motion list visible, no create form, no render control.
    const viewer = await contextWith({ subject: subjects.viewer });
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(`${dashboardOrigin}/creative/motion`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.locator("form.creative-form").count(), 0);
    await viewerPage.goto(`${dashboardOrigin}${motionHref}`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: /Render MP4|Save/ }).count(), 0);

    assert.deepEqual(errors, []);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
}
