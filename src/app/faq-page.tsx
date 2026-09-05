import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { ContentPage } from "./content-page";
import { helpCopy } from "./help-copy";
import type { WebsiteLocale } from "./home-copy";

export function FaqPage({ locale }: { locale: WebsiteLocale }) {
  const copy = helpCopy[locale];
  const faq = copy.faq;
  const isChinese = locale === "zh-CN";
  const guideHref = isChinese ? "/zh-CN/guide" : "/guide";
  const supportHref = isChinese ? "/zh-CN/support" : "/support";
  const languageHref = isChinese ? "/faq" : "/zh-CN/faq";
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: isChinese ? "zh-CN" : "en-US",
    mainEntity: faq.groups.flatMap((group) => group.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer.join("\n\n"),
      },
    }))),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <ContentPage
        locale={locale}
        languageHref={languageHref}
        eyebrow={faq.eyebrow}
        title={faq.title}
        summary={faq.summary}
        updated={copy.updatedLabel}
        updatedIso={copy.updatedIso}
        activeResource="faq"
      >
        <p className="faq-intro">{faq.intro}</p>
        <div className="faq-groups">
          {faq.groups.map((group) => (
            <section className="faq-group" key={group.title} aria-labelledby={`faq-${group.items[0].id}`}>
              <h2 id={`faq-${group.items[0].id}`}>{group.title}</h2>
              <div className="faq-list">
                {group.items.map((item) => (
                  <details className="faq-item" id={item.id} key={item.id}>
                    <summary>
                      <span>{item.question}</span>
                      <ChevronDown aria-hidden="true" size={20} />
                    </summary>
                    <div className="faq-answer">
                      {item.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="faq-more" aria-labelledby="faq-more-title">
          <div>
            <h2 id="faq-more-title">{faq.moreTitle}</h2>
            <p>{faq.moreBody}</p>
          </div>
          <div className="faq-more-actions">
            <Link href={guideHref}>{faq.guideLabel} <ArrowRight aria-hidden="true" size={16} /></Link>
            <Link href={supportHref}>{faq.supportLabel} <ArrowRight aria-hidden="true" size={16} /></Link>
          </div>
        </section>
      </ContentPage>
    </>
  );
}
