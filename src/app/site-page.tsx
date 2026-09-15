import { HomePage } from "./home-page";
import { GuidePage } from "./guide-page";
import { FaqPage } from "./faq-page";
import { ExamplesPage } from "./examples-page";
import { ChangelogPage } from "./changelog-page";
import { DocumentPage } from "./document-page";
import type { WebsiteLocale, SitePageName } from "./i18n";

export function SitePage({ locale, page }: { locale: WebsiteLocale; page: SitePageName }) {
  switch (page) {
    case "": return <HomePage locale={locale} />;
    case "guide": return <GuidePage locale={locale} />;
    case "faq": return <FaqPage locale={locale} />;
    case "examples": return <ExamplesPage locale={locale} />;
    case "changelog": return <ChangelogPage locale={locale} />;
    default: return <DocumentPage locale={locale} page={page} />;
  }
}
