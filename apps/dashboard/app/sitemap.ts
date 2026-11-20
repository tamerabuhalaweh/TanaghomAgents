import type { MetadataRoute } from "next";

import { canonicalUrlFor } from "@/lib/seo";

const LAST_MODIFIED = new Date("2026-11-20T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: canonicalUrlFor("/"),
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: canonicalUrlFor("/pricing"),
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: canonicalUrlFor("/privacy"),
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: canonicalUrlFor("/terms"),
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
