"use client";

import { Globe2 } from "lucide-react";
import { locales, localeInfo, localizedPath, type WebsiteLocale, type SitePageName } from "./i18n";
import { sitePath } from "./site-config";

export function LanguageSwitcher({ locale, page }: { locale: WebsiteLocale; page: SitePageName }) {
  return (
    <label className="language-switcher">
      <Globe2 size={16} aria-hidden="true" />
      <select
        aria-label={localeInfo[locale].language}
        value={locale}
        onChange={(event) => {
          const next = event.target.value as WebsiteLocale;
          window.location.assign(sitePath(localizedPath(next, page)) + window.location.hash);
        }}
      >
        {locales.map((value) => (
          <option key={value} value={value} lang={localeInfo[value].lang}>{localeInfo[value].name}</option>
        ))}
      </select>
    </label>
  );
}
