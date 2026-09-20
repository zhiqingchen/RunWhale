import type { MetadataRoute } from "next";
import { siteUrl } from "./site-config";
import { locales, pages, localizedPath } from "./i18n";
import { languageAlternates } from "./page-metadata";

const workflowImages = [
  "01-create-baby-game", "02-prompt-and-agent-plan", "03-approve-file-write",
  "04-checks-before-preview", "05-animal-parade-preview", "06-interaction-feedback",
].map((name) => `${siteUrl}/media/optimized/v1/${name}-720.webp`);

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.flatMap((page) => locales.map((locale) => ({
    url: `${siteUrl}${localizedPath(locale, page)}`,
    lastModified: page === "" ? "2026-09-20" : "2026-09-15",
    alternates: { languages: languageAlternates(page) },
    images: page === ""
      ? [`${siteUrl}/media/demo/runwhale-duo-pelican-quickstart-poster.webp`, ...workflowImages]
      : page === "guide" ? workflowImages : page === "examples"
      ? [workflowImages[4], `${siteUrl}/media/optimized/v1/05-see-features-come-to-life-framed-720.webp`]
      : undefined,
  })));
}
