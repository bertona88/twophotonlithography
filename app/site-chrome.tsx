import Link from "next/link";
import { SITE_NAME } from "./site-config";

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export function SiteMark() {
  return (
    <span className="site-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/" aria-label={`${SITE_NAME} home`}>
        <SiteMark />
        <span>
          <strong>two·photon</strong>
          <small>lithography field guide</small>
        </span>
      </Link>
      <nav className="site-links" aria-label="Primary navigation">
        <a href="/guides">Guides</a>
        <a href="/method">Model</a>
        <a className="site-launch" href="/lab">
          Open lab <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="site-brand" href="/">
        <SiteMark />
        <span>
          <strong>two·photon</strong>
          <small>causal lithography lab</small>
        </span>
      </Link>
      <p>
        An educational model of focused light, reaction–diffusion chemistry,
        and development. It is not a calibrated process certificate.
      </p>
      <nav aria-label="Footer navigation">
        <a href="/guides/parameters">Parameters</a>
        <a href="/guides/model-space">Model space</a>
        <a href="/method">References</a>
      </nav>
    </footer>
  );
}
