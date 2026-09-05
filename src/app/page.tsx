import { siteUrl } from "@/app/site-config";
import type { Metadata } from "next";
import { HomePage } from "./home-page";
import { indexableRobots } from "./seo-metadata";

export const metadata: Metadata = {
  robots: indexableRobots,
  alternates: {
    canonical: `${siteUrl}/`,
    languages: {
      "en-US": `${siteUrl}/`,
      "zh-CN": `${siteUrl}/zh-CN`,
    },
  },
};

export default function Home() {
  return <HomePage locale="en" />;
}
