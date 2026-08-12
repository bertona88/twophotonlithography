import type { Metadata } from "next";
import { JsonLd, SiteFooter, SiteHeader } from "./site-chrome";
import { absoluteUrl, pageMetadata, SITE_NAME, SITE_URL } from "./site-config";

export const metadata: Metadata = pageMetadata({
  title: "Two-Photon Lithography Simulator | Interactive 3D Lab",
  description:
    "Explore two-photon lithography through an interactive 3D simulator connecting femtosecond focusing, scan paths, reaction–diffusion chemistry, and development.",
  path: "/",
});

const guideLinks = [
  {
    number: "01",
    title: "Two-photon lithography",
    text: "The core process, from nonlinear absorption to a developed three-dimensional structure.",
    href: "/guides/two-photon-lithography",
    terms: "TPL · 2PP · TPP",
  },
  {
    number: "02",
    title: "Multiphoton lithography",
    text: "The broader family of confined nonlinear fabrication methods—and where two-photon writing fits.",
    href: "/guides/multiphoton-lithography",
    terms: "MPL · MPP · MP3DL",
  },
  {
    number: "03",
    title: "The model space",
    text: "Compare dose thresholds, focal-field models, chemical kinetics, transport, and development.",
    href: "/guides/model-space",
    terms: "Optics · chemistry · transport",
  },
  {
    number: "04",
    title: "Parameter atlas",
    text: "An intuitive explanation of every path, light, resin, and development control in the lab.",
    href: "/guides/parameters",
    terms: "Power · speed · NA · oxygen",
  },
];

export default function HomePage() {
  return (
    <div className="seo-site home-page">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: SITE_URL,
            description:
              "An interactive field guide and mechanistic simulator for two-photon and multiphoton lithography.",
          },
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Two-Photon Lithography Lab",
            url: absoluteUrl("/lab"),
            applicationCategory: "EducationalApplication",
            operatingSystem: "Web browser",
            description:
              "Interactive 3D simulation of focused exposure, reaction–diffusion chemistry, and development in two-photon lithography.",
          },
        ]}
      />
      <SiteHeader />

      <main>
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="site-kicker">Interactive field guide · mechanistic lab</span>
            <h1 id="home-title">Two-photon lithography, made visible.</h1>
            <p>
              Follow focused femtosecond light through nonlinear exposure,
              radical chemistry, oxygen inhibition, gelation, and development—then
              change the parameters yourself.
            </p>
            <div className="home-actions">
              <a className="primary-action" href="/lab">
                Open the 3D lab <span aria-hidden="true">↗</span>
              </a>
              <a href="/guides">Explore the field guides</a>
            </div>
          </div>

          <div className="focal-atlas" aria-label="Stylized two-photon focal volume and voxel field">
            <div className="focal-pupil" />
            <div className="focal-cone" />
            <div className="focal-volume"><i /></div>
            <div className="voxel-plane">
              {Array.from({ length: 28 }).map((_, index) => (
                <i key={index} style={{ "--voxel-index": index } as React.CSSProperties} />
              ))}
            </div>
            <span className="focal-label focal-label-light">FOCUSED FIELD</span>
            <span className="focal-label focal-label-matter">CALCULATED MATTER</span>
          </div>
        </section>

        <section className="home-terms" aria-labelledby="terms-title">
          <div>
            <span className="site-kicker">One field · overlapping vocabulary</span>
            <h2 id="terms-title">TPL. 2PP. TPP. MPL. DLW.</h2>
          </div>
          <div className="home-terms-copy">
            <p>
              Two-photon lithography and two-photon polymerization often name
              the same resin-based process from different angles. Multiphoton
              lithography is the wider family. Direct laser writing is wider
              still—and is not always multiphoton.
            </p>
            <a href="/guides/two-photon-lithography">
              Map the terminology <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section className="home-guides" aria-labelledby="guides-title">
          <header>
            <span className="site-kicker">Learn by following the causal chain</span>
            <h2 id="guides-title">A field guide, not a keyword list.</h2>
          </header>
          <div className="guide-link-list">
            {guideLinks.map((guide) => (
              <a href={guide.href} key={guide.href}>
                <span className="guide-link-number">{guide.number}</span>
                <span className="guide-link-copy">
                  <strong>{guide.title}</strong>
                  <small>{guide.text}</small>
                </span>
                <span className="guide-link-terms">{guide.terms}</span>
                <span className="guide-link-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>

        <section className="home-model" aria-labelledby="model-title">
          <div className="model-chain" aria-hidden="true">
            <span>Geometry</span><i />
            <span>Field</span><i />
            <span>Radicals</span><i />
            <span>Conversion</span><i />
            <span>Development</span>
          </div>
          <div className="home-model-copy">
            <span className="site-kicker">A model you can interrogate</span>
            <h2 id="model-title">The voxel is a consequence, not a stamp.</h2>
            <p>
              The lab does not paint the intended geometry as a cured result.
              A vectorial focal field drives a timed scan history; chemical
              fields evolve in the volume; development removes what the model
              predicts cannot resist the bath.
            </p>
            <div className="inline-links">
              <a href="/guides/model-space">Compare model families →</a>
              <a href="/method">Read the exact equations →</a>
            </div>
          </div>
        </section>

        <section className="home-parameters" aria-labelledby="parameters-title">
          <header>
            <span className="site-kicker">Turn one control · trace every consequence</span>
            <h2 id="parameters-title">What changes what?</h2>
          </header>
          <div className="parameter-preview">
            <a href="/guides/parameters#power"><span>P</span><strong>Power</strong><small>Stronger nonlinear source</small></a>
            <a href="/guides/parameters#speed"><span>v</span><strong>Scan speed</strong><small>More or less dwell time</small></a>
            <a href="/guides/parameters#na"><span>NA</span><strong>Numerical aperture</strong><small>Tighter focal concentration</small></a>
            <a href="/guides/parameters#oxygen"><span>o₀</span><strong>Oxygen</strong><small>A chemical brake</small></a>
          </div>
          <a className="text-action" href="/guides/parameters">
            Understand all 27 parameters <span aria-hidden="true">↗</span>
          </a>
        </section>

        <section className="home-final" aria-labelledby="final-title">
          <span className="site-kicker">From intuition to counterfactual</span>
          <h2 id="final-title">Change the light. Watch the chemistry answer.</h2>
          <a className="primary-action" href="/lab">Enter the laboratory <span aria-hidden="true">↗</span></a>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
