import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { ContentPage } from "./content-page";
import { CopyPrompt } from "./copy-prompt";
import { discoverCopy } from "./discover-copy";
import type { WebsiteLocale } from "./home-copy";

export function ExamplesPage({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale];
  const examples = copy.examples;
  const guideHref = locale === "en" ? "/guide" : "/zh-CN/guide";
  return (
    <ContentPage locale={locale} languageHref={locale === "en" ? "/zh-CN/examples" : "/examples"} eyebrow={copy.examplesLabel} title={examples.title} summary={examples.summary} updated={copy.updated} updatedIso="2026-09-05" activeResource="examples" wide>
      <p className="examples-intro">{examples.steps} <Link href={guideHref}>{examples.guide}</Link></p>
      {examples.cases.map((example) => (
        <section className="example-detail" id={example.id} key={example.id} aria-labelledby={`${example.id}-title`}>
          <figure className="example-detail-figure">
            <Image src={example.image} alt={example.imageAlt} width={example.width} height={example.height} sizes="(max-width: 720px) 80vw, 300px" />
            <figcaption><a href={example.video}><Play size={16} aria-hidden="true" />{examples.watch}</a></figcaption>
          </figure>
          <div className="example-detail-copy">
            <span className="example-category">{example.category}</span>
            <h2 id={`${example.id}-title`}>{example.title}</h2>
            <p>{example.description}</p>
            <h3>{example.original ? examples.originalPrompt : examples.suggestedPrompt}</h3>
            <CopyPrompt prompt={example.prompt} label={examples.copy} copiedLabel={examples.copied} errorLabel={examples.copyError} />
          </div>
        </section>
      ))}
      <p className="examples-note">{examples.note}</p>
      <section className="example-ideas" aria-labelledby="example-ideas-title">
        <h2 id="example-ideas-title">{examples.ideasTitle}</h2>
        <p>{examples.ideasBody}</p>
        <div className="idea-grid">
          {examples.ideas.map((idea) => (
            <article className="idea-card" key={idea.title}>
              <span className="example-category">{idea.category}</span>
              <h3>{idea.title}</h3>
              <CopyPrompt prompt={idea.prompt} label={examples.copy} copiedLabel={examples.copied} errorLabel={examples.copyError} />
            </article>
          ))}
        </div>
        <Link className="examples-guide-link" href={guideHref}>{examples.guide}<ArrowRight size={17} aria-hidden="true" /></Link>
      </section>
    </ContentPage>
  );
}
