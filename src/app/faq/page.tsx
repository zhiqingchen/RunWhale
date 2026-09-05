import { FaqPage } from "../faq-page";
import { createHelpMetadata } from "../help-copy";

export const metadata = createHelpMetadata("faq", "en");

export default function EnglishFaqPage() {
  return <FaqPage locale="en" />;
}
