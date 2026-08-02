import type { ReactNode } from "react";
import { JsonLd, SiteFooter, SiteHeader } from "../site-chrome";
import { absoluteUrl, SITE_NAME } from "../site-config";

type GuideSectionLink = {
  id: string;
  label: string;
};

export function GuidePage({
  eyebrow,
  title,
  description,
  path,
  readTime,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  path: string;
  readTime: string;
  sections: GuideSectionLink[];
  children: ReactNode;
}) {
  const url = absoluteUrl(path);
  return (
    <div className="seo-site guide-page">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: title,
            description,
            mainEntityOfPage: url,
            datePublished: "2026-08-02",
            dateModified: "2026-08-02",
            author: {
              "@type": "Organization",
              name: SITE_NAME,
              url: absoluteUrl("/"),
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
              { "@type": "ListItem", position: 2, name: "Guides", item: absoluteUrl("/guides") },
              { "@type": "ListItem", position: 3, name: title, item: url },
            ],
          },
        ]}
      />
      <SiteHeader />
      <main>
        <header className="guide-hero">
          <div className="guide-hero-copy">
            <span className="site-kicker">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
            <div className="guide-meta">
              <span>Field guide</span>
              <span>{readTime}</span>
              <time dateTime="2026-08-02">Updated 02 Aug 2026</time>
            </div>
          </div>
          <div className="guide-hero-index" aria-hidden="true">
            <span>{String(sections.length).padStart(2, "0")}</span>
            <small>causal sections</small>
            <i />
          </div>
        </header>

        <div className="guide-layout">
          <aside className="guide-index">
            <span>On this page</span>
            <nav aria-label="Guide sections">
              {sections.map((section) => (
                <a href={`#${section.id}`} key={section.id}>{section.label}</a>
              ))}
            </nav>
            <a className="guide-index-lab" href="/lab">Open the lab ↗</a>
          </aside>
          <article className="guide-prose">{children}</article>
        </div>

        <section className="guide-end">
          <span className="site-kicker">Continue through the causal chain</span>
          <h2>Read the field. Then perturb the model.</h2>
          <div>
            <a href="/guides">All guides</a>
            <a className="primary-action" href="/lab">Open the 3D lab ↗</a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export function GuideSection({
  id,
  number,
  title,
  children,
  featured = false,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
  featured?: boolean;
}) {
  return (
    <section className={`guide-section ${featured ? "guide-section-featured" : ""}`} id={id}>
      <span className="guide-section-number">{number}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function GuideCallout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="guide-callout">
      <span>{label}</span>
      <div>{children}</div>
    </aside>
  );
}

export function GuideSources({
  sources,
}: {
  sources: { title: string; detail: string; href: string }[];
}) {
  return (
    <ol className="guide-sources">
      {sources.map((source, index) => (
        <li key={source.href}>
          <a href={source.href} target="_blank" rel="noreferrer">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <span><strong>{source.title}</strong><small>{source.detail}</small></span>
            <i aria-hidden="true">↗</i>
          </a>
        </li>
      ))}
    </ol>
  );
}
