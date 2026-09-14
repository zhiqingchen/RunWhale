import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { ContentPage } from "../content-page";
import { indexableRobots } from "../seo-metadata";

const title = "RunWhale Privacy Policy";
const description =
  "RunWhale privacy policy: local data, third-party AI sharing, deletion, and website hosting.";
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
    canonical: `${siteUrl}/privacy`,
    languages: {
      "en-US": `${siteUrl}/privacy`,
      "zh-CN": `${siteUrl}/zh-CN/privacy`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/privacy`,
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

export default function PrivacyPage() {
  return (
    <ContentPage
      languageHref="/zh-CN/privacy"
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="This policy covers the RunWhale app and this website. It explains what stays on your device, what is shared with services you choose, and your privacy choices."
      updated="September 15, 2026"
      updatedIso="2026-09-15"
    >
      <section>
        <h2>Scope</h2>
        <p>This policy applies to the RunWhale mobile app and this RunWhale website. It explains our own data handling and sharing. The linked policies of model providers, Git hosts, package registries, and other connected services provide additional information about those services; they do not replace our responsibilities described here.</p>
        <p>The app does not require a RunWhale account. It does not send usage analytics or advertising identifiers to RunWhale.</p>
      </section>

      <section>
        <h2>Information handled by the app</h2>
        <p>RunWhale stores projects, Git history, agent sessions, attachments, preferences, project caches, and generated project data in the app’s local container on your device. Model-provider API keys and the device&apos;s Git SSH private key are stored using the operating system’s secure storage.</p>
        <p>RunWhale does not upload copies of your projects or Agent sessions to a RunWhale server.</p>
      </section>

      <section>
        <h2>Information sent to services you choose</h2>
        <p>AI features send request content and the context needed to answer it to the selected model service. Recipients, data categories, consent choices, and provider terms are described in the next section.</p>
        <p>When you clone, fetch, pull, or push a repository, the app communicates with the Git host you specified. Installing dependencies may contact package registries. Those services process information under their own terms and privacy policies, and their retention rules are controlled by them and by your account settings.</p>
        <p>A GitHub share link reveals the repository owner, repository name, and commit SHA. Pushing publishes the commit to GitHub under the repository&apos;s access settings; private repository access remains controlled by GitHub. Opening external websites sends connection information, including your IP address, to their hosts.</p>
      </section>

      <section>
        <h2>Third-party AI services</h2>
        <p>Before sharing AI request content, RunWhale identifies the selected provider and API address and asks for your explicit consent. Consent applies to that recipient; changing the provider or address requires consent again. Declining prevents the AI request.</p>
        <p>With consent, Agent requests send prompts, conversation history, relevant source code and file contents, tool results, and any images or Preview screenshots used as context to Anthropic (Claude API), DeepSeek, Google (Gemini API), or OpenAI, according to your selection. Image generation and web search may also send request content through that provider. The receiving service gets the API key for authentication and connection information such as your IP address. These requests produce the answers, code, images, or actions you ask for and may contain personal information from your files or images.</p>
        <p>A custom API address sends requests to that address’s operator, which may forward them to other services. A model or provider name alone does not identify that operator. Review its identity, privacy policy, and onward-sharing practices before consenting.</p>
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
        <p>Code you run in Preview may contact its own services and process information you enter or permit it to access, including photos, camera, microphone, or location. Review the project&apos;s source and connected services before running it. Manage device permissions in system Settings. Preview content included in an agent request is sent to the selected AI service under the data-sharing choices described above.</p>
      </section>

      <section>
        <h2>Website hosting</h2>
        <p>This website does not include analytics scripts, advertising trackers, or application cookies. Its pages and media are static files.</p>
        <p>When hosted on GitHub Pages, GitHub may process request information, including IP addresses, to operate and secure the service. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub Privacy Statement</a> for its data practices and retention policies.</p>
      </section>

      <section>
        <h2>How information is used and shared</h2>
        <p>Information is used to provide the features you request, operate and secure the website, and diagnose problems. RunWhale does not sell your personal information or use app project content for advertising.</p>
        <p>Information is shared with services you direct the app to use and the website hosting provider described above, or when required to comply with law, protect rights and safety, or investigate abuse.</p>
      </section>

      <section>
        <h2>Retention, deletion, and your choices</h2>
        <p>You control app data stored on your device. Local workspace data remains until you delete it in the app or remove the app&apos;s data on your device; temporary caches may be cleared earlier. Delete individual sessions or projects in the workspace, remove saved API keys in Settings → Models, and remove or rotate the Git SSH key in Settings. Secure-storage items may survive uninstalling the app, so remove them first. Revoke credentials with the model provider or Git host as well. Deleting local data does not delete copies already sent to a model provider, Git host, package registry, or other third party; contact that service to exercise rights over data it controls.</p>
        <p>Withdraw AI consent in Settings → About → Privacy Policy → AI data sharing. Revocation stops active agents and prevents further model requests until you consent again. It does not remove information that a third party has already received. The app includes an offline copy of this privacy policy.</p>
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
