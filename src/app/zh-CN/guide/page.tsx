import { GuidePage } from "../../guide-page";
import { createHelpMetadata } from "../../help-copy";

export const metadata = createHelpMetadata("guide", "zh-CN");

export default function ChineseGuidePage() {
  return <GuidePage locale="zh-CN" />;
}
