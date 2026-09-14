import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { ContentPage } from "@/app/content-page";
import { indexableRobots } from "@/app/seo-metadata";

const title = "RunWhale Privacy Policy";
const description =
  "RunWhale privacy policy: local workspace data, connected AI services, accounts, subscriptions, usage analytics, and website hosting.";
const socialImage = {
  url: `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`,
  width: 1200,
  height: 630,
  alt: "RunWhale AI coding agent and development workspace on a phone",
};

export const metadata: Metadata = {
  title,
  description,
  robots: indexableRobots,
  alternates: {
    canonical: `${siteUrl}/commercial/privacy`,
    languages: {
      "en-US": `${siteUrl}/commercial/privacy`,
      "zh-CN": `${siteUrl}/zh-CN/commercial/privacy`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/commercial/privacy`,
    siteName: "RunWhale",
    locale: "en_US",
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

export default function CommercialPrivacyPage() {
  return (
    <ContentPage
      languageHref="/zh-CN/commercial/privacy"
      privacyHref="/commercial/privacy"
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="This policy covers the RunWhale app and this website: local workspace data, connected AI services, accounts, subscriptions, usage analytics, and website hosting."
      updated="September 15, 2026"
      updatedIso="2026-09-15"
    >
      <section>
        <h2>Scope</h2>
        <p>This policy applies to the RunWhale mobile app and this RunWhale website. It explains our own data handling and sharing. The linked policies of model providers, Git hosts, package registries, and other connected services provide additional information about those services; they do not replace our responsibilities described here.</p>
      </section>

      <section>
        <h2>Information handled by the app</h2>
        <p>RunWhale stores projects, Git history, agent sessions, attachments, preferences, project caches, and generated project data in the app’s local container on your device. Model-provider API keys and the device&apos;s Git SSH private key are stored using the operating system’s secure storage.</p>
        <p>Accounts and subscriptions are optional. The account service does not store copies of your projects or agent sessions.</p>
      </section>

      <section>
        <h2>Accounts and subscriptions</h2>
        <p>When you sign in with an available Google or Apple login option, RunWhale verifies the provider&apos;s identity proof and stores your account identifier, linked provider identifiers, verified email address when supplied, and account and session timestamps. Login tokens stay in the app&apos;s secure storage; the server stores token hashes. They are not supplied to your projects, agent sessions, or Preview.</p>
        <p>Cloudflare hosts the account API and database and processes the network requests needed to provide them. RevenueCat receives your RunWhale account identifier and store purchase information to verify subscriptions, trials, renewals, and refunds. RunWhale records subscription status and usage accounting. Apple or Google processes store payments; RunWhale does not receive your payment-card details.</p>
      </section>

      <section>
        <h2>Information sent to services you choose</h2>
        <p>AI features send request content and the context needed to answer it to the selected model service. The AI data categories and provider terms are described in the next section.</p>
        <p>If you use the optional RunWhale model API, requests pass through the RunWhale backend to its configured model provider. The backend retains usage accounting rather than prompts, project files, or conversation content. Provider retention is governed by that provider&apos;s policies.</p>
        <p>When you clone, fetch, pull, or push a repository, the app communicates with the Git host you specified. Installing dependencies may contact package registries. Those services process information under their own terms and privacy policies, and their retention rules are controlled by them and by your account settings.</p>
        <p>A GitHub share link reveals the repository owner, repository name, and commit SHA. Pushing publishes the commit to GitHub under the repository&apos;s access settings; private repository access remains controlled by GitHub. Opening external websites sends connection information, including your IP address, to their hosts.</p>
      </section>

      <section>
        <h2>Third-party AI services</h2>
        <p>When you run the Agent with your own provider configuration, requests send prompts, conversation history, relevant source code and file contents, tool results, and any images or Preview screenshots used as context to Anthropic (Claude API), DeepSeek, Google (Gemini API), or OpenAI, according to your selection. Image generation and web search may also send request content through that provider. The receiving service gets the API key for authentication and connection information such as your IP address. These requests produce the answers, code, images, or actions you ask for and may contain personal information from your files or images.</p>
        <p>A custom API address sends requests to that address’s operator, which may forward them to other services. A model or provider name alone does not identify that operator. Review its identity, privacy policy, and onward-sharing practices before configuring or using the address.</p>
        <h3>AI providers, data use, and retention</h3>
        <p>The following links supplement this policy. RunWhale remains responsible for how it handles and shares your data. Our requirement for third-party recipients is protection of shared personal data at least equivalent to this policy and applicable privacy requirements. Providers may process requests outside your country. Their API features, agreements, region, and account settings affect retention and training use; a consumer chat service’s rules may differ from its API rules. These summaries describe published terms as of the update date, not a promise of zero retention. For access or deletion, contact the provider or runwhale@runwhale.dev for help with requests concerning RunWhale’s processing.</p>
        <ul>
          <li><strong>Anthropic.</strong> API inputs and outputs are not used for training by default. They are normally deleted within 30 days, with exceptions for particular features, agreements, safety enforcement, and legal obligations. Opting in or submitting feedback can permit training. <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noreferrer">Privacy policy</a> · <a href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noreferrer">API data use</a> · <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noreferrer">API data retention</a></li>
          <li><strong>DeepSeek.</strong> The Open Platform terms apply to API use. RunWhale has not confirmed a fixed API retention period or a no-training commitment. Confirm the terms for your account with DeepSeek before sending personal information. <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html" target="_blank" rel="noreferrer">Privacy policy</a> · <a href="https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html" target="_blank" rel="noreferrer">API terms</a></li>
          <li><strong>Google (Gemini API).</strong> Gemini API data use depends on Google’s service tier and region. Unpaid services may use content for model improvement and human review; do not submit sensitive, confidential, or personal information to them. Paid-service rules exclude product-improvement use and also apply in the EEA, Switzerland, and UK. Safety logs and feature-specific retention can still apply. <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a> · <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">API terms</a></li>
          <li><strong>OpenAI.</strong> API data is not used for training unless you opt in. Abuse-monitoring logs normally last up to 30 days; safety, legal, feature-specific storage, and approved account controls can change retention. <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">Privacy policy</a> · <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">API data use</a></li>
        </ul>
      </section>

      <section>
        <h2>Projects running in Preview</h2>
        <p>Code you run in Preview may contact its own services and process information you enter or permit it to access, including photos, camera, microphone, or location. Review the project&apos;s source and connected services before running it. Manage device permissions in system Settings. Preview content included in an agent request is sent to the model service handling that request.</p>
      </section>

      <section>
        <h2>App usage analytics</h2>
        <p>The app uses Google Analytics for Firebase, enabled automatically when the app starts, to understand feature usage and improve reliability. Debug builds do not send these analytics. The app does not show a separate analytics permission prompt or provide an analytics switch.</p>
        <p>Google receives app opens and engagement information, project creation and Preview event categories, outcomes and durations, app version, device model, operating system, language, and a randomly generated app-instance identifier. Google may derive approximate location from the connection&apos;s IP address; Analytics does not log or store individual IP addresses. We do not send your RunWhale account identifier, email, code, prompts, project names, file contents, paths, URLs, or logs as analytics event data.</p>
        <p>Advertising identifier collection, advertising personalization, and automatic screen reporting are disabled. Analytics is limited to the RunWhale app; the Firebase SDK is not exposed to projects running in Native Preview. Google processes analytics data on its infrastructure, which may be outside your country, according to the <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a> and its <a href="https://support.google.com/analytics/answer/6004245" target="_blank" rel="noreferrer">Analytics data safeguards</a>.</p>
        <p>Analytics records follow the retention settings of our Google Analytics property. Deleting a RunWhale account or local projects does not automatically delete previously collected analytics, which are not linked by us to your account identifier. Contact us using the address below for analytics privacy or deletion requests.</p>
      </section>

      <section>
        <h2>Website hosting</h2>
        <p>This website does not include analytics scripts, advertising trackers, or application cookies. Its pages and media are static files.</p>
        <p>When hosted on GitHub Pages, GitHub may process request information, including IP addresses, to operate and secure the service. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub Privacy Statement</a> for its data practices and retention policies.</p>
      </section>

      <section>
        <h2>How information is used and shared</h2>
        <p>Information is used to provide the features you request, operate and secure the website, and diagnose problems. RunWhale does not sell your personal information or use app project content for advertising.</p>
        <p>Information is shared with services you direct the app to use, the account, subscription, analytics, and hosting providers described above, or when required to comply with law, protect rights and safety, or investigate abuse.</p>
      </section>

      <section>
        <h2>Retention, deletion, and your choices</h2>
        <p>You control app data stored on your device. Local workspace data remains until you delete it in the app or remove the app&apos;s data on your device; temporary caches may be cleared earlier. Delete individual sessions or projects in the workspace, remove saved API keys in Settings → Models, and remove or rotate the Git SSH key in Settings. Secure-storage items may survive uninstalling the app, so remove them first. Revoke credentials with the model provider or Git host as well. Deleting local data does not delete copies already sent to a model provider, Git host, package registry, or other third party; contact that service to exercise rights over data it controls.</p>
        <p>You can delete your account from the Me tab after signing in again. Deletion removes account identities and sessions while preserving local projects. Pseudonymous usage records remain until scheduled cleanup, generally three to four months; a temporary hashed identifier prevents quota-reset abuse until the next UTC calendar month. Deleting the account does not cancel an App Store or Google Play subscription. Manage cancellation in the store, whose billing records and RevenueCat records follow their own retention policies.</p>
        <p>To ask about information controlled by RunWhale, request deletion, or withdraw consent where applicable, email <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>.</p>
        <p>If you contact support, we receive your email address and message to respond. We keep support correspondence while needed to handle your request or meet legal obligations. You can use the same address for access, correction, or other privacy requests. Do not send API keys or private keys.</p>
      </section>

      <section>
        <h2>Security and children</h2>
        <p>RunWhale uses technical safeguards appropriate to its local-first design, but no storage or transmission method is completely secure. Do not place secrets in project files, prompts, attachments, logs, or Preview output.</p>
        <p>RunWhale is a developer tool and is not directed to children under 13. We do not knowingly collect personal information from children through the app.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>We may update this policy as RunWhale changes. The date above identifies the latest version. For product help, visit <a href={sitePath("/support")}>RunWhale Support</a>. Questions and privacy requests can be sent to <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>.</p>
      </section>
    </ContentPage>
  );
}
