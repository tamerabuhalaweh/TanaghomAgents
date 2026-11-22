import type { MetadataRoute } from "next";

import { canonicalUrlFor } from "@/lib/seo";

const LAST_MODIFIED = new Date("2026-11-20T00:00:00.000Z");
const BLOG_LAST_MODIFIED = new Date("2026-11-21T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const enGuideUrl = canonicalUrlFor("/blog/ai-social-media-manager-small-business");
  const arGuideUrl = canonicalUrlFor("/blog/ai-social-media-management-small-business");

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
      url: enGuideUrl,
      lastModified: BLOG_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.8,
      alternates: {
        languages: {
          en: enGuideUrl,
          ar: arGuideUrl,
        },
      },
    },
    {
      url: arGuideUrl,
      lastModified: BLOG_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.8,
      alternates: {
        languages: {
          en: enGuideUrl,
          ar: arGuideUrl,
        },
      },
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
