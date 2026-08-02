import type { Metadata } from "next";
import { pageMetadata } from "../../site-config";
import { GuideCallout, GuidePage, GuideSection, GuideSources } from "../guide-shell";

export const metadata: Metadata = pageMetadata({
  title: "What Is Two-Photon Lithography? TPL, 2PP and TPP Explained",
  description:
    "A causal guide to two-photon lithography and two-photon polymerization: nonlinear absorption, voxels, scan paths, chemistry, and development.",
  path: "/guides/two-photon-lithography",
  type: "article",
});

const sections = [
  { id: "definition", label: "Definition" },
  { id: "names", label: "TPL, 2PP and TPP" },
  { id: "process", label: "Process chain" },
  { id: "voxel", label: "The voxel" },
  { id: "parameters", label: "Parameters" },
  { id: "limits", label: "Limits" },
  { id: "sources", label: "Sources" },
];

export default function TwoPhotonLithographyGuide() {
  return (
    <GuidePage
      eyebrow="Guide 01 · Core process"
      title="What is two-photon lithography?"
      description="A focused pulse does not print a ready-made voxel. It initiates a nonlinear, spatially confined chain of optical and chemical events that may—or may not—survive development."
      path="/guides/two-photon-lithography"
      readTime="9 min read"
      sections={sections}
    >
      <GuideSection id="definition" number="01 / Definition" title="Three-dimensional writing through nonlinear absorption" featured>
        <p className="guide-lede">
          Two-photon lithography is a maskless microfabrication process in which
          tightly focused light initiates a material change through the near-simultaneous
          absorption of two photons.
        </p>
        <p>
          Each photon can carry too little energy to initiate the photochemistry
          alone. Where the photon density becomes sufficiently high, the combined
          excitation can activate a photoinitiator. Because the two-photon event
          rate depends nonlinearly on local intensity, useful exposure is confined
          much more strongly around the focus than it would be for a linear absorber.
        </p>
        <p>
          Moving that focus through a photosensitive material writes a three-dimensional
          exposure history without a physical mask. After exposure, a development
          step removes or retains material according to the chemistry and tone of
          the process.
        </p>
      </GuideSection>

      <GuideSection id="names" number="02 / Names" title="TPL, 2PP and TPP describe overlapping views">
        <div className="term-map">
          <div><strong>Two-photon lithography</strong><span>TPL</span><p>Emphasizes patterning and fabrication.</p></div>
          <div><strong>Two-photon polymerization</strong><span>2PP or TPP</span><p>Emphasizes the polymer-forming chemistry.</p></div>
          <div><strong>Two-photon photopolymerization</strong><span>2PP</span><p>Makes the light-driven polymerization explicit.</p></div>
          <div><strong>Two-photon direct laser writing</strong><span>2P-DLW</span><p>Emphasizes the scanned writing method.</p></div>
        </div>
        <p>
          In resin-based three-dimensional fabrication these expressions often
          refer to substantially the same workflow, but they foreground different
          parts of it. “Lithography” names the patterning method; “polymerization”
          names the reaction; “direct laser writing” names the way the focal exposure
          is placed.
        </p>
        <GuideCallout label="Terminology rule">
          <p>
            Treat the names as overlapping descriptions, not as mechanically
            interchangeable keywords. A direct-laser-writing process can use a
            different absorption mechanism, and multiphoton lithography is broader
            than its two-photon subset.
          </p>
        </GuideCallout>
      </GuideSection>

      <GuideSection id="process" number="03 / Process" title="From a digital path to developed matter">
        <ol className="causal-steps">
          <li><span>01</span><div><strong>Geometry becomes a path</strong><p>Layers, hatches, contours, and passes determine where the focus travels.</p></div></li>
          <li><span>02</span><div><strong>The objective shapes the field</strong><p>Wavelength, numerical aperture, pupil illumination, polarization, and aberrations set the focal distribution.</p></div></li>
          <li><span>03</span><div><strong>Pulse statistics set the nonlinear source</strong><p>Average power, repetition rate, pulse duration, and scan speed determine the local exposure history.</p></div></li>
          <li><span>04</span><div><strong>Initiators generate reactive species</strong><p>Excitation produces radicals or another initiating species; oxygen and loss mechanisms compete with them.</p></div></li>
          <li><span>05</span><div><strong>Conversion and network formation accumulate</strong><p>The reaction propagates until local material becomes sufficiently connected to behave as a gel or solid network.</p></div></li>
          <li><span>06</span><div><strong>Development tests the result</strong><p>Weak or soluble material is removed. Adhesion, shrinkage, drying, and capillary forces may decide what survives physically.</p></div></li>
        </ol>
      </GuideSection>

      <GuideSection id="voxel" number="04 / Voxel" title="A voxel is an outcome, not a fixed brush shape">
        <p>
          The word <em>voxel</em> is often used for the smallest written volume.
          It is useful, but it can conceal the causal chain. The optical intensity
          distribution is continuous; the initiation rate is nonlinear; chemical
          species move and react; the material crosses a process-dependent survival
          threshold; development then changes the final boundary.
        </p>
        <p>
          A voxel therefore depends on power, dwell time, focal shape, material
          kinetics, inhibition, neighboring exposures, and post-processing. It is
          not simply the diffraction-limited spot translated into solid matter.
        </p>
        <div className="concept-equation">
          <span>optical field</span><i>→</i><span>nonlinear source</span><i>→</i><span>conversion field</span><i>→</i><span>surviving structure</span>
        </div>
      </GuideSection>

      <GuideSection id="parameters" number="05 / Parameters" title="The controls form interacting families">
        <p>
          Power and scan speed are commonly discussed as dose controls, but even
          they are not identical: power changes nonlinear source strength while
          speed changes dwell time and the time available for chemistry. Numerical
          aperture changes the spatial distribution. Oxygen can delay initiation.
          Layer and hatch spacing determine how neighboring exposures overlap.
        </p>
        <p>
          The most useful question is therefore not “which single value is best?”
          but “which causal route did this parameter alter?”
        </p>
        <a className="guide-text-link" href="/guides/parameters">Open the complete parameter atlas →</a>
      </GuideSection>

      <GuideSection id="limits" number="06 / Limits" title="The same process name can hide different physical regimes">
        <p>
          Real systems differ in photoinitiator, resin network, optical losses,
          objective configuration, writing strategy, substrate adhesion, and
          development protocol. A qualitative dependency can transfer across
          systems while its numerical optimum does not.
        </p>
        <p>
          This laboratory is designed for causal reasoning. Its light inputs have
          physical-style units, but its chemistry is not fitted to a specific
          material. Any quantitative prediction still requires experimental
          calibration and uncertainty analysis.
        </p>
      </GuideSection>

      <GuideSection id="sources" number="07 / Sources" title="Primary and field-defining sources">
        <GuideSources sources={[
          { title: "Three-dimensional microfabrication with two-photon-absorbed photopolymerization", detail: "Maruo, Nakamura & Kawata · Optics Letters · 1997", href: "https://doi.org/10.1364/OL.22.000132" },
          { title: "Two-photon polymerization initiators for three-dimensional optical data storage and microfabrication", detail: "Cumpston et al. · Nature · 1999", href: "https://doi.org/10.1038/17989" },
          { title: "Multiphoton 3D lithography", detail: "Skliutas et al. · Nature Reviews Methods Primers · 2025", href: "https://doi.org/10.1038/s43586-025-00386-y" },
        ]} />
      </GuideSection>
    </GuidePage>
  );
}
