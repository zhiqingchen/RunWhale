import { createElement, type ReactNode } from "react";
import Link from "next/link";
import { catalogs, type DocumentName, type DocumentNode } from "./catalogs";
import { ContentPage } from "./content-page";
import type { WebsiteLocale } from "./i18n";

// Render the maintained policy content as structured elements, without raw HTML.
function renderNode(node: DocumentNode, key = "body"): ReactNode {
  if (typeof node === "string" || node === null) return node;
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${key}-${index}`));
  const children = renderNode(node.children, key);
  if (node.tag === "a" && node.attrs.href?.startsWith("/")) {
    return <Link {...node.attrs} href={node.attrs.href} key={key}>{children}</Link>;
  }
  return createElement(node.tag, { ...node.attrs, key }, children);
}

export function DocumentPage({ locale, page }: { locale: WebsiteLocale; page: DocumentName }) {
  const copy = catalogs[locale].documents[page];
  return (
    <ContentPage
      locale={locale}
      page={page}
      eyebrow={copy.eyebrow}
      title={copy.title}
      summary={copy.summary}
      updated={copy.updated}
      updatedIso={copy.updatedIso}
      privacyHref={copy.privacyHref}
      activeResource={page === "support" ? "support" : undefined}
    >
      {renderNode(copy.body)}
    </ContentPage>
  );
}
