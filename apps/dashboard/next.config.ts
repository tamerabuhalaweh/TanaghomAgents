import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@tanaghom/agent-runtime"],
  turbopack: {
    root: resolve(process.cwd()),
  },
};

export default nextConfig;
