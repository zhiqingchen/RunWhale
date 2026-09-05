// These public build settings are supplied by the GitHub Pages workflow.
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://runwhale.dev").replace(/\/$/, "");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Next Link adds basePath itself; plain links and public assets need it explicitly.
export function sitePath(path: string): string {
  return `${basePath}${path}`;
}
