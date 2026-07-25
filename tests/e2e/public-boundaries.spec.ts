import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("public production boundaries", () => {
  test("login page renders without browser errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto("/login");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Sign in · Tanaghom/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("protected Agent Studio route redirects an anonymous browser", async ({ page }) => {
    await page.goto("/settings/agents");

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("protected Agent Studio API rejects an anonymous request", async ({ request }) => {
    const response = await request.get("/api/admin/agents", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
  });

  test("public health reports authentication and database readiness", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      components: {
        api: "ready",
        authentication: "configured",
        database: "connected",
      },
    });
  });
});
