import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ContentPage } from "./content-page";
import { discoverCopy } from "./discover-copy";
import type { WebsiteLocale } from "./home-copy";

export function ChangelogPage({ locale }: { locale: WebsiteLocale }) {
  const copy = discoverCopy[locale];
  return (
    <ContentPage locale={locale} languageHref={locale === "en" ? "/zh-CN/changelog" : "/changelog"} eyebrow={copy.updatesLabel} title={copy.updates.title} summary={copy.updates.summary} updated={copy.updated} updatedIso="2026-09-05" activeResource="changelog">
      {copy.updates.entries.map((entry, index) => (
        <section className="changelog-entry" id={entry.id} key={entry.id} aria-labelledby={`update-${entry.id}`}>
          <div className="changelog-meta"><time dateTime={entry.id}>{entry.date}</time><span>{copy.updates.website}</span></div>
          <h2 id={`update-${entry.id}`}>{entry.title}</h2>
          <p>{entry.summary}</p>
          <ul>{entry.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          {index === 0 ? <Link className="examples-guide-link" href={copy.examplesHref}>{copy.examples.all}<ArrowRight size={17} aria-hidden="true" /></Link> : null}
        </section>
      ))}
    </ContentPage>
  );
}
