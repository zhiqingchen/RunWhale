import { ExamplesPage } from "../../examples-page";
import { createDiscoverMetadata } from "../../discover-copy";

export const metadata = createDiscoverMetadata("examples", "zh-CN");

export default function ChineseExamplesPage() {
  return <ExamplesPage locale="zh-CN" />;
}
