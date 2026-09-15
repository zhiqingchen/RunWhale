import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import { locales, type WebsiteLocale } from "./i18n";
import { sitePath } from "./site-config";

export type DocumentName = "privacy" | "commercial/privacy" | "terms" | "support";
export type DocumentNode = string | null | DocumentNode[] | {
  tag: string;
  attrs: Record<string, string | undefined>;
  children: DocumentNode;
};
export interface DocumentCopy {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  updatedIso: string;
  metadataTitle: string;
  metadataDescription: string;
  privacyHref?: string;
  body: DocumentNode;
}
export type Catalog = Omit<typeof en, "documents"> & { documents: Record<DocumentName, DocumentCopy> };

// Assets are shared across languages; support the GitHub project-site base path.
function withAssetPaths<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\/media\/[^,\s]+/g, (path) => sitePath(path)) as T;
  if (Array.isArray(value)) return value.map(withAssetPaths) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withAssetPaths(item)])) as T;
  }
  return value;
}

export const catalogs: Record<WebsiteLocale, Catalog> = withAssetPaths({ en, "zh-CN": zh, es, fr, ja });
export function catalogSection<K extends keyof Catalog>(section: K): Record<WebsiteLocale, Catalog[K]> {
  return Object.fromEntries(locales.map((locale) => [locale, catalogs[locale][section]])) as Record<WebsiteLocale, Catalog[K]>;
}
