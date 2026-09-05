import { ExamplesPage } from "../examples-page";
import { createDiscoverMetadata } from "../discover-copy";

export const metadata = createDiscoverMetadata("examples", "en");

export default function EnglishExamplesPage() {
  return <ExamplesPage locale="en" />;
}
