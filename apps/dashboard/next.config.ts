import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@tanaghom/agent-runtime"],
  turbopack: {
    root: resolve(process.cwd()),
  },
  async redirects() {
    return [
      {
        source: "/content-library",
        destination: "/content",
        permanent: true,
      },
      // Legacy paths customers still bookmark. Each one lands on the page that
      // owns the content today instead of a 404.
      { source: "/billing", destination: "/settings/billing", permanent: true },
      { source: "/sessions", destination: "/settings/security", permanent: true },
      { source: "/packs", destination: "/campaigns", permanent: true },
      { source: "/packs/:id", destination: "/workspace?id=:id", permanent: true },
    ];
  },
};

export default nextConfig;
