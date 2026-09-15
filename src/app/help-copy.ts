import { catalogSection, type Catalog } from "./catalogs";

export type GuideScreenshot = Catalog["help"]["guide"]["screenshots"][number];
export const helpCopy = catalogSection("help");
