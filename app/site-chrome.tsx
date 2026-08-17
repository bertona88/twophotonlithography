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
    <svg
      className="site-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#08080f" stroke="#34213a" />
      <path d="M4.5 5.5h23L17.4 20h-2.8L4.5 5.5Z" fill="#ff4052" fillOpacity="0.24" />
      <path d="M8 6.5h16L17 19h-2L8 6.5Z" fill="#ff4052" fillOpacity="0.62" />
      <path d="M5.5 5.5h21" stroke="#ff6877" strokeOpacity="0.9" />
      <ellipse cx="16" cy="23" rx="2.75" ry="4.5" fill="#8b5cff" stroke="#c9b8ff" />
      <ellipse cx="16" cy="23" rx="1" ry="2.2" fill="#d9ceff" />
    </svg>
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
        <a
          href="https://wofi.ai/ideas/sha256%3A182f6bf27b400b724d6e77e5a7d10d1d402dede3b5dbcaebb979a897bf74ad2e"
          target="_blank"
          rel="noreferrer"
        >
          WOFI Idea <span aria-hidden="true">↗</span>
        </a>
        <a href="/wofi.json">Provenance</a>
        <a href="/LICENSE.txt">License</a>
        <a
          href="https://github.com/bertona88/twophotonlithography"
          target="_blank"
          rel="noreferrer"
        >
          View source on GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </footer>
  );
}
