import { ChangelogPage } from "../changelog-page";
import { createDiscoverMetadata } from "../discover-copy";

export const metadata = createDiscoverMetadata("updates", "en");

export default function EnglishChangelogPage() {
  return <ChangelogPage locale="en" />;
}
