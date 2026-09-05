# RunWhale website

The bilingual product website for [RunWhale](https://github.com/zhiqingchen/RunWhale), with demos, examples, a getting-started guide, FAQ, changelog, privacy policy, and support information.

Built with Next.js and exported as static HTML, CSS, JavaScript, and media. No application server, runtime secrets, analytics scripts, or backend service is required.

## Development

Use Node.js 22 and the pnpm version pinned in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

## Validation and static export

```sh
pnpm check
pnpm build
python3 -m http.server 3000 --directory out
```

Open `http://localhost:3000`. The `out/` directory is the complete deployable website. Nested pages are exported as directories with `index.html` files, so direct links and refreshes work on static hosts.

To test a GitHub project-site path locally:

```sh
NEXT_PUBLIC_BASE_PATH=/RunWhale \
NEXT_PUBLIC_SITE_URL=https://zhiqingchen.github.io/RunWhale \
pnpm build
```

Serve that output mounted at `/RunWhale/`, not at the server root. These are public build settings, not credentials. The workflow supplies both values from the Pages configuration; local builds default to no path prefix and `https://runwhale.dev` for canonical metadata.

## GitHub Pages deployment

1. In the GitHub repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions**.
2. Push to `doc` to run **Deploy website to GitHub Pages**. To redeploy an existing commit, rerun its workflow run from the Actions tab.
3. Open the URL reported by the deployment job.

The workflow installs the locked dependencies, runs lint and TypeScript checks, exports the site, and deploys only `out/`. It uses GitHub's built-in workflow token and requires no manually configured secrets. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The default project URL is `https://zhiqingchen.github.io/RunWhale/`. To use a custom domain, configure it and its DNS in **Settings → Pages**, then rerun the workflow. The configured URL and path automatically flow into navigation, assets, canonical URLs, language alternatives, social metadata, and the sitemap. This repository does not change DNS or claim a custom domain by default.

## Content and media

Keep English and Simplified Chinese content aligned in `src/app/`. Public support and privacy pages use `runwhale@runwhale.dev`.

The demo recordings and screenshots in `public/media/` show Animal Parade and Snake Sprint. The Animal Parade prompt is “Make a game for baby”; the Snake prompt is labeled as a suggested starting prompt. Other example prompts are ideas to try, not recorded outcomes.

Run `pnpm optimize:seo-images` to regenerate the Animal Parade image variants and shared brand assets. Existing Snake Sprint assets are retained. Changelog dates describe website updates, not mobile-app releases. Check the App Store listing before changing app pricing or availability claims.

Only approved public material belongs in `public/`: every file there is included in the export, even if no page links to it. Keep private diagnostics, development captures, local paths, credentials, and build output out of the repository.
