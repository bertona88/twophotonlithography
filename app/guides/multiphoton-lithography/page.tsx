import type { Metadata } from "next";
import { pageMetadata } from "../../site-config";
import { GuideCallout, GuidePage, GuideSection, GuideSources } from "../guide-shell";

export const metadata: Metadata = pageMetadata({
  title: "Multiphoton Lithography and Multiphoton Polymerization Explained",
  description:
    "Understand multiphoton lithography, multiphoton polymerization, MP3DL, and how the broader nonlinear fabrication family relates to two-photon lithography.",
  path: "/guides/multiphoton-lithography",
  type: "article",
});

const sections = [
  { id: "family", label: "The larger family" },
  { id: "relationship", label: "Relation to 2PP" },
  { id: "confinement", label: "Why it confines" },
  { id: "workflow", label: "Shared workflow" },
  { id: "terms", label: "Terminology" },
  { id: "model", label: "Model boundary" },
  { id: "sources", label: "Sources" },
];

export default function MultiphotonGuide() {
  return (
    <GuidePage
      eyebrow="Guide 02 · Wider family"
      title="Multiphoton lithography"
      description="Two-photon writing is the best-known member of a broader family of three-dimensional fabrication methods driven by spatially confined nonlinear light–matter interactions."
      path="/guides/multiphoton-lithography"
      readTime="8 min read"
      sections={sections}
    >
      <GuideSection id="family" number="01 / Family" title="A broad category of nonlinear 3D fabrication" featured>
        <p className="guide-lede">
          Multiphoton lithography uses an intense, localized optical field to
          drive a material response whose probability rises nonlinearly with light
          intensity.
        </p>
        <p>
          The phrase is useful because it describes a family rather than insisting
          that every exposure follows one identical microscopic route. The material
          response may be polymerization, crosslinking, bond cleavage, photoacid
          generation, or another persistent modification. The common idea is that
          nonlinear excitation confines useful processing around the illuminated
          region.
        </p>
      </GuideSection>

      <GuideSection id="relationship" number="02 / Relationship" title="Two-photon lithography is a subset, not a competing name">
        <div className="scope-rings" aria-label="Relationship among direct laser writing, multiphoton lithography, and two-photon polymerization">
          <div><span>Direct laser writing</span><div><span>Multiphoton lithography</span><div><span>Two-photon polymerization</span></div></div></div>
        </div>
        <p>
          Two-photon lithography specifies a two-photon excitation picture.
          Multiphoton lithography leaves the excitation order broader. Direct
          laser writing specifies the spatial writing method and can also include
          linear absorption or non-polymer material modification.
        </p>
        <GuideCallout label="Search-language boundary">
          <p>
            A page about multiphoton lithography should explain the broader family.
            Repeating a two-photon definition under a different title would add no
            scientific value and would create competing, near-duplicate pages.
          </p>
        </GuideCallout>
      </GuideSection>

      <GuideSection id="confinement" number="03 / Confinement" title="Nonlinearity changes the exposed volume">
        <p>
          For an idealized <em>n</em>-photon process, the excitation source scales
          approximately with the local intensity raised to the power <em>n</em>.
          Regions below the peak shrink disproportionately as the order increases.
          A subsequent material threshold can confine the persistent modification
          further still.
        </p>
        <div className="equation-comparison">
          <div><span>Linear source</span><code>s ∝ I</code></div>
          <div><span>Two-photon source</span><code>s ∝ I²</code></div>
          <div><span>General multiphoton source</span><code>s ∝ Iⁿ</code></div>
        </div>
        <p>
          This compact scaling is an intuition, not a complete material model.
          Saturation, depletion, sequential states, diffusion, inhibition, and
          thermal effects can all change the observed response.
        </p>
      </GuideSection>

      <GuideSection id="workflow" number="04 / Workflow" title="The fabrication chain remains recognizably similar">
        <p>
          Most scanning implementations still require a digital geometry, a
          trajectory, a focused ultrafast field, a photosensitive material, and a
          post-exposure step. Parallel or projection strategies can modify how
          exposure is delivered, but they do not remove the need to connect optical
          excitation to a persistent material change.
        </p>
        <div className="concept-equation">
          <span>ultrafast field</span><i>→</i><span>nonlinear excitation</span><i>→</i><span>material response</span><i>→</i><span>3D structure</span>
        </div>
      </GuideSection>

      <GuideSection id="terms" number="05 / Terms" title="MPL, MPP and MP3DL foreground different parts of the same family">
        <div className="term-map">
          <div><strong>Multiphoton lithography</strong><span>MPL</span><p>Broad patterning term.</p></div>
          <div><strong>Multiphoton polymerization</strong><span>MPP</span><p>Specifies polymer-forming chemistry.</p></div>
          <div><strong>Multiphoton 3D lithography</strong><span>MP3DL</span><p>Explicitly identifies true three-dimensional fabrication.</p></div>
          <div><strong>Multiphoton fabrication</strong><span>MPF</span><p>Broad application language across materials.</p></div>
        </div>
      </GuideSection>

      <GuideSection id="model" number="06 / Model" title="This lab currently models the two-photon branch">
        <p>
          The interactive laboratory uses a two-photon source proportional to
          squared local intensity. It does not expose an adjustable photon order
          or claim to represent every multiphoton mechanism. The wider vocabulary
          belongs in the field guide; the narrower mechanism belongs in the model
          contract.
        </p>
        <a className="guide-text-link" href="/guides/model-space">See where this model sits →</a>
      </GuideSection>

      <GuideSection id="sources" number="07 / Sources" title="Sources for the broader field">
        <GuideSources sources={[
          { title: "Multiphoton 3D lithography", detail: "Skliutas et al. · Nature Reviews Methods Primers · 2025", href: "https://doi.org/10.1038/s43586-025-00386-y" },
          { title: "Multiphoton fabrication", detail: "LaFratta et al. · Angewandte Chemie International Edition · 2007", href: "https://doi.org/10.1002/anie.200603995" },
          { title: "Three-dimensional microfabrication with two-photon-absorbed photopolymerization", detail: "Maruo, Nakamura & Kawata · Optics Letters · 1997", href: "https://doi.org/10.1364/OL.22.000132" },
        ]} />
      </GuideSection>
    </GuidePage>
  );
}
