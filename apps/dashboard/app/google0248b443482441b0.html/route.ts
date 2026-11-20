const VERIFICATION_BODY = "google-site-verification: google0248b443482441b0.html";

export function GET() {
  return new Response(VERIFICATION_BODY, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
