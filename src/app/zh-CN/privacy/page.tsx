import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { ContentPage } from "../../content-page";
import { indexableRobots } from "../../seo-metadata";

const title = "哪里跑隐私政策——应用与网站数据";
const description =
  "哪里跑隐私政策：了解哪些数据留在设备上、哪些数据会发送给模型服务商和 Git 托管服务，以及 本网站的托管方式。";
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
    canonical: `${siteUrl}/zh-CN/privacy`,
    languages: {
      "en-US": `${siteUrl}/privacy`,
      "zh-CN": `${siteUrl}/zh-CN/privacy`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/zh-CN/privacy`,
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

export default function ChinesePrivacyPage() {
  return (
    <ContentPage
      locale="zh-CN"
      languageHref="/privacy"
      eyebrow="隐私"
      title="隐私政策"
      summary="哪里跑以本地运行作为设计原则。本政策说明哪些数据会留在设备上、使用联网服务时哪些数据会离开设备，以及网站的托管方式。"
      updated="2026 年 9 月 5 日"
      updatedIso="2026-09-05"
    >
      <section>
        <h2>适用范围</h2>
        <p>本政策适用于哪里跑移动应用和 本网站，但不能替代你选择连接的模型服务商、Git 托管服务、软件包注册表或其他服务各自的隐私政策。</p>
      </section>

      <section>
        <h2>应用处理的信息</h2>
        <p>哪里跑会将项目、Git 历史、智能体会话、附件、偏好设置、项目缓存和生成的项目数据保存在设备上的应用本地容器中。模型服务商的 API 密钥使用操作系统的安全存储保存。</p>
        <p>哪里跑不运营用于保存应用项目或智能体会话副本的账号服务或云端后端。</p>
      </section>

      <section>
        <h2>发送给你所选服务的信息</h2>
        <p>运行智能体时，哪里跑会把你的提示，以及回答所需的项目或会话上下文，直接发送给你选择的模型服务商。根据你的请求，这些上下文可能包括源代码、文件内容、图片、工具结果和对话历史。受支持的服务商可能包括 Anthropic、DeepSeek、Google 和 OpenAI。</p>
        <p>当你 clone、fetch、pull 或 push 代码仓库时，应用会连接你指定的 Git 托管服务。安装依赖可能会访问软件包注册表。这些服务会依据各自的条款和隐私政策处理信息，其保留规则由服务商及你的账号设置决定。</p>
      </section>

      <section>
        <h2>网站托管</h2>
        <p>本网站不包含网站分析脚本、广告追踪器或应用 Cookie。页面与媒体均为静态文件。</p>
        <p>部署在 GitHub Pages 时，GitHub 可能会处理包括 IP 地址在内的请求信息，以运营和保护服务。有关数据处理与保留政策，请阅读 <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub 隐私声明</a>。</p>
      </section>

      <section>
        <h2>信息的使用与共享方式</h2>
        <p>信息用于提供你请求的功能、运营和保护网站、诊断问题。哪里跑不会出售你的个人信息，也不会将应用项目内容用于广告。</p>
        <p>信息只会与你指示应用使用的服务、网站托管服务商共享；或在遵守法律、保护权利与安全、调查滥用行为时按要求共享。</p>
      </section>

      <section>
        <h2>保留、删除与个人选择</h2>
        <p>你可以控制设备上存储的应用数据：在应用中删除单个会话或项目，在设置中移除已保存的 API 密钥，或通过设备卸载应用及其本地数据。删除本地数据不会删除已经发送给模型服务商、Git 托管服务、软件包注册表或其他第三方的副本；如需对这些服务控制的数据行使权利，请直接联系对应服务。</p>
        <p>如需咨询哪里跑控制的信息、申请删除数据，或在适用情况下撤回同意，请发送邮件至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>。</p>
      </section>

      <section>
        <h2>安全与儿童</h2>
        <p>哪里跑采用与本地优先设计相适应的技术保护措施，但任何存储或传输方式都无法保证绝对安全。请勿在项目文件、提示、附件、日志或预览输出中放置秘密信息。</p>
        <p>哪里跑是一款开发者工具，不面向 13 岁以下儿童。我们不会有意通过应用收集儿童的个人信息。</p>
      </section>

      <section>
        <h2>政策变更与联系方式</h2>
        <p>我们可能会随着哪里跑的变化更新本政策，页面上方的日期表示最新版本。如需产品帮助，请访问<a href={sitePath("/zh-CN/support")}>哪里跑支持</a>。隐私问题和请求可以发送至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>。</p>
      </section>
    </ContentPage>
  );
}
