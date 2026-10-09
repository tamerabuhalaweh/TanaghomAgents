// Offline Chromium capture for the deterministic design renderer (P2b).
// The caller injects a Playwright-compatible `chromium` launcher so this
// module stays dependency-free and unit-testable with fakes. Network is
// actively blocked, not merely observed: every routed request is aborted,
// JavaScript is disabled, and the only legitimate content is the
// self-contained HTML supplied by the caller (data-URI fonts/images,
// inline styles). Data/blob/about resources never traverse the network
// stack, so aborting all routed requests cannot break a valid render.
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024;

function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("capture_dimensions_required");
  }
  if (width !== 1080 || ![1080, 1350, 1920].includes(height)) {
    throw new Error("capture_dimensions_unsupported");
  }
}

export async function capturePng({ chromium, html, width, height, timeoutMs = 30000, launchArgs = [] }) {
  assertDimensions(width, height);
  if (typeof html !== "string" || html.length === 0) throw new Error("capture_html_required");
  if (!chromium || typeof chromium.launch !== "function") throw new Error("capture_launcher_required");
  let attemptedExternal = 0;
  let blockedExternal = 0;
  const browser = await chromium.launch({ args: [...launchArgs] });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
    });
    // Enforcement, not observation: abort everything routable. Valid design
    // HTML issues zero network requests; anything else is blocked here.
    await context.route("**/*", async (route) => {
      attemptedExternal += 1;
      blockedExternal += 1;
      await route.abort();
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    const shot = await page.screenshot({ type: "png", timeout: timeoutMs });
    const bytes = Buffer.from(shot);
    if (bytes.length > MAX_CAPTURE_BYTES) throw new Error("capture_output_too_large");
    await context.close();
    return { bytes, width, height, attemptedExternal, blockedExternal };
  } finally {
    await browser.close();
  }
}
