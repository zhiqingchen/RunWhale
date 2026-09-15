import { notFound } from "next/navigation";
import { locales, pages, isLocale, isPage } from "@/app/i18n";
import { pageMetadata } from "@/app/page-metadata";
import { SitePage } from "@/app/site-page";

type Params = { locale: string; slug?: string[] };
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return locales.filter((locale) => locale !== "en").flatMap((locale) =>
    pages.map((page) => ({ locale, slug: page ? page.split("/") : [] })),
  );
}

async function resolvePage(params: Promise<Params>) {
  const { locale, slug } = await params;
  const page = slug?.join("/") ?? "";
  if (!isLocale(locale) || locale === "en" || !isPage(page)) notFound();
  return { locale, page };
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { locale, page } = await resolvePage(params);
  return pageMetadata(locale, page);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  return <SitePage {...await resolvePage(params)} />;
}
