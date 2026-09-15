export const locales = ["en", "zh-CN", "es", "fr", "ja"] as const;
export type WebsiteLocale = (typeof locales)[number];

export const localeInfo = {
  en: { name: "English", lang: "en-US", og: "en_US", language: "Language" },
  "zh-CN": { name: "简体中文", lang: "zh-CN", og: "zh_CN", language: "语言" },
  es: { name: "Español", lang: "es", og: "es_ES", language: "Idioma" },
  fr: { name: "Français", lang: "fr", og: "fr_FR", language: "Langue" },
  ja: { name: "日本語", lang: "ja", og: "ja_JP", language: "言語" },
} as const;

export const pages = ["", "examples", "guide", "faq", "changelog", "support", "privacy", "commercial/privacy", "terms"] as const;
export type SitePageName = (typeof pages)[number];

export function isLocale(value: string): value is WebsiteLocale {
  return locales.some((locale) => locale === value);
}

export function isPage(value: string): value is SitePageName {
  return pages.some((page) => page === value);
}

export function localizedPath(locale: WebsiteLocale, page = ""): string {
  const path = page.replace(/^\//, "");
  return `${locale === "en" ? "" : `/${locale}`}${path ? `/${path}` : ""}` || "/";
}
