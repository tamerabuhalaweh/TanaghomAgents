import type { Metadata } from "next";

import { PublicBlogArticlePage } from "@/components/public-blog-page";
import { blogArticleJsonLd, buildBlogArticleMetadata } from "@/lib/blog-articles";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";
import { serializeJsonLd } from "@/lib/seo";

const SLUG = "ai-social-media-manager-small-business" as const;

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildBlogArticleMetadata(SLUG);

export default function EnglishSocialMediaManagerArticlePage() {
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(blogArticleJsonLd(SLUG)) }}
      />
      <PublicBlogArticlePage slug={SLUG} appOrigin={appOrigin} />
    </>
  );
}
