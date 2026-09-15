import { sitePath } from "@/app/site-config";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { localeInfo, localizedPath, type WebsiteLocale, type SitePageName } from "./i18n";
import { catalogSection } from "./catalogs";
import { LanguageSwitcher } from "./language-switcher";

export type ResourcePage = "examples" | "guide" | "faq" | "changelog" | "support";

const githubUrl = "https://github.com/zhiqingchen/RunWhale";
const brandIconUrl = sitePath("/media/optimized/v1/runwhale-icon-128.webp");

const navigation = catalogSection("navigation");

export function ContentPage({
  locale = "en",
  page,
  privacyHref,
  eyebrow,
  title,
  summary,
  updated,
  updatedIso,
  activeResource,
  wide = false,
  children,
}: {
  locale?: WebsiteLocale;
  page: SitePageName;
  privacyHref?: string;
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  updatedIso: string;
  activeResource?: ResourcePage;
  wide?: boolean;
  children: ReactNode;
}) {
  const copy = navigation[locale];
  const homeHref = localizedPath(locale);
  const resources = [copy.links.examples, copy.links.guide, copy.links.faq, copy.links.changelog, copy.links.support] as const;

  return (
    <main className="content-page" lang={localeInfo[locale].lang}>
      <header className="content-nav shell">
        <Link href={homeHref} className="brand" aria-label={copy.homeAria}>
          <Image src={brandIconUrl} alt="" width={36} height={36} preload />
          <span>{copy.brand}</span>
        </Link>
        <div className="content-actions">
          <LanguageSwitcher locale={locale} page={page} />
          <Link href={homeHref} className="content-back">{copy.back}</Link>
        </div>
      </header>

      {activeResource ? (
        <div className="resource-nav-shell">
          <nav className="resource-nav shell" aria-label={copy.resourcesAria}>
            {resources.map((resource) => {
              const key = resource.href.split("/").at(-1) as ResourcePage;
              const current = key === activeResource;
              return (
                <Link
                  key={resource.href}
                  href={resource.href}
                  className={current ? "resource-link resource-link-active" : "resource-link"}
                  aria-current={current ? "page" : undefined}
                >
                  {resource.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}

      <article className={`content-document shell${wide ? " content-document-wide" : ""}`}>
        <header className="content-heading">
          <p className="content-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="content-summary">{summary}</p>
          <p className="content-updated">
            {copy.updatedPrefix}<time dateTime={updatedIso}>{updated}</time>
          </p>
        </header>
        <div className="content-body">{children}</div>
      </article>

      <footer className="content-footer shell">
        <p>{copy.copyright}</p>
        <nav aria-label={copy.footerAria}>
          <Link href={copy.links.examples.href}>{copy.links.examples.label}</Link>
          <Link href={copy.links.changelog.href}>{copy.links.changelog.label}</Link>
          <Link href={copy.links.guide.href}>{copy.links.guide.label}</Link>
          <Link href={copy.links.faq.href}>{copy.links.faq.label}</Link>
          <Link href={copy.links.support.href}>{copy.links.support.label}</Link>
          <Link href={privacyHref ?? copy.links.privacy.href}>{copy.links.privacy.label}</Link>
          <Link href={copy.links.terms.href}>{copy.links.terms.label}</Link>
          <LanguageSwitcher locale={locale} page={page} />
          <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </main>
  );
}
