import type { Metadata } from "next";
import { ContentPage } from "@/app/content-page";
import { siteUrl, sitePath } from "@/app/site-config";
import { indexableRobots } from "@/app/seo-metadata";

const title = "哪里跑服务条款——账号与订阅";
const description = "了解哪里跑的使用条款，包括账号、商店订阅、取消续订以及你的项目。";

export const metadata: Metadata = {
  title,
  description,
  robots: indexableRobots,
  alternates: {
    canonical: `${siteUrl}/zh-CN/terms`,
    languages: { "en-US": `${siteUrl}/terms`, "zh-CN": `${siteUrl}/zh-CN/terms` },
  },
  openGraph: { title, description, url: `${siteUrl}/zh-CN/terms`, siteName: "RunWhale", locale: "zh_CN", type: "website" },
};

export default function TermsPage() {
  return (
    <ContentPage
      locale="zh-CN"
      languageHref="/terms"
      eyebrow="法律"
      title="服务条款"
      summary={description}
      updated="2026 年 9 月 8 日"
      updatedIso="2026-09-08"
    >
      <section>
        <h2>使用哪里跑</h2>
        <p>本条款适用于哪里跑应用、官网以及可选的账号和订阅服务。使用这些服务即表示你同意本条款；如果不同意，请停止使用相关服务。开源组件仍受各自的许可证约束。</p>
        <p>请仅在你依据适用法律能够订立本协议时使用哪里跑，或在父母或监护人依法提供必要许可和监督的情况下使用。</p>
      </section>

      <section>
        <h2>账号与访问</h2>
        <p>社区版无需哪里跑账号。在商业版中，你可以使用可用的 Apple 或 Google 登录方式管理账号和订阅。请妥善保护登录服务的账号；如怀疑存在未经授权的使用，请联系我们。</p>
        <p>本地开发和使用你自己的模型服务商 API 密钥不要求付费订阅哪里跑。第三方服务商可能依据其条款另外收费。</p>
      </section>

      <section>
        <h2>订阅与付款</h2>
        <p>订阅可用时，在应用中打开「我的」，登录后选择订阅套餐。确认商店购买前，请核对包含的权益、价格、币种、计费周期以及任何试用或首次订阅优惠。可用套餐可能因平台、地区和应用版本而异。</p>
        <p>付款由 Apple App Store 或 Google Play 处理。自动续费订阅会持续续订，直到你按照商店条款取消。试用资格、试用期限和试用结束后的价格，以商店在确认购买前显示的信息为准；请勿默认存在试用优惠。</p>
        <p>购买和恢复购买均需验证后才能开通订阅权益。若显示正在验证，请稍后刷新或联系支持，无需重复购买。恢复购买时，请登录原来的哪里跑账号，并使用购买时的商店账号。</p>
      </section>

      <section>
        <h2>取消续订与退款</h2>
        <p>你可以通过应用中的「管理订阅」或商店账号管理、取消续订。请遵循商店显示的取消时限和权益结束日期。如不希望 Apple 试用到期后续费，请至少提前 24 小时取消。</p>
        <p>卸载应用、退出登录或删除哪里跑账号不会取消商店订阅。取消续订与申请退款是两项不同操作。退款资格与处理遵循商店政策及适用法律，本条款不影响你的法定消费者权利。</p>
        <p><a href="https://support.apple.com/118428">Apple 取消订阅说明</a> · <a href="https://support.apple.com/118223">Apple 退款帮助</a> · <a href="https://support.google.com/googleplay/answer/7018481">Google Play 订阅管理</a> · <a href="https://support.google.com/googleplay/answer/2479637">Google Play 退款政策</a></p>
      </section>

      <section>
        <h2>用量与服务可用性</h2>
        <p>订阅仅包含所选套餐明确展示的功能和额度。如提供 AI 用量额度，该额度属于服务使用限额，并非现金或订阅价格。账号页面显示当前额度和用量；每月额度在每个 UTC 自然月开始时重置。</p>
        <p>部分功能依赖网络、设备和第三方服务。我们不承诺服务始终不中断，也不承诺提供当前应用版本和所选套餐中未包含的功能。</p>
      </section>

      <section>
        <h2>你的项目与合理使用</h2>
        <p>你保留对带入哪里跑的内容所享有的权利。你有责任确保有权使用项目文件、提示词、依赖和所连接的服务，并遵守其许可证及条款。请备份重要工作。</p>
        <p>AI 输出可能存在错误或不安全的代码。在依赖、分享或部署生成结果前，请进行审查与测试。不得利用哪里跑从事违法、侵权、未经授权的访问、恶意软件活动，或绕过服务安全措施和用量限制。</p>
      </section>

      <section>
        <h2>账号删除与服务变更</h2>
        <p>你可以在商业版应用的「我的」中申请删除账号，本地项目仍保留在设备上。账号删除及数据处理方式见隐私政策；删除账号前，请另外取消任何商店订阅。</p>
        <p>为处理滥用、安全风险或法律要求，我们可能限制账号服务。我们可能随着服务变化更新条款，页面日期标识最新版本；依法需要时，我们会在重大变更生效前通知你。本条款不排除适用法律不允许排除的权利或救济。</p>
      </section>

      <section>
        <h2>隐私与联系</h2>
        <p>有关数据处理，请阅读<a href={sitePath("/zh-CN/privacy")}>隐私政策</a>。如需帮助，请访问<a href={sitePath("/zh-CN/support")}>支持页面</a>或发送邮件至 <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>。</p>
      </section>
    </ContentPage>
  );
}
