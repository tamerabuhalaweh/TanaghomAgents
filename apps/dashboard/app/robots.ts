import type { MetadataRoute } from "next";

import { CANONICAL_SITE_URL, DISALLOWED_CRAWL_PATHS } from "@/lib/seo";

const AI_AND_SEARCH_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Googlebot",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  const disallow = [...DISALLOWED_CRAWL_PATHS];
  return {
    rules: [
      {
        userAgent: AI_AND_SEARCH_CRAWLERS,
        allow: "/",
        disallow,
      },
      {
        userAgent: "*",
        disallow,
      },
    ],
    sitemap: `${CANONICAL_SITE_URL}/sitemap.xml`,
  };
}
