import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AppNavLink, PublicFooter, PublicHeader } from "@/components/public-pages";
import { BLOG_ARTICLES, type BlogArticleSlug, type BlogBlock } from "@/lib/blog-articles";

function ArticleBlock({ block }: { block: BlogBlock }) {
  if (block.type === "p") return <p>{block.text}</p>;
  const ListTag = block.type === "ol" ? "ol" : "ul";
  return (
    <ListTag>
      {block.items.map((item) => (
        <li key={item.lead}>
          <strong>{item.lead}</strong> {item.text}
        </li>
      ))}
    </ListTag>
  );
}

/** Public SEO/GEO article page rendered inside the public shell (never AppShell). */
export function PublicBlogArticlePage({
  slug,
  appOrigin = "",
}: {
  slug: BlogArticleSlug;
  appOrigin?: string;
}) {
  const article = BLOG_ARTICLES[slug];
  const alternate = BLOG_ARTICLES[article.alternateSlug];

  return (
    <main className="public-page" dir={article.dir} lang={article.locale}>
      <PublicHeader locale={article.locale} appOrigin={appOrigin} alternateHref={alternate.path} />

      <article className="public-document public-article">
        <div className="public-article-meta">
          <p className="public-eyebrow">{article.eyebrow}</p>
          <Link
            className="public-article-alt"
            href={alternate.path}
            hrefLang={alternate.locale}
            dir={alternate.dir}
          >
            {article.alternateLabel}
          </Link>
        </div>

        <h1>{article.h1}</h1>

        {article.intro.map((paragraph, index) => (
          <p key={paragraph} className={index === 0 ? "public-document-lede" : undefined}>
            {paragraph}
          </p>
        ))}

        {article.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <ArticleBlock key={`${section.heading}-${index}`} block={block} />
            ))}
          </section>
        ))}

        <section id="faq" className="public-article-faq" aria-labelledby="blog-faq-heading">
          <h2 id="blog-faq-heading">{article.faqHeading}</h2>
          {article.faqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </section>

        <p className="public-document-note">
          <em>{article.publisherNote}</em>
        </p>
        <p className="public-article-switch">
          <Link
            className="public-article-alt"
            href={alternate.path}
            hrefLang={alternate.locale}
            dir={alternate.dir}
          >
            {article.alternateLabel}
          </Link>
        </p>
      </article>

      <section className="public-cta">
        <div>
          <h2>{article.cta.heading}</h2>
          <p>{article.cta.body}</p>
        </div>
        <div className="public-cta-actions">
          <AppNavLink appOrigin={appOrigin} className="public-button" path="/signup">
            {article.cta.primaryLabel}
            <ArrowRight size={17} />
          </AppNavLink>
          <Link className="public-cta-link" href="/pricing">
            {article.cta.secondaryLabel}
          </Link>
        </div>
      </section>

      <PublicFooter locale={article.locale} appOrigin={appOrigin} />
    </main>
  );
}
