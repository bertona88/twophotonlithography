import type { Metadata } from "next";
import { JsonLd, SiteFooter, SiteHeader } from "../site-chrome";
import { absoluteUrl, pageMetadata } from "../site-config";

export const metadata: Metadata = pageMetadata({
  title: "Two-Photon and Multiphoton Lithography Guides",
  description:
    "Scientific guides to two-photon polymerization, multiphoton lithography, direct laser writing, simulation models, and process parameters.",
  path: "/guides",
});

const guides = [
  {
    number: "01",
    title: "Two-photon lithography",
    subtitle: "The core process",
    description:
      "Understand two-photon absorption, photopolymerization, the voxel, scan paths, and development—and how TPL, 2PP, and TPP relate.",
    href: "/guides/two-photon-lithography",
  },
  {
    number: "02",
    title: "Multiphoton lithography",
    subtitle: "The wider family",
    description:
      "Place two-photon writing inside multiphoton 3D lithography and separate mechanism-specific terms from broader fabrication language.",
    href: "/guides/multiphoton-lithography",
  },
  {
    number: "03",
    title: "Direct laser writing",
    subtitle: "The umbrella method",
    description:
      "Learn when DLW means two-photon polymerization, when it does not, and why the distinction matters for models and search terminology.",
    href: "/guides/direct-laser-writing",
  },
  {
    number: "04",
    title: "The model space",
    subtitle: "From threshold to transport",
    description:
      "Compare optical, dose, kinetic, reaction–diffusion, development, mechanical, and calibrated models of the fabrication process.",
    href: "/guides/model-space",
  },
  {
    number: "05",
    title: "Parameter atlas",
    subtitle: "Every control, intuitively",
    description:
      "Trace all 26 path, light, resin, and development parameters through their expected effects, interactions, and model boundaries.",
    href: "/guides/parameters",
  },
  {
    number: "06",
    title: "Inside the calculated voxel",
    subtitle: "The exact implementation",
    description:
      "Read the equations, evidence boundaries, primary references, and explicit limitations of the model running in the browser lab.",
    href: "/method",
  },
];

export default function GuidesPage() {
  return (
    <div className="seo-site guides-index-page">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Two-Photon and Multiphoton Lithography Guides",
          url: absoluteUrl("/guides"),
          hasPart: guides.map((guide) => ({
            "@type": "Article",
            name: guide.title,
            url: absoluteUrl(guide.href),
          })),
        }}
      />
      <SiteHeader />
      <main>
        <header className="guides-index-hero">
          <div>
            <span className="site-kicker">Scientific field guides · 01—06</span>
            <h1>Follow the light into matter.</h1>
          </div>
          <p>
            A connected guide to two-photon lithography, two-photon
            polymerization, multiphoton fabrication, direct laser writing, and
            the models used to reason about them.
          </p>
        </header>

        <section className="guides-index-list" aria-label="Available guides">
          {guides.map((guide) => (
            <a href={guide.href} key={guide.href}>
              <span className="guides-index-number">{guide.number}</span>
              <span className="guides-index-title">
                <small>{guide.subtitle}</small>
                <strong>{guide.title}</strong>
              </span>
              <span className="guides-index-description">{guide.description}</span>
              <span className="guides-index-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </section>

        <section className="guides-index-cta">
          <span className="site-kicker">Theory becomes legible through perturbation</span>
          <h2>Every guide leads back to the same evolving volume.</h2>
          <a className="primary-action" href="/lab">Open the simulator ↗</a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
