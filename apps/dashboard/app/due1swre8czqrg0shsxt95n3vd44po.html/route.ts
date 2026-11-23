const VERIFICATION_BODY = "due1swre8czqrg0shsxt95n3vd44po";

export function GET() {
  return new Response(VERIFICATION_BODY, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
