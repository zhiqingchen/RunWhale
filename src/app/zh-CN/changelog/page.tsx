import { ChangelogPage } from "../../changelog-page";
import { createDiscoverMetadata } from "../../discover-copy";

export const metadata = createDiscoverMetadata("updates", "zh-CN");

export default function ChineseChangelogPage() {
  return <ChangelogPage locale="zh-CN" />;
}
