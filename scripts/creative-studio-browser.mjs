// Creative Studio browser journeys (Playwright library, driven by the
// disposable integration harness). No providers, GPU, or production contact.
// Authenticated via minted RS256 session cookies; the stub JWKS server from
// the parent harness backs verification.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// 1x1 transparent PNG fixture (~70 bytes). Real magic bytes, sharp-parseable.
export const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export async function runCreativeStudioBrowser({ dashboardOrigin, mintToken, subjects }) {
  const browser = await chromium.launch();
  const errors = [];
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
    // Owner EN desktop: full journey through the UI.
    const owner = await contextWith({ subject: subjects.owner });
    const page = await owner.newPage();
    await page.goto(`${dashboardOrigin}/creative`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Creative Studio" }).waitFor();
    await page.goto(`${dashboardOrigin}/creative/brand-kits`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Brand Kits" }).waitFor();
    const kitName = `Browser Kit ${Date.now()}`;
    await page.getByLabel(/Name/).fill(kitName);
    await page.getByRole("button", { name: "Save" }).first().click();
    await page.getByText("Brand kit created.").waitFor();
    const kitLink = page.getByRole("link", { name: kitName });
    await kitLink.waitFor();
    const kitHref = await kitLink.getAttribute("href");

    await page.goto(`${dashboardOrigin}/creative/templates`, { waitUntil: "networkidle" });
    const templateName = `browser-tpl-${Date.now()}`;
    await page.getByLabel(/Name/).fill(templateName);
    await page.getByLabel(/Spec/).fill('{"headline":"Browser"}');
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Template created.").waitFor();

    await page.goto(`${dashboardOrigin}/creative/assets`, { waitUntil: "networkidle" });
    await page.getByLabel(/Image file/).setInputFiles({
      name: "browser.png",
      mimeType: "image/png",
      buffer: Buffer.from(FIXTURE_PNG_BASE64, "base64"),
    });
    await page.getByLabel(/Title/).fill("صورة اختبار 123");
    await page.getByRole("button", { name: "Upload" }).click();
    await page.getByText("Uploaded and registered.").waitFor();
    const assetLink = page.getByRole("link", { name: "صورة اختبار 123" });
    await assetLink.waitFor();
    const assetHref = await assetLink.getAttribute("href");

    // Reviewer approves through the UI.
    const reviewer = await contextWith({ subject: subjects.reviewer });
    const review = await reviewer.newPage();
    await review.goto(`${dashboardOrigin}${assetHref}`, { waitUntil: "networkidle" });
    await review.getByRole("button", { name: "Approve" }).first().click();
    await review.getByText("Decision recorded.").waitFor();
    await review.getByText("approved").first().waitFor();

    // Owner AR desktop: RTL direction + Arabic copy.
    const ownerAr = await contextWith({ subject: subjects.owner, locale: "ar" });
    const arabic = await ownerAr.newPage();
    await arabic.goto(`${dashboardOrigin}/creative`, { waitUntil: "networkidle" });
    const studio = arabic.locator(".creative-page").first();
    await studio.waitFor();
    assert.equal(await studio.getAttribute("dir"), "rtl");
    await arabic.getByRole("heading", { name: "استوديو الإبداع" }).waitFor();

    // Owner AR mobile: layout holds on a small viewport.
    const mobile = await contextWith({
      subject: subjects.owner, locale: "ar", viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${dashboardOrigin}/creative/assets`, { waitUntil: "networkidle" });
    assert.equal(await mobilePage.locator(".creative-page").first().getAttribute("dir"), "rtl");
    await mobilePage.getByRole("heading", { name: "الأصول" }).waitFor();

    // Viewer: read-only, no mutations visible.
    const viewer = await contextWith({ subject: subjects.viewer });
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(`${dashboardOrigin}/creative/brand-kits`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: "Save" }).count(), 0);
    await viewerPage.goto(`${dashboardOrigin}/creative/assets`, { waitUntil: "networkidle" });
    assert.equal(await viewerPage.getByRole("button", { name: "Upload" }).count(), 0);

    // Operator: uploads allowed, review actions hidden.
    const operator = await contextWith({ subject: subjects.operator });
    const operatorPage = await operator.newPage();
    await operatorPage.goto(`${dashboardOrigin}/creative/assets`, { waitUntil: "networkidle" });
    await operatorPage.getByRole("button", { name: "Upload" }).waitFor();
    await operatorPage.goto(`${dashboardOrigin}${assetHref}`, { waitUntil: "networkidle" });
    assert.equal(await operatorPage.getByRole("button", { name: "Approve" }).count(), 0);
    assert.equal(await operatorPage.getByRole("button", { name: "Reject" }).count(), 0);

    // Reviewer: reviews allowed, brand/template administration hidden.
    await review.goto(`${dashboardOrigin}/creative/brand-kits`, { waitUntil: "networkidle" });
    assert.equal(await review.getByRole("button", { name: "Save" }).count(), 0);
    void kitHref;
    assert.deepEqual(errors, []);
    console.log("PASS creative studio browser journeys (EN/AR, desktop/mobile, roles)");
  } finally {
    await browser.close();
  }
}
