import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { ContentPage } from "../content-page";
import { indexableRobots } from "../seo-metadata";

const title = "RunWhale Privacy Policy — App & Website Data";
const description =
  "RunWhale Privacy Policy: learn what stays on your device, what is sent to model providers and Git hosts, and how this website is hosted.";
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
      summary="RunWhale is local by design. This policy explains what stays on your device, what leaves it when you use connected services, and how the website is hosted."
      updated="September 5, 2026"
      updatedIso="2026-09-05"
    >
      <section>
        <h2>Scope</h2>
        <p>This policy applies to the RunWhale mobile app and this RunWhale website. It does not replace the privacy policies of model providers, Git hosts, package registries, or other services you choose to connect.</p>
      </section>

      <section>
        <h2>Information handled by the app</h2>
        <p>RunWhale stores projects, Git history, agent sessions, attachments, preferences, project caches, and generated project data in the app’s local container on your device. Model-provider API keys are stored using the operating system’s secure storage.</p>
        <p>RunWhale does not operate an account service or a cloud backend that stores copies of your app projects or agent sessions.</p>
      </section>

      <section>
        <h2>Information sent to services you choose</h2>
        <p>When you run an agent, RunWhale sends your prompt and the project or session context needed to answer it directly to the model provider you selected. Depending on your request, that context may include source code, file contents, images, tool results, and conversation history. Supported providers may include Anthropic, DeepSeek, Google, and OpenAI.</p>
        <p>When you clone, fetch, pull, or push a repository, the app communicates with the Git host you specified. Installing dependencies may contact package registries. Those services process information under their own terms and privacy policies, and their retention rules are controlled by them and by your account settings.</p>
      </section>

      <section>
        <h2>Website hosting</h2>
        <p>This website does not include analytics scripts, advertising trackers, or application cookies. Its pages and media are static files.</p>
        <p>When hosted on GitHub Pages, GitHub may process request information, including IP addresses, to operate and secure the service. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub Privacy Statement</a> for its data practices and retention policies.</p>
      </section>

      <section>
        <h2>How information is used and shared</h2>
        <p>Information is used to provide the features you request, operate and secure the website, and diagnose problems. RunWhale does not sell your personal information or use app project content for advertising.</p>
        <p>Information is shared only with services you direct the app to use, website hosting providers, or when required to comply with law, protect rights and safety, or investigate abuse.</p>
      </section>

      <section>
        <h2>Retention, deletion, and your choices</h2>
        <p>You control app data stored on your device. You can delete individual sessions or projects in RunWhale, remove saved API keys in Settings, or remove the app and its local data through your device. Deleting local data does not delete copies already sent to a model provider, Git host, package registry, or other third party; contact that service to exercise rights over data it controls.</p>
        <p>To ask about information controlled by RunWhale, request deletion, or withdraw consent where applicable, email <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>.</p>
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
