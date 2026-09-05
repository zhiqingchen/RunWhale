import { siteUrl } from "@/app/site-config";
import type { Metadata } from "next";
import "./globals.css";

const title = "RunWhale — AI Coding Agent & Preview on Your Phone";
const description =
  "RunWhale combines an AI coding agent with an on-device workspace for compatible Web and Expo projects, supported checks, Git review, and React Native Preview.";
const socialImage = {
  url: `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`,
  width: 1200,
  height: 630,
  alt: "RunWhale AI coding agent and development workspace on a phone",
};

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}`),
  title,
  description,
  alternates: { canonical: `${siteUrl}/` },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/`,
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-US" className="antialiased">
      <body>
        {children}
      </body>
    </html>
  );
}
