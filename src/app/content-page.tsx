import { sitePath } from "@/app/site-config";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { WebsiteLocale } from "./home-copy";

export type ResourcePage = "examples" | "guide" | "faq" | "changelog" | "support";

const githubUrl = "https://github.com/zhiqingchen/RunWhale";
const brandIconUrl = sitePath("/media/optimized/v1/runwhale-icon-128.webp");

const navigation = {
  en: {
    brand: "RunWhale",
    homeAria: "RunWhale home",
    back: "Back to home",
    languageLabel: "中文",
    languageCode: "zh-CN",
    resourcesAria: "RunWhale guides and support",
    footerAria: "Guides, legal, support, language, and project links",
    updatedPrefix: "Last updated: ",
    copyright: "© 2026 RunWhale.",
    links: {
      examples: { label: "Examples", href: "/examples" },
      changelog: { label: "Changelog", href: "/changelog" },
      guide: { label: "Guide", href: "/guide" },
      faq: { label: "FAQ", href: "/faq" },
      support: { label: "Support", href: "/support" },
      privacy: { label: "Privacy", href: "/privacy" },
    },
  },
  "zh-CN": {
    brand: "哪里跑",
    homeAria: "哪里跑首页",
    back: "返回首页",
    languageLabel: "EN",
    languageCode: "en-US",
    resourcesAria: "哪里跑教程与支持",
    footerAria: "教程、法律、支持、语言和项目链接",
    updatedPrefix: "最后更新：",
    copyright: "© 2026 哪里跑。",
    links: {
      examples: { label: "作品案例", href: "/zh-CN/examples" },
      changelog: { label: "更新日志", href: "/zh-CN/changelog" },
      guide: { label: "教程", href: "/zh-CN/guide" },
      faq: { label: "常见问题", href: "/zh-CN/faq" },
      support: { label: "支持", href: "/zh-CN/support" },
      privacy: { label: "隐私", href: "/zh-CN/privacy" },
    },
  },
} as const;

export function ContentPage({
  locale = "en",
  languageHref,
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
  languageHref: string;
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  updatedIso: string;
  activeResource?: ResourcePage;
  wide?: boolean;
  children: ReactNode;
}) {
  const isChinese = locale === "zh-CN";
  const copy = navigation[locale];
  const homeHref = isChinese ? "/zh-CN" : "/";
  const resources = [copy.links.examples, copy.links.guide, copy.links.faq, copy.links.changelog, copy.links.support] as const;

  return (
    <main className="content-page" lang={isChinese ? "zh-CN" : "en-US"}>
      <header className="content-nav shell">
        <Link href={homeHref} className="brand" aria-label={copy.homeAria}>
          <Image src={brandIconUrl} alt="" width={36} height={36} preload />
          <span>{copy.brand}</span>
        </Link>
        <div className="content-actions">
          <Link
            href={languageHref}
            hrefLang={copy.languageCode}
            className="language-link"
          >
            {copy.languageLabel}
          </Link>
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
          <Link href={copy.links.privacy.href}>{copy.links.privacy.label}</Link>
          <Link href={languageHref} hrefLang={copy.languageCode}>{copy.languageLabel}</Link>
          <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </main>
  );
}
