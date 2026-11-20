import { ImageResponse } from "next/og";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0d3b34 0%, #114f45 55%, #16302c 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            <div style={{ width: "19px", height: "19px", borderRadius: "4px", background: "#7ce3ce" }} />
            <div style={{ width: "19px", height: "19px", borderRadius: "4px", background: "#ffffff" }} />
            <div style={{ width: "19px", height: "19px", borderRadius: "4px", background: "#ffffff", opacity: 0.7 }} />
            <div style={{ width: "19px", height: "19px", borderRadius: "4px", background: "#f4b942" }} />
          </div>
          <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            E3lani
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "960px" }}>
          <div
            style={{
              fontSize: "60px",
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
            }}
          >
            Your AI marketing team. Nothing publishes until you approve it.
          </div>
          <div
            style={{
              fontSize: "28px",
              lineHeight: 1.4,
              color: "#cde6e0",
            }}
          >
            Plan, create, approve, publish, and measure in English and Arabic — flat workspace pricing from $15/mo.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(255,255,255,0.2)",
            paddingTop: "24px",
            fontSize: "22px",
            color: "#a7d5cb",
          }}
        >
          <span>Bilingual EN / AR RTL Workspace</span>
          <span>www.e3lani.online</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    },
  );
}
