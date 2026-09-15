import type { Metadata } from "next";
import { catalogs } from "./catalogs";
import { localeInfo, locales, localizedPath, type WebsiteLocale, type SitePageName } from "./i18n";
import { siteUrl } from "./site-config";
import { indexableRobots } from "./seo-metadata";

export function languageAlternates(page: SitePageName) {
  return Object.fromEntries([
    ...locales.map((locale) => [localeInfo[locale].lang, `${siteUrl}${localizedPath(locale, page)}`]),
    ["x-default", `${siteUrl}${localizedPath("en", page)}`],
  ]);
}

export function pageMetadata(locale: WebsiteLocale, page: SitePageName): Metadata {
  const copy = catalogs[locale];
  let title: string;
  let description: string;
  if (page === "examples" || page === "changelog") {
    const kind = page === "examples" ? "examples" : "updates";
    title = `${copy.home.brand} — ${copy.discover[`${kind}Label`]}`;
    description = copy.discover[kind].summary;
  } else {
    const content = page === "" ? copy.home : page === "guide" || page === "faq" ? copy.help[page] : copy.documents[page];
    title = content.metadataTitle;
    description = content.metadataDescription;
  }
  const url = `${siteUrl}${localizedPath(locale, page)}`;
  const image = { url: `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`, width: 1200, height: 630, alt: copy.home.metadataTitle };
  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    robots: indexableRobots,
    alternates: { canonical: url, languages: languageAlternates(page) },
    openGraph: {
      title, description, url, siteName: copy.home.brand, type: "website",
      locale: localeInfo[locale].og,
      alternateLocale: locales.filter((value) => value !== locale).map((value) => localeInfo[value].og),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
