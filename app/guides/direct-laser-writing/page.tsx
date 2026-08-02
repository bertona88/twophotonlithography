import type { Metadata } from "next";
import { pageMetadata } from "../../site-config";
import { GuideCallout, GuidePage, GuideSection, GuideSources } from "../guide-shell";

export const metadata: Metadata = pageMetadata({
  title: "Direct Laser Writing vs Two-Photon Lithography",
  description:
    "Learn how direct laser writing relates to two-photon polymerization, multiphoton lithography, femtosecond laser writing, and 3D microfabrication.",
  path: "/guides/direct-laser-writing",
  type: "article",
});

const sections = [
  { id: "definition", label: "Definition" },
  { id: "comparison", label: "Method comparison" },
  { id: "writing", label: "What is written" },
  { id: "femtosecond", label: "Femtosecond writing" },
  { id: "language", label: "Using the term" },
  { id: "sources", label: "Sources" },
];

export default function DirectLaserWritingGuide() {
  return (
    <GuidePage
      eyebrow="Guide 03 · Umbrella method"
      title="Direct laser writing vs two-photon lithography"
      description="Direct laser writing describes how a focused beam places a pattern. Two-photon lithography additionally specifies a nonlinear excitation mechanism."
      path="/guides/direct-laser-writing"
      readTime="7 min read"
      sections={sections}
    >
      <GuideSection id="definition" number="01 / Definition" title="Writing directly with a focused beam" featured>
        <p className="guide-lede">
          Direct laser writing is a maskless fabrication approach in which a
          focused laser is moved—or optically addressed—to create a spatially
          controlled material modification.
        </p>
        <p>
          The phrase identifies the writing architecture, not a single chemistry.
          Depending on the material and wavelength, the modification can arise
          from linear absorption, two-photon absorption, higher-order excitation,
          heating, ablation, refractive-index change, polymerization, or another
          response.
        </p>
      </GuideSection>

      <GuideSection id="comparison" number="02 / Comparison" title="The terms overlap without collapsing into one another">
        <div className="comparison-table-wrap">
          <table className="guide-table">
            <thead><tr><th>Term</th><th>Specifies</th><th>Does not guarantee</th></tr></thead>
            <tbody>
              <tr><th>Direct laser writing</th><td>A focused beam directly places a pattern.</td><td>A particular photon order or polymer chemistry.</td></tr>
              <tr><th>Femtosecond laser writing</th><td>Ultrashort pulses are used for writing.</td><td>That the response is polymerization.</td></tr>
              <tr><th>Multiphoton lithography</th><td>Nonlinear multiphoton excitation drives patterning.</td><td>Exactly two-photon absorption.</td></tr>
              <tr><th>Two-photon polymerization</th><td>Two-photon excitation initiates polymer formation.</td><td>A universal resin or process window.</td></tr>
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="writing" number="03 / Writing" title="A trajectory is also a time history">
        <p>
          “Writing” can sound geometric, as though the laser were a pen with a
          fixed nib. In a photosensitive volume, each path sample also determines
          when energy arrives. Adjacent exposures overlap; long jumps create dark
          time; repeated passes revisit chemistry that has already evolved.
        </p>
        <p>
          This is why two geometrically identical paths can produce different
          structures when power, speed, pulse statistics, or inter-pass timing
          changes. The writing strategy is part of the physical model rather than
          a neutral file-transfer step.
        </p>
      </GuideSection>

      <GuideSection id="femtosecond" number="04 / Pulses" title="Femtosecond does not automatically mean two-photon">
        <p>
          Femtosecond pulses can reach high peak intensity while maintaining a
          moderate average power, making nonlinear excitation practical. But pulse
          duration alone does not identify the material pathway. The absorption
          spectrum, focal intensity, pulse energy, repetition rate, and available
          intermediate states all matter.
        </p>
        <GuideCallout label="Useful distinction">
          <p>
            Use “two-photon direct laser writing” when both the scanned writing
            method and two-photon mechanism are relevant. Use the broader “direct
            laser writing” when the mechanism is unknown, variable, or explicitly
            outside the scope.
          </p>
        </GuideCallout>
      </GuideSection>

      <GuideSection id="language" number="05 / Language" title="Choose the narrowest term supported by the evidence">
        <p>
          Terminology should communicate what is known. A process can be described
          as direct laser writing from its architecture alone. Calling it
          two-photon polymerization makes an additional statement about excitation
          and chemistry. Calling it multiphoton lithography places it in a broader
          nonlinear family without fixing the photon order.
        </p>
        <a className="guide-text-link" href="/guides/two-photon-lithography">Continue to the two-photon process →</a>
      </GuideSection>

      <GuideSection id="sources" number="06 / Sources" title="Representative sources">
        <GuideSources sources={[
          { title: "Direct-laser writing for subnanometer focusing and single-molecule imaging", detail: "Nature Communications · 2022", href: "https://doi.org/10.1038/s41467-022-28219-6" },
          { title: "Multiphoton 3D lithography", detail: "Nature Reviews Methods Primers · 2025", href: "https://doi.org/10.1038/s43586-025-00386-y" },
          { title: "Three-dimensional optical laser lithography beyond the diffraction limit", detail: "Fischer & Wegener · Laser & Photonics Reviews · 2013", href: "https://doi.org/10.1002/lpor.201100046" },
        ]} />
      </GuideSection>
    </GuidePage>
  );
}
