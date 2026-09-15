import { SitePage } from "@/app/site-page";
import { pageMetadata } from "@/app/page-metadata";

export const metadata = pageMetadata("en", "support");

export default function Page() {
  return <SitePage locale="en" page="support" />;
}
