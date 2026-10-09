// Creative video browser journeys (Playwright library, driven by the
// disposable video integration harness). Covers t2v submit with estimate,
// i2v mode, job detail with provider progress, AR RTL, mobile, role
// negatives (operator submits, reviewer/viewer read-only), and the
// absence of any publish action. No providers, billing, or production.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

export async function runCreativeVideoBrowser({ dashboardOrigin, mintToken, subjects }) {
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
    // Owner EN desktop: submit text-to-video, see estimate, reach job page.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "New video", exact: true }).waitFor();
    await expectText(page, "Estimate only");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);
    await page.getByLabel(/Prompt/).fill("A falcon over dunes at dawn, slow push in");
    await page.getByRole("button", { name: "Generate" }).click();
    // Submit redirects to the new job page; the transient notice does not
    // survive navigation, so the URL is proof.
    await page.waitForURL(/\/creative\/jobs\/[0-9a-f-]{36}/, { timeout: 20000 });
    const jobHref = new URL(page.url()).pathname;
    assert.match(jobHref ?? "", /^\/creative\/jobs\//);
    await page.goto(`${dashboardOrigin}${jobHref}`, { waitUntil: "networkidle" });
    await expectText(page, "Provider calls");
    assert.equal(await page.getByRole("button", { name: /Publish/i }).count(), 0);

    // Owner EN desktop: image-to-video mode reveals the source field.
    await page.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
    await page.getByLabel(/Mode/).selectOption("image_to_video");
    await page.getByLabel(/Source image version/).waitFor();

    // Operator: submit form visible (owner+operator may submit).
    const operator = await contextWith({ subject: subjects.operator });
    const operatorPage = await operator.newPage();
    await operatorPage.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
    await operatorPage.getByRole("button", { name: "Generate" }).waitFor();
    assert.equal(await operatorPage.getByRole("button", { name: /Publish/i }).count(), 0);

    // Owner AR desktop: RTL direction + Arabic copy.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
    assert.equal(await arabic.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "فيديو جديد" }).waitFor();

    // AR mobile holds layout.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");

    // Reviewer and viewer: video list visible, no submit form.
    for (const subject of [subjects.reviewer, subjects.viewer]) {
      const gated = await contextWith({ subject });
      const gatedPage = await gated.newPage();
      await gatedPage.goto(`${dashboardOrigin}/creative/video`, { waitUntil: "networkidle" });
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
