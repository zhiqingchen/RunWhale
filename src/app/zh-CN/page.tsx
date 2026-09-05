import { siteUrl } from "@/app/site-config";
import type { Metadata } from "next";
import { HomePage } from "../home-page";
import { indexableRobots } from "../seo-metadata";

const title = "哪里跑——手机上的 AI 编程智能体与开发工作区";
const description =
  "哪里跑把 AI 编程智能体与设备本地工作区带到手机上，支持兼容的 Web 和 Expo 项目、代码检查、Git 审查以及 React Native 预览。";
const socialImage = {
  url: `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`,
  width: 1200,
  height: 630,
  alt: "哪里跑——手机上的 AI 编程智能体与开发工作区",
};

export const metadata: Metadata = {
  title,
  description,
  robots: indexableRobots,
  alternates: {
    canonical: `${siteUrl}/zh-CN`,
    languages: {
      "en-US": `${siteUrl}/`,
      "zh-CN": `${siteUrl}/zh-CN`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/zh-CN`,
    siteName: "哪里跑",
    locale: "zh_CN",
    type: "website",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function ChineseHomePage() {
  return <HomePage locale="zh-CN" />;
}
