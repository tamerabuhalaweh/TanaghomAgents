import { expect, test } from "@playwright/test";

// Runs only against a disposable or test deployment with an owner/operator storage state.
test.skip(!process.env.PLAYWRIGHT_STORAGE_STATE, "requires PLAYWRIGHT_STORAGE_STATE for an owner or operator test account");

test("overview create-campaign entry opens the campaign draft form", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText(/Phase [0-9]/)).toHaveCount(0);
  const entry = page.getByTestId("overview-create-campaign-link");
  await expect(entry).toBeEnabled();
  await entry.click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByRole("heading", { name: "Create campaign draft" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
