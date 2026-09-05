import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Play } from "lucide-react";
import type { WebsiteLocale } from "./home-copy";
import { discoverCopy } from "./discover-copy";

export function PurchaseSummary({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale].purchase;
  const prefix = locale === "en" ? "" : "/zh-CN";
  return (
    <aside className="purchase-summary" aria-labelledby="purchase-title">
      <h2 id="purchase-title">{copy.title}</h2>
      <p>{copy.summary}</p>
      <dl>
        {copy.items.map((item) => (
          <div key={item.title}>
            <dt><Check size={16} aria-hidden="true" />{item.title}</dt>
            <dd>{item.body}</dd>
          </div>
        ))}
      </dl>
      <div className="purchase-links">
        <Link href={`${prefix}/guide`}>{copy.guide}<ArrowRight size={14} aria-hidden="true" /></Link>
        <Link href={`${prefix}/faq#import-repository`}>{copy.limits}</Link>
      </div>
    </aside>
  );
}

export function ExampleCards({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale];
  return (
    <div className="example-grid">
      {copy.examples.cases.map((example) => (
        <Link className="example-card" href={`${copy.examplesHref}#${example.id}`} key={example.id}>
          <div className="example-card-image">
            <Image src={example.image} alt={example.imageAlt} width={example.width} height={example.height} sizes="(max-width: 720px) 46vw, 210px" />
          </div>
          <div className="example-card-copy">
            <span className="example-category">{example.category}</span>
            <h3>{example.title}</h3>
            <p>{example.description}</p>
            <span className="example-card-action"><Play size={16} aria-hidden="true" />{copy.examples.all}<ArrowRight size={16} aria-hidden="true" /></span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ExamplesSection({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale];
  return (
    <section id="examples" className="examples-section shell" aria-labelledby="examples-title">
      <div className="discovery-heading">
        <span className="discovery-label">{copy.examplesLabel}</span>
        <h2 id="examples-title">{copy.examples.title}</h2>
        <p>{copy.examples.summary}</p>
      </div>
      <ExampleCards locale={locale} />
    </section>
  );
}

export function LatestUpdate({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale];
  const latest = copy.updates.entries[0];
  return (
    <section className="latest-update shell" aria-labelledby="latest-update-title">
      <div className="latest-update-meta">
        <span className="discovery-label">{copy.updates.latest}</span>
        <time dateTime={latest.id}>{latest.date}</time>
      </div>
      <div>
        <h2 id="latest-update-title">{latest.title}</h2>
        <p>{latest.summary}</p>
      </div>
      <Link href={`${copy.updatesHref}#${latest.id}`}>{copy.updates.all}<ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
  );
}
