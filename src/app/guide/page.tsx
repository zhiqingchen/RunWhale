import { GuidePage } from "../guide-page";
import { createHelpMetadata } from "../help-copy";

export const metadata = createHelpMetadata("guide", "en");

export default function EnglishGuidePage() {
  return <GuidePage locale="en" />;
}
