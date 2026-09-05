import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, PlayCircle } from "lucide-react";
import { ContentPage } from "./content-page";
import { helpCopy, type GuideScreenshot } from "./help-copy";
import type { WebsiteLocale } from "./home-copy";

const githubUrl = "https://github.com/zhiqingchen/RunWhale";
const screenshotSizes = "(max-width: 720px) calc(100vw - 48px), (max-width: 1100px) 42vw, 430px";

function WorkflowScreenshot({
  screenshot,
}: {
  screenshot: GuideScreenshot;
}) {
  return (
    <figure className="guide-shot">
      <picture>
        <source
          type="image/avif"
          srcSet={screenshot.avifSrcSet}
          sizes={screenshotSizes}
        />
        <source
          type="image/webp"
          srcSet={screenshot.webpSrcSet}
          sizes={screenshotSizes}
        />
        <Image
          src={screenshot.fallbackSrc}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          sizes={screenshotSizes}
          loading="lazy"
        />
      </picture>
      <figcaption>{screenshot.title}</figcaption>
    </figure>
  );
}

export function GuidePage({ locale }: { locale: WebsiteLocale }) {
  const copy = helpCopy[locale];
  const guide = copy.guide;
  const isChinese = locale === "zh-CN";
  const paths = {
    language: isChinese ? "/guide" : "/zh-CN/guide",
    faq: isChinese ? "/zh-CN/faq" : "/faq",
    support: isChinese ? "/zh-CN/support" : "/support",
    privacy: isChinese ? "/zh-CN/privacy" : "/privacy",
  };

  return (
    <ContentPage
      locale={locale}
      languageHref={paths.language}
      eyebrow={guide.eyebrow}
      title={guide.title}
      summary={guide.summary}
      updated={copy.updatedLabel}
      updatedIso={copy.updatedIso}
      activeResource="guide"
      wide
    >
      <section className="guide-start" aria-labelledby="guide-start-title">
        <div className="content-section-heading">
          <h2 id="guide-start-title">{guide.startTitle}</h2>
          <p>{guide.startBody}</p>
        </div>
        <div className="guide-prerequisites">
          {guide.prerequisites.map((item) => (
            <article key={item.title}>
              <CheckCircle2 aria-hidden="true" size={20} />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-workflow" aria-labelledby="guide-workflow-title">
        <div className="content-section-heading">
          <p className="content-section-label">{guide.workflowLabel}</p>
          <h2 id="guide-workflow-title">{guide.workflowTitle}</h2>
          <p>{guide.workflowBody}</p>
        </div>
        <ol className="guide-steps" role="list">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="guide-step">
              <article>
                <span className="guide-step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="guide-step-copy">
                  <p className="guide-step-action">{step.action}</p>
                  <h3>{step.title}</h3>
                  {step.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-gallery" aria-labelledby="guide-gallery-title">
        <div className="content-section-heading guide-gallery-heading">
          <p className="content-section-label">{guide.galleryLabel}</p>
          <h2 id="guide-gallery-title">{guide.galleryTitle}</h2>
          <p>{guide.galleryBody}</p>
        </div>
        <div className="guide-gallery-track">
          {guide.screenshots.map((screenshot) => (
            <WorkflowScreenshot key={screenshot.id} screenshot={screenshot} />
          ))}
        </div>
      </section>

      <section className="guide-video" aria-labelledby="guide-video-title">
        <div className="guide-video-copy">
          <p className="guide-video-label"><PlayCircle aria-hidden="true" size={17} /> {guide.videoLabel}</p>
          <h2 id="guide-video-title">{guide.videoTitle}</h2>
          <p>{guide.videoBody}</p>
          <p className="guide-disclosure">{guide.disclosure}</p>
        </div>
        <figure className="guide-video-card">
          <div className="guide-video-shell">
            <video
              controls
              playsInline
              preload="none"
              poster={guide.videoPoster}
              aria-label={guide.videoAria}
            >
              <source src={guide.videoSrc} type="video/mp4" />
              {guide.videoFallback}
            </video>
          </div>
          <figcaption>{guide.videoCaption}</figcaption>
        </figure>
      </section>

      <section className="guide-next" aria-labelledby="guide-next-title">
        <div className="content-section-heading">
          <h2 id="guide-next-title">{guide.nextTitle}</h2>
        </div>
        <div className="guide-next-grid">
          <Link href={paths.faq}>
            <strong>{guide.nextLinks.faq.title}</strong>
            <span>{guide.nextLinks.faq.body}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          <Link href={paths.support}>
            <strong>{guide.nextLinks.support.title}</strong>
            <span>{guide.nextLinks.support.body}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          <Link href={paths.privacy}>
            <strong>{guide.nextLinks.privacy.title}</strong>
            <span>{guide.nextLinks.privacy.body}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            <strong>{guide.nextLinks.github.title}</strong>
            <span>{guide.nextLinks.github.body}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </a>
        </div>
      </section>
    </ContentPage>
  );
}
