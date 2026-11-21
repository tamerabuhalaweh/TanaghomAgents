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
    ];
  },
};

export default nextConfig;
