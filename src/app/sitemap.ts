import { siteUrl } from "@/app/site-config";
import type { MetadataRoute } from "next";

const languageAlternates = (englishPath: string, chinesePath: string) => ({
  languages: {
    "en-US": `${siteUrl}${englishPath}`,
    "zh-CN": `${siteUrl}${chinesePath}`,
  },
});

const workflowImages = [
  `${siteUrl}/media/optimized/v1/01-create-baby-game-720.webp`,
  `${siteUrl}/media/optimized/v1/02-prompt-and-agent-plan-720.webp`,
  `${siteUrl}/media/optimized/v1/03-approve-file-write-720.webp`,
  `${siteUrl}/media/optimized/v1/04-checks-before-preview-720.webp`,
  `${siteUrl}/media/optimized/v1/05-animal-parade-preview-720.webp`,
  `${siteUrl}/media/optimized/v1/06-interaction-feedback-720.webp`,
];

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      images: workflowImages,
      alternates: languageAlternates("/", "/zh-CN"),
    },
    {
      url: `${siteUrl}/zh-CN`,
      alternates: languageAlternates("/", "/zh-CN"),
    },
    {
      url: `${siteUrl}/examples`,
      images: [workflowImages[4], `${siteUrl}/media/optimized/v1/05-see-features-come-to-life-framed-720.webp`],
      alternates: languageAlternates("/examples", "/zh-CN/examples"),
    },
    {
      url: `${siteUrl}/zh-CN/examples`,
      alternates: languageAlternates("/examples", "/zh-CN/examples"),
    },
    {
      url: `${siteUrl}/changelog`,
      lastModified: "2026-09-05",
      alternates: languageAlternates("/changelog", "/zh-CN/changelog"),
    },
    {
      url: `${siteUrl}/zh-CN/changelog`,
      lastModified: "2026-09-05",
      alternates: languageAlternates("/changelog", "/zh-CN/changelog"),
    },
    {
      url: `${siteUrl}/guide`,
      images: workflowImages,
      alternates: languageAlternates("/guide", "/zh-CN/guide"),
    },
    {
      url: `${siteUrl}/zh-CN/guide`,
      images: workflowImages,
      alternates: languageAlternates("/guide", "/zh-CN/guide"),
    },
    {
      url: `${siteUrl}/faq`,
      alternates: languageAlternates("/faq", "/zh-CN/faq"),
    },
    {
      url: `${siteUrl}/zh-CN/faq`,
      alternates: languageAlternates("/faq", "/zh-CN/faq"),
    },
    {
      url: `${siteUrl}/privacy`,
      alternates: languageAlternates("/privacy", "/zh-CN/privacy"),
    },
    {
      url: `${siteUrl}/zh-CN/privacy`,
      alternates: languageAlternates("/privacy", "/zh-CN/privacy"),
    },
    {
      url: `${siteUrl}/support`,
      alternates: languageAlternates("/support", "/zh-CN/support"),
    },
    {
      url: `${siteUrl}/zh-CN/support`,
      alternates: languageAlternates("/support", "/zh-CN/support"),
    },
  ];
}
