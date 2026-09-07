import type { Metadata } from "next";
import { ContentPage } from "@/app/content-page";
import { siteUrl, sitePath } from "@/app/site-config";
import { indexableRobots } from "@/app/seo-metadata";

const title = "RunWhale Terms of Service — Accounts & Subscriptions";
const description = "Terms for using RunWhale, including accounts, store subscriptions, cancellation, and your projects.";

export const metadata: Metadata = {
  title,
  description,
  robots: indexableRobots,
  alternates: {
    canonical: `${siteUrl}/terms`,
    languages: { "en-US": `${siteUrl}/terms`, "zh-CN": `${siteUrl}/zh-CN/terms` },
  },
  openGraph: { title, description, url: `${siteUrl}/terms`, siteName: "RunWhale", locale: "en_US", type: "website" },
};

export default function TermsPage() {
  return (
    <ContentPage
      locale="en"
      languageHref="/zh-CN/terms"
      eyebrow="Legal"
      title="Terms of Service"
      summary={description}
      updated="September 8, 2026"
      updatedIso="2026-09-08"
    >
      <section>
        <h2>Using RunWhale</h2>
        <p>These terms apply to the RunWhale app, website, and optional account and subscription services. By using them, you agree to these terms. If you do not agree, stop using the services. Open-source components remain governed by their respective licenses.</p>
        <p>Use RunWhale only when you can enter into this agreement under the laws that apply to you, or with the permission and supervision required from a parent or guardian.</p>
      </section>

      <section>
        <h2>Accounts and access</h2>
        <p>The community edition does not require a RunWhale account. In the commercial edition, sign in with an available Apple or Google option to manage your account and subscriptions. Keep access to your sign-in provider secure and contact us if you suspect unauthorized use.</p>
        <p>Local development and use of your own model-provider API keys do not require a paid RunWhale subscription. Third-party providers may charge separately under their own terms.</p>
      </section>

      <section>
        <h2>Subscriptions and payment</h2>
        <p>Where subscriptions are available, open Me, sign in, and choose a subscription in the app. Review the benefits, price, currency, billing period, and any trial or introductory offer before confirming the store purchase. Availability may depend on your platform, region, and app version.</p>
        <p>Apple App Store or Google Play processes payment. Auto-renewing subscriptions continue until cancelled through the store under its terms. Any trial eligibility, trial duration, and price after the trial are shown by the store before confirmation. Do not assume a trial is available.</p>
        <p>Purchase and restoration require verification before subscription access is activated. If verification is pending, refresh later or contact support rather than buying again. Use Restore purchases while signed in to the original RunWhale account and the store account used for the purchase.</p>
      </section>

      <section>
        <h2>Cancellation and refunds</h2>
        <p>Use Manage subscription in the app or your store account to manage or cancel renewal. Follow the store’s displayed cancellation deadline and access end date. For Apple trials, cancel at least 24 hours before the trial ends if you do not want to renew.</p>
        <p>Uninstalling RunWhale, signing out, or deleting your RunWhale account does not cancel a store subscription. Cancellation and a refund are separate actions. Refund eligibility and processing follow the store’s policies and applicable law; these terms do not remove your statutory consumer rights.</p>
        <p><a href="https://support.apple.com/118428">Apple cancellation instructions</a> · <a href="https://support.apple.com/118223">Apple refund help</a> · <a href="https://support.google.com/googleplay/answer/7018481">Google Play subscription management</a> · <a href="https://support.google.com/googleplay/answer/2479637">Google Play refund policies</a></p>
      </section>

      <section>
        <h2>Included usage and availability</h2>
        <p>Only the features and limits shown for your selected subscription are included. An AI usage allowance, if offered, is a service limit, not cash or the subscription price. The account screen shows the current allowance and usage; monthly allowances reset at the start of each UTC calendar month.</p>
        <p>Features may depend on network access, your device, and third-party services. We do not promise uninterrupted availability or access to features that are not included in your app version and selected plan.</p>
      </section>

      <section>
        <h2>Your projects and responsible use</h2>
        <p>You retain your rights in the content you bring to RunWhale. You are responsible for having permission to use project files, prompts, dependencies, and connected services, and for complying with their licenses and terms. Back up important work.</p>
        <p>AI output may contain errors or insecure code. Review and test generated work before relying on it, sharing it, or deploying it. Do not use RunWhale for unlawful activity, infringement, unauthorized access, malware, or attempts to bypass service security or usage limits.</p>
      </section>

      <section>
        <h2>Account deletion and service changes</h2>
        <p>You can request account deletion from Me in the commercial app. Local projects remain on your device. Account deletion and data handling are explained in the Privacy Policy; cancel any store subscription separately before deleting your account.</p>
        <p>We may restrict account services where needed to address abuse, security risks, or legal requirements. We may update these terms as the service changes and will identify the latest version by the date on this page. Where required, material changes will be communicated before they take effect. These terms do not exclude rights or remedies that applicable law does not allow us to exclude.</p>
      </section>

      <section>
        <h2>Privacy and contact</h2>
        <p>For data handling, read the <a href={sitePath("/privacy")}>Privacy Policy</a>. For help, visit <a href={sitePath("/support")}>Support</a> or email <a href="mailto:runwhale@runwhale.dev">runwhale@runwhale.dev</a>.</p>
      </section>
    </ContentPage>
  );
}
