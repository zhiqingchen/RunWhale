import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage } from "../content-page";
import { indexableRobots } from "../seo-metadata";

const issuesUrl = "https://github.com/zhiqingchen/RunWhale/issues";
const title = "RunWhale Support — Setup, Agent & Preview Help";
const description =
  "Get RunWhale help for setup, projects, AI agent sessions, Git, Web Preview, and Native Preview, or report a bug through email or GitHub Issues.";
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
    canonical: `${siteUrl}/support`,
    languages: {
      "en-US": `${siteUrl}/support`,
      "zh-CN": `${siteUrl}/zh-CN/support`,
    },
  },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/support`,
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

export default function SupportPage() {
  return (
    <ContentPage
      languageHref="/zh-CN/support"
      eyebrow="Help"
      title="RunWhale Support"
      summary="Get help with setup, projects, agent sessions, and Preview, or tell us when something is not working."
      updated="September 4, 2026"
      updatedIso="2026-09-04"
      activeResource="support"
    >
      <section>
        <h2>Start with the right resource</h2>
        <div className="support-links">
          <Link href="/guide">
            <strong>Follow the step-by-step guide</strong>
            <span>Configure a model, create or import a project, work with the Agent, and open Preview.</span>
          </Link>
          <Link href="/faq">
            <strong>Check common questions</strong>
            <span>Find answers about connectivity, data, compatibility, Git, and common failures.</span>
          </Link>
        </div>
      </section>

      <section>
        <h2>Contact support</h2>
        <p>Email <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a> for private support requests. For reproducible bugs and feature requests that do not contain sensitive information, use <a href={issuesUrl} target="_blank" rel="noreferrer">GitHub Issues</a>.</p>
        <p>Include your RunWhale version, device model, operating system version, the action you attempted, the exact error message, the smallest set of steps that reproduces the issue, and any non-sensitive diagnostics shown by the app. Never include API keys, private keys, credentials, private project data, personal data, or unsanitized logs and screenshots.</p>
      </section>

      <section>
        <h2>Privacy and security reports</h2>
        <p>Read the <a href={sitePath("/privacy")}>RunWhale Privacy Policy</a> for details about local app data, connected services, website hosting, deletion, and privacy requests.</p>
        <p>If you believe you found a security vulnerability, or need to share sensitive details with a privacy request, email <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a> instead of opening a public Issue.</p>
      </section>

      <section>
        <h2>Open-source project</h2>
        <p>RunWhale source code and public project information are available on <a href="https://github.com/zhiqingchen/RunWhale" target="_blank" rel="noreferrer">GitHub</a>. Public issue responses are visible to everyone, so use email when your request includes information that should remain private.</p>
      </section>
    </ContentPage>
  );
}
