import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "../../content-page";
import { indexableRobots } from "../../seo-metadata";

const issuesUrl = "https://github.com/zhiqingchen/RunWhale/issues";
const title = "哪里跑支持——设置、智能体与预览帮助";
const description =
  "获取哪里跑的设置、项目、AI 智能体会话、Git、Web 预览和原生预览帮助，或通过邮件与 GitHub Issues 报告问题。";
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
    canonical: `${siteUrl}/zh-CN/support`,
    languages: {
      "en-US": `${siteUrl}/support`,
      "zh-CN": `${siteUrl}/zh-CN/support`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/zh-CN/support`,
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

export default function ChineseSupportPage() {
  return (
    <ContentPage
      locale="zh-CN"
      languageHref="/support"
      eyebrow="帮助"
      title="哪里跑支持"
      summary="获取设置、项目、智能体会话和预览方面的帮助，也欢迎告诉我们哪里出了问题。"
      updated="2026 年 9 月 4 日"
      updatedIso="2026-09-04"
      activeResource="support"
    >
      <section>
        <h2>从合适的内容开始</h2>
        <div className="support-links">
          <Link href="/zh-CN/guide">
            <strong>查看分步教程</strong>
            <span>配置模型，创建或导入项目，使用 Agent，并打开 Preview。</span>
          </Link>
          <Link href="/zh-CN/faq">
            <strong>查看常见问题</strong>
            <span>了解联网、数据、兼容性、Git 和常见故障。</span>
          </Link>
        </div>
      </section>

      <section>
        <h2>联系支持</h2>
        <p>需要私密支持时，请发送邮件至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>。对于不包含敏感信息、可以稳定复现的问题和功能建议，请使用 <a href={issuesUrl} target="_blank" rel="noreferrer">GitHub Issues</a>。</p>
        <p>请附上哪里跑版本、设备型号、操作系统版本、你尝试执行的操作、完整错误信息、能够复现问题的最少步骤，以及应用显示的非敏感诊断信息。切勿提供 API 密钥、私钥、凭据、私有项目数据、个人数据，或未经脱敏的日志和截图。</p>
      </section>

      <section>
        <h2>隐私与安全报告</h2>
        <p>有关本地应用数据、所连接的服务、网站托管、数据删除和隐私请求的详细说明，请阅读<a href={sitePath("/zh-CN/privacy")}>哪里跑隐私政策</a>。</p>
        <p>如果你认为发现了安全漏洞，或需要在隐私请求中提供敏感细节，请发送邮件至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>，不要创建公开 Issue。</p>
      </section>

      <section>
        <h2>开源项目</h2>
        <p>哪里跑的源代码和公开项目信息可在 <a href="https://github.com/zhiqingchen/RunWhale" target="_blank" rel="noreferrer">GitHub</a> 上查看。公开 Issue 的回复对所有人可见；如果请求中包含应当保密的信息，请使用电子邮件。</p>
      </section>
    </ContentPage>
  );
}
