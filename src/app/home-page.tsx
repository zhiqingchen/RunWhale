import { siteUrl, sitePath } from "@/app/site-config";
import Image from "next/image";
import { Card, Chip, Link } from "@heroui/react";
import {
  ArrowRight,
  Check,
  Download,
  GitBranch,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { homeCopy, type WebsiteLocale } from "./home-copy";
import { ParallaxLayer } from "./parallax-layer";
import { discoverCopy } from "./discover-copy";
import { ExamplesSection, LatestUpdate, PurchaseSummary } from "./discover-sections";

const githubUrl = "https://github.com/zhiqingchen/RunWhale";
const appStoreUrl = "https://apps.apple.com/app/id6807644595";
const optimizedMediaRoot = sitePath("/media/optimized/v1");
const workflowScreenshotSizes = "(max-width: 720px) 82vw, (max-width: 980px) 44vw, 31vw";

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .7a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.24c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.82.58A12 12 0 0 0 12 .7Z" />
    </svg>
  );
}

const featureIcons = [Sparkles, Play, ShieldCheck] as const;
const workflowIcons = [GitBranch, Sparkles, Smartphone] as const;

export function HomePage({ locale }: { locale: WebsiteLocale }) {
  const copy = homeCopy[locale];
  const discover = discoverCopy[locale];
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": locale === "en" ? `${siteUrl}/#website` : `${siteUrl}/zh-CN#website`,
    url: locale === "en" ? `${siteUrl}/` : `${siteUrl}/zh-CN`,
    name: copy.brand,
    alternateName: locale === "en" ? "runwhale.dev" : "RunWhale",
    inLanguage: copy.htmlLang,
  };

  return (
    <main lang={copy.htmlLang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <header className="site-nav shell">
        <Link href="#top" className="brand" aria-label={copy.homeAria}>
          <Image src={`${optimizedMediaRoot}/runwhale-icon-128.webp`} alt="" width={36} height={36} />
          <span>{copy.brand}</span>
        </Link>

        <nav className="nav-links" aria-label={copy.navAria}>
          <Link href="#demo">{copy.nav.demo}</Link>
          <Link href="#features">{copy.nav.features}</Link>
          <Link href={sitePath(discover.examplesHref)}>{discover.examplesLabel}</Link>
          <Link href={sitePath(discover.updatesHref)}>{discover.updatesLabel}</Link>
          <Link href={sitePath(copy.guideHref)}>{copy.nav.guide}</Link>
          <Link href={sitePath(copy.faqHref)}>{copy.nav.faq}</Link>
        </nav>

        <div className="nav-actions">
          <Link className="mobile-help-link" href={sitePath(copy.guideHref)}>
            {copy.nav.help}
          </Link>
          <Link
            className="language-link"
            href={sitePath(copy.languageHref)}
            hrefLang={locale === "en" ? "zh-CN" : "en-US"}
            aria-label={copy.languageAria}
          >
            {copy.languageLabel}
          </Link>
          <Link className="nav-cta" href={appStoreUrl} target="_blank" rel="noreferrer">
            <Download size={17} /> {copy.downloadOnAppStore}
          </Link>
        </div>
      </header>

      <section id="top" className="hero shell">
        <div className="hero-copy">
          <Chip color="accent" variant="soft" className="eyebrow">
            <Sparkles size={14} /> {copy.eyebrow}
          </Chip>
          <h1>
            {copy.heroTitle}{" "}
            <span>{copy.heroAccent}</span>
          </h1>
          <p className="hero-lead">{copy.heroLead}</p>
          <p className="beginner-pitch">
            <Check size={16} /> {copy.beginnerPitch}
          </p>
          <div className="hero-actions">
            <Link className="primary-cta" href={appStoreUrl} target="_blank" rel="noreferrer">
              <Download size={18} /> {copy.downloadOnAppStore} <ArrowRight size={17} />
            </Link>
            <Link className="secondary-cta" href="#demo">{copy.watchWorkflow}</Link>
          </div>
          <p className="app-store-price">{copy.appStorePrice}</p>
          <p className="download-details">
            {discover.purchase.downloadNote}{" "}
            <Link href="#purchase">{discover.purchase.title}</Link>
          </p>
          <p className="local-note">
            <ShieldCheck size={16} /> {copy.localNote}
          </p>
        </div>

        <ParallaxLayer className="brand-visual" amount={42} direction="background">
          <div className="visual-glow" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <picture className="brand-visual-picture">
            <source
              type="image/avif"
              srcSet={`${optimizedMediaRoot}/runwhale-icon-512.avif 512w, ${optimizedMediaRoot}/runwhale-icon-1024.avif 1024w`}
              sizes="(max-width: 720px) 76vw, 430px"
            />
            <source
              type="image/webp"
              srcSet={`${optimizedMediaRoot}/runwhale-icon-512.webp 512w, ${optimizedMediaRoot}/runwhale-icon-1024.webp 1024w`}
              sizes="(max-width: 720px) 76vw, 430px"
            />
            <Image
              src={`${optimizedMediaRoot}/runwhale-icon-1024.webp`}
              alt={copy.whaleAlt}
              width={1024}
              height={1024}
              sizes="(max-width: 720px) 76vw, 430px"
              fetchPriority="high"
            />
          </picture>
        </ParallaxLayer>
      </section>

      <section className="trust-strip shell" aria-label={copy.trustAria}>
        <span>{copy.trustLabel}</span>
        {copy.capabilities.map((capability, index) => (
          <div className="capability-item" key={capability}>
            <p>{capability}</p>
            {index < copy.capabilities.length - 1 ? <i /> : null}
          </div>
        ))}
      </section>

      <ExamplesSection locale={locale} />

      <section id="demo" className="demo-section shell" aria-labelledby="demo-title">
        <div className="demo-heading">
          <Chip color="accent" variant="soft">{copy.demo.chip}</Chip>
          <h2 id="demo-title">{copy.demo.title}</h2>
          <p>{copy.demo.description}</p>
        </div>

        <div className="demo-spotlight">
          <ParallaxLayer className="demo-video-parallax" amount={18}>
            <figure className="demo-video-card">
              <div className="demo-video-shell">
                <video
                  controls
                  playsInline
                  preload="none"
                  poster={`${optimizedMediaRoot}/runwhale-animal-parade-poster-720.webp`}
                  aria-label={copy.demo.videoAria}
                >
                  <source src={sitePath("/media/demo/RunWhale-demo-readme.mp4")} type="video/mp4" />
                  {copy.demo.videoFallback}
                </video>
              </div>
              <figcaption>{copy.demo.videoCaption}</figcaption>
            </figure>
          </ParallaxLayer>

          <ParallaxLayer className="demo-copy-parallax" amount={12} direction="background">
            <div className="demo-copy">
              <span className="demo-kicker"><Play size={15} fill="currentColor" /> {copy.demo.kicker}</span>
              <h3>{copy.demo.spotlightTitle}</h3>
              <p>{copy.demo.spotlightBody}</p>
              <ol className="demo-outline">
                {copy.demo.outline.map(({ title, body }, index) => (
                  <li key={title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{title}</strong><p>{body}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          </ParallaxLayer>
        </div>

        <div className="demo-gallery-intro">
          <div>
            <p className="gallery-label">{copy.demo.galleryLabel}</p>
            <h3>{copy.demo.galleryTitle}</h3>
          </div>
          <p>{copy.demo.galleryBody}</p>
        </div>

        <div className="demo-gallery">
          {copy.screenshots.map(({ slug, title, alt }, index) => {
            const imageBase = `${optimizedMediaRoot}/${slug}`;

            return (
              <figure key={slug} className="demo-shot" aria-label={`${index + 1}. ${title}`}>
                <div className="demo-shot-image">
                  <picture>
                    <source
                      type="image/avif"
                      srcSet={`${imageBase}-360.avif 360w, ${imageBase}-720.avif 720w`}
                      sizes={workflowScreenshotSizes}
                    />
                    <source
                      type="image/webp"
                      srcSet={`${imageBase}-360.webp 360w, ${imageBase}-720.webp 720w`}
                      sizes={workflowScreenshotSizes}
                    />
                    <Image
                      src={`${imageBase}-720.webp`}
                      alt={alt}
                      width={720}
                      height={1566}
                      sizes={workflowScreenshotSizes}
                    />
                  </picture>
                </div>
                <figcaption>{title}</figcaption>
              </figure>
            );
          })}
        </div>

        <p className="demo-disclosure">{copy.demo.disclosure}</p>
      </section>

      <section id="features" className="section shell">
        <div className="section-heading">
          <Chip variant="soft">{copy.featuresSection.chip}</Chip>
          <h2>{copy.featuresSection.title}<br />{copy.featuresSection.titleSecondLine}</h2>
          <p>{copy.featuresSection.description}</p>
        </div>

        <div className="feature-grid">
          {copy.features.map(({ title, body, meta }, index) => {
            const Icon = featureIcons[index];
            return (
              <Card key={title} className="feature-card">
                <div className="feature-icon"><Icon size={22} /></div>
                <h3>{title}</h3>
                <p>{body}</p>
                <span>{meta}</span>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="workflow" className="workflow shell">
        <div className="workflow-copy">
          <Chip color="accent" variant="soft">{copy.workflow.chip}</Chip>
          <h2>{copy.workflow.title}</h2>
          <p>{copy.workflow.description}</p>
        </div>

        <div className="workflow-steps">
          {copy.workflow.steps.map(({ title, body }, index) => {
            const Icon = workflowIcons[index];
            return (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div className="step-icon"><Icon size={20} /></div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="security" className="security shell">
        <div className="security-mark"><ShieldCheck size={30} /></div>
        <div>
          <Chip color="success" variant="soft">{copy.security.chip}</Chip>
          <h2>{copy.security.title}</h2>
          <p>{copy.security.body}</p>
          <p>{copy.security.credentialBody} <Link className="security-link" href={sitePath(copy.security.privacyHref)}>{copy.security.contextLink}</Link>{locale === "zh-CN" ? "。" : "."}</p>
        </div>
        <ul>
          {copy.security.checks.map((check) => (
            <li key={check}><Check size={15} /> {check}</li>
          ))}
        </ul>
      </section>

      <LatestUpdate locale={locale} />

      <section id="purchase" className="final-cta final-cta-with-purchase shell">
        <div className="final-cta-copy">
          <Image src={`${optimizedMediaRoot}/runwhale-icon-256.webp`} alt="" width={84} height={84} />
          <Chip color="accent" variant="soft">{copy.finalCta.chip}</Chip>
          <h2>{copy.finalCta.title}<br />{copy.finalCta.titleSecondLine}</h2>
          <p>{copy.finalCta.tagline}</p>
          <Link className="primary-cta" href={appStoreUrl} target="_blank" rel="noreferrer">
            <Download size={18} /> {copy.downloadOnAppStore} <ArrowRight size={17} />
          </Link>
          <span className="app-store-price">{copy.appStorePrice}</span>
        </div>
        <PurchaseSummary locale={locale} />
      </section>

      <footer className="footer shell">
        <Link href="#top" className="brand">
          <Image src={`${optimizedMediaRoot}/runwhale-icon-128.webp`} alt="" width={32} height={32} />
          <span>{copy.brand}</span>
        </Link>
        <p>{copy.footer.copyright}</p>
        <nav className="footer-links" aria-label={copy.footer.navAria}>
          <Link href={sitePath(discover.examplesHref)}>{discover.examplesLabel}</Link>
          <Link href={sitePath(discover.updatesHref)}>{discover.updatesLabel}</Link>
          <Link href={sitePath(copy.footer.guideHref)}>{copy.footer.guide}</Link>
          <Link href={sitePath(copy.footer.faqHref)}>{copy.footer.faq}</Link>
          <Link href={sitePath(copy.footer.privacyHref)}>{copy.footer.privacy}</Link>
          <Link href={sitePath(copy.footer.supportHref)}>{copy.footer.support}</Link>
          <Link href={sitePath(copy.languageHref)} hrefLang={locale === "en" ? "zh-CN" : "en-US"}>{copy.languageLabel}</Link>
          <Link href={githubUrl} target="_blank" rel="noreferrer"><GitHubIcon size={15} /> GitHub <ArrowRight size={14} /></Link>
        </nav>
      </footer>
    </main>
  );
}
