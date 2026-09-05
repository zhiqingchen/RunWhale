import { FaqPage } from "../../faq-page";
import { createHelpMetadata } from "../../help-copy";

export const metadata = createHelpMetadata("faq", "zh-CN");

export default function ChineseFaqPage() {
  return <FaqPage locale="zh-CN" />;
}
