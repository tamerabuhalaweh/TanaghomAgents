import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "@/lib/markdown";

function renderInline(nodes: MarkdownInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "strong":
        return <strong key={index}>{node.value}</strong>;
      case "em":
        return <em key={index}>{node.value}</em>;
      case "strong_em":
        return <strong key={index}><em>{node.value}</em></strong>;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            rel="noreferrer"
            target={/^https?:/i.test(node.href) ? "_blank" : undefined}
          >
            {node.value}
          </a>
        );
      default:
        return <Fragment key={index}>{node.value}</Fragment>;
    }
  });
}

function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${Math.min(Math.max(block.level, 1), 6)}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderInline(block.inline)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.inline)}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key}>
          {block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}
        </Tag>
      );
    }
    case "quote":
      return <blockquote key={key}>{renderInline(block.inline)}</blockquote>;
    case "code":
      return <pre key={key}><code>{block.value}</code></pre>;
    case "rule":
      return <hr key={key} />;
    default:
      return null;
  }
}

export function FormattedText({
  text,
  className,
  dir,
  lang,
}: {
  text: string;
  className?: string;
  dir?: "auto" | "ltr" | "rtl";
  lang?: string;
}) {
  const blocks = parseMarkdown(text);
  if (!blocks.length) return null;
  return (
    <div className={`formatted-text${className ? ` ${className}` : ""}`} dir={dir} lang={lang}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
