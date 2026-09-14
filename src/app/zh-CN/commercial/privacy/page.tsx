import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { ContentPage } from "@/app/content-page";
import { indexableRobots } from "@/app/seo-metadata";

const title = "哪里跑商业版隐私政策";
const description =
  "哪里跑商业版隐私政策：了解本地工作区数据、联网 AI 服务、账号、订阅、使用统计与网站托管的数据处理方式。";
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
    canonical: `${siteUrl}/zh-CN/commercial/privacy`,
    languages: {
      "en-US": `${siteUrl}/commercial/privacy`,
      "zh-CN": `${siteUrl}/zh-CN/commercial/privacy`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/zh-CN/commercial/privacy`,
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

export default function ChineseCommercialPrivacyPage() {
  return (
    <ContentPage
      locale="zh-CN"
      languageHref="/commercial/privacy"
      privacyHref="/zh-CN/commercial/privacy"
      eyebrow="商业版"
      title="商业版隐私政策"
      summary="本政策适用于哪里跑商业版，说明本地工作区数据、联网 AI 服务、账号、订阅、使用统计与网站托管的数据处理方式。"
      updated="2026 年 9 月 15 日"
      updatedIso="2026-09-15"
    >
      <section>
        <h2>适用范围</h2>
        <p>本政策适用于哪里跑商业版移动应用和本网站，说明我们自身的数据处理与共享行为。所链接的模型服务商、Git 托管服务、软件包注册表及其他联网服务政策，补充说明各自的处理方式，不替代我们在本政策中承担的责任。</p>
        <p>开源社区版适用单独的<a href={sitePath("/zh-CN/privacy")}>社区版隐私政策</a>。</p>
      </section>

      <section>
        <h2>应用处理的信息</h2>
        <p>哪里跑会将项目、Git 历史、智能体会话、附件、偏好设置、项目缓存和生成的项目数据保存在设备上的应用本地容器中。模型服务商的 API 密钥和设备的 Git SSH 私钥使用操作系统的安全存储保存。</p>
        <p>商业版提供可选的账号和订阅功能；账号服务不会保存你的项目或智能体会话副本。</p>
      </section>

      <section>
        <h2>商业版账号与订阅</h2>
        <p>使用已开放的 Google 或 Apple 登录方式时，哪里跑会验证服务商提供的身份凭证，并保存账号标识、关联的登录服务商标识、服务商提供的已验证邮箱，以及账号和会话的时间信息。登录令牌保存在应用的安全存储中，服务端仅保存令牌哈希；令牌不会提供给用户项目、智能体会话或 Preview。</p>
        <p>Cloudflare 托管账号 API 和数据库，并处理提供这些服务所需的网络请求。RevenueCat 接收你的哪里跑账号标识和商店购买信息，以验证订阅、试用、续订和退款。哪里跑记录订阅状态和用量账目。商店付款由 Apple 或 Google 处理，哪里跑不会接收你的银行卡资料。</p>
      </section>

      <section>
        <h2>发送给你所选服务的信息</h2>
        <p>AI 功能会将请求内容及回答所需的上下文发送给所选模型服务。AI 数据类别和服务商条款详见下一节。</p>
        <p>如果你使用可选的哪里跑模型 API，请求会经由哪里跑后端发送给其配置的模型服务商。后端保留用量账目，不保存提示、项目文件或对话内容。模型服务商的数据保留规则由其自身政策规定。</p>
        <p>当你 clone、fetch、pull 或 push 代码仓库时，应用会连接你指定的 Git 托管服务。安装依赖可能会访问软件包注册表。这些服务会依据各自的条款和隐私政策处理信息，其保留规则由服务商及你的账号设置决定。</p>
        <p>GitHub 分享链接会公开仓库所有者、仓库名和 commit SHA。推送会按照仓库的访问设置将 commit 发布到 GitHub；私有仓库的访问权限仍由 GitHub 管理。打开外部网站会向其托管方发送包括 IP 地址在内的连接信息。</p>
      </section>

      <section>
        <h2>第三方 AI 服务</h2>
        <p>使用你自己配置的服务商运行 Agent 时，应用会按照你的选择，将提示词、对话历史、相关源码和文件内容、工具结果，以及作为上下文使用的图片或 Preview 截图发送给 Anthropic（Claude API）、DeepSeek、Google（Gemini API）或 OpenAI。图像生成和网页搜索也可能通过该服务商发送请求内容。接收服务会收到用于认证的 API 密钥，以及 IP 地址等连接信息。请求用于生成你要求的回复、代码、图片或操作，可能包含文件或图片中的个人信息。</p>
        <p>使用自定义 API 地址时，请求会发送给该地址的运营方，后者可能继续转发给其他服务。仅凭模型或服务商名称无法确定该运营方。配置或使用该地址前，请了解其身份、隐私政策及后续转发方式。</p>
        <h3>AI 服务商、数据用途与保留</h3>
        <p>以下链接是对本政策的补充。RunWhale 仍对自身处理和共享数据的行为负责。我们要求第三方接收方对共享个人信息提供至少与本政策及适用隐私要求同等的保护。服务商可能在你所在国家以外处理请求。具体 API 功能、协议、地区和账号设置会影响保留期限及训练用途；面向消费者的聊天服务规则可能与 API 规则不同。以下摘要依据更新日期时公布的条款，不代表零保留承诺。如需访问或删除数据，可联系服务商；涉及 RunWhale 的处理行为，也可发送邮件至 runwhale@runwhale.dev 寻求协助。</p>
        <ul>
          <li><strong>Anthropic.</strong> API 输入和输出默认不用于训练，通常在 30 天内删除；特定功能、协议、安全执法或法律义务可能构成例外。主动选择共享数据或提交反馈可能允许训练用途。 <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noreferrer">隐私政策</a> · <a href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noreferrer">API 数据使用说明</a> · <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noreferrer">API 数据保留说明</a></li>
          <li><strong>DeepSeek.</strong> API 使用适用开放平台条款。RunWhale 尚未确认该 API 的固定保留期限或不用于训练的承诺。发送个人信息前，请向 DeepSeek 确认你的账号所适用的条款。 <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html" target="_blank" rel="noreferrer">隐私政策</a> · <a href="https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html" target="_blank" rel="noreferrer">API 服务条款</a></li>
          <li><strong>Google (Gemini API).</strong> Gemini API 的数据用途取决于 Google 定义的服务类型和地区。免费服务可能将内容用于模型改进及人工审核，请勿向此类服务提交敏感、机密或个人信息。付费服务规则不允许将内容用于产品改进，并同样适用于欧洲经济区、瑞士和英国。安全日志及特定功能仍可能保留数据。 <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">隐私政策</a> · <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">API 服务条款</a></li>
          <li><strong>OpenAI.</strong> API 数据默认不用于训练，除非你主动选择加入。滥用监测日志通常最多保留 30 天；安全、法律、特定功能存储和获批的账号控制措施可能影响期限。 <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">隐私政策</a> · <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">API 数据使用说明</a></li>
        </ul>
      </section>

      <section>
        <h2>Preview 中运行的项目</h2>
        <p>在 Preview 中运行的代码可能连接自己的服务，并处理你输入或允许其访问的信息，包括照片、相机、麦克风或位置。运行前请检查项目源码及其连接的服务。在系统设置中管理设备权限。被加入智能体请求的 Preview 内容，会发送给处理该请求的模型服务。</p>
      </section>

      <section>
        <h2>商业版应用使用统计</h2>
        <p>商业版移动应用使用 Google Analytics for Firebase，在应用启动时自动启用，以了解功能使用情况并改善可靠性。Debug 构建不发送这些统计。商业版不会单独弹出统计授权提示，也不提供统计开关。</p>
        <p>Google 会接收应用打开与互动信息、项目创建和 Preview 的事件类别、结果与耗时、应用版本、设备型号、操作系统、语言，以及随机生成的应用实例标识。Google 可能根据连接的 IP 地址推算大致位置；Analytics 不记录或存储单独的 IP 地址。我们不会将你的哪里跑账号标识、邮箱、代码、提示词、项目名称、文件内容、路径、URL 或日志作为统计事件数据发送。</p>
        <p>广告标识收集、广告个性化和自动屏幕上报均已关闭。统计限于哪里跑应用本身，Firebase SDK 不向 Native Preview 中运行的用户项目开放。Google 会在其基础设施上处理统计数据，处理地点可能在你所在国家或地区以外，具体遵循 <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google 隐私政策</a>及其 <a href="https://support.google.com/analytics/answer/6004245" target="_blank" rel="noreferrer">Analytics 数据保护说明</a>。</p>
        <p>统计记录按我们 Google Analytics 媒体资源的数据保留设置保存。删除哪里跑账号或本地项目，不会自动删除此前收集的统计数据；我们不通过账号标识关联这些统计。如需提出统计数据的隐私或删除请求，请通过下方邮箱联系我们。</p>
      </section>

      <section>
        <h2>网站托管</h2>
        <p>本网站不包含网站分析脚本、广告追踪器或应用 Cookie。页面与媒体均为静态文件。</p>
        <p>部署在 GitHub Pages 时，GitHub 可能会处理包括 IP 地址在内的请求信息，以运营和保护服务。有关数据处理与保留政策，请阅读 <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub 隐私声明</a>。</p>
      </section>

      <section>
        <h2>信息的使用与共享方式</h2>
        <p>信息用于提供你请求的功能、运营和保护网站、诊断问题。哪里跑不会出售你的个人信息，也不会将应用项目内容用于广告。</p>
        <p>信息会与你指示应用使用的服务、上述账号、订阅、统计和托管服务商共享；或在遵守法律、保护权利与安全、调查滥用行为时按要求共享。</p>
      </section>

      <section>
        <h2>保留、删除与个人选择</h2>
        <p>你可以控制设备上存储的应用数据。本地工作区数据会保留到你在应用中删除它，或在设备上移除应用数据；临时缓存可能提前清理。可在工作区删除单个会话或项目，在“设置 → 模型”移除 API 密钥，并在设置中删除或轮换 Git SSH 密钥。安全存储内容可能在卸载后保留，因此请先移除，并同时在模型服务商或 Git 托管服务处撤销凭证。删除本地数据不会删除已经发送给模型服务商、Git 托管服务、软件包注册表或其他第三方的副本；如需对这些服务控制的数据行使权利，请直接联系对应服务。</p>
        <p>在商业版中，重新登录后可在“我的”页面删除账号。删除操作会移除账号身份和会话，并保留本地项目。使用化名标识的用量记录会保留至定时清理，通常为三至四个月；用于防止重建账号重置额度的临时哈希标识会保留至下一个 UTC 日历月。删除账号不会取消 App Store 或 Google Play 订阅，请在商店管理取消操作。商店的账单记录和 RevenueCat 记录遵循各自的数据保留政策。</p>
        <p>如需咨询哪里跑控制的信息、申请删除数据，或在适用情况下撤回同意，请发送邮件至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>。</p>
        <p>联系支持时，我们会接收你的邮箱和消息以便回复，并在处理请求或履行法律义务所需期间保留邮件。你也可以通过同一邮箱提出访问、更正或其他隐私请求。请勿发送 API 密钥或私钥。</p>
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
