import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale, localeInfo } from "../i18n";
import "../globals.css";

export default async function LocalizedLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "en") notFound();
  return <html lang={localeInfo[locale].lang} className="antialiased"><body>{children}</body></html>;
}
