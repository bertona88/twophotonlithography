import type { Metadata } from "next";
import { pageMetadata } from "../../site-config";
import { GuideCallout, GuidePage, GuideSection, GuideSources } from "../guide-shell";

export const metadata: Metadata = pageMetadata({
  title: "Models of Two-Photon Lithography: Dose, Kinetics and Reaction–Diffusion",
  description:
    "Compare models of two-photon and multiphoton lithography, from Gaussian voxels and dose thresholds to optical fields, reaction–diffusion, and development.",
  path: "/guides/model-space",
  type: "article",
});

const sections = [
  { id: "map", label: "The model map" },
  { id: "optics", label: "Optics" },
  { id: "exposure", label: "Exposure and dose" },
  { id: "chemistry", label: "Chemistry" },
  { id: "development", label: "Development" },
  { id: "mechanics", label: "Mechanics" },
  { id: "calibration", label: "Calibration" },
  { id: "current-lab", label: "This lab" },
  { id: "sources", label: "Sources" },
];

export default function ModelSpaceGuide() {
  return (
    <GuidePage
      eyebrow="Guide 04 · Model space"
      title="Models of two-photon lithography"
      description="There is no single ‘the TPL model.’ Different models answer different questions by retaining—or deliberately discarding—different parts of the causal chain."
      path="/guides/model-space"
      readTime="12 min read"
      sections={sections}
    >
      <GuideSection id="map" number="01 / Map" title="From geometric voxels to evolving material fields" featured>
        <p className="guide-lede">
          Model fidelity is not one ladder. An optical model can be detailed while
          its chemistry is a threshold; a kinetic model can be rich while its scan
          path is reduced to a local dose.
        </p>
        <div className="comparison-table-wrap model-space-table-wrap">
          <table className="guide-table model-space-table">
            <thead><tr><th>Layer</th><th>Compact model</th><th>Richer model</th><th>Current lab</th></tr></thead>
            <tbody>
              <tr><th>Geometry</th><td>Fixed ellipsoid</td><td>Sliced path through arbitrary occupancy</td><td>Deterministic benchmark occupancy</td></tr>
              <tr><th>Optics</th><td>Gaussian focus</td><td>Vectorial diffraction with aberrations</td><td>Vectorial Debye field</td></tr>
              <tr><th>Excitation</th><td>Binary dose</td><td>Pulse-resolved nonlinear initiation</td><td>Voxel-averaged I² source</td></tr>
              <tr><th>Chemistry</th><td>Conversion threshold</td><td>Multi-species kinetic network</td><td>Reaction–diffusion fields</td></tr>
              <tr><th>Development</th><td>Delete below threshold</td><td>Moving-boundary transport</td><td>Bath-accessible dissolution</td></tr>
              <tr><th>Mechanics</th><td>Ignored</td><td>Shrinkage, stress and collapse</td><td>Outside scope</td></tr>
              <tr><th>Calibration</th><td>Relative coefficients</td><td>Fitted parameters with uncertainty</td><td>Exploratory chemistry</td></tr>
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="optics" number="02 / Optics" title="How is light distributed around the focus?">
        <p>
          A Gaussian approximation can capture a compact, ellipsoidal focus and
          is often enough for rapid process-window reasoning. Scalar diffraction
          adds pupil and propagation structure. At high numerical aperture,
          vectorial models represent polarization and longitudinal field components
          that a scalar picture cannot.
        </p>
        <p>
          Further layers can include measured pupil illumination, objective
          transmission, interface mismatch, spherical aberration, scattering, or
          spatially varying refractive index. The right level depends on whether
          the question concerns a broad trend, voxel shape, or quantitative dose.
        </p>
      </GuideSection>

      <GuideSection id="exposure" number="03 / Exposure" title="Is exposure a scalar dose or a timed event sequence?">
        <p>
          The most compact models integrate a local intensity proxy into one dose
          and compare it with a threshold. A richer model separates average power,
          repetition rate, pulse duration, scan speed, and path timing. Pulse-resolved
          models can follow excitation within and between individual pulses, at a
          much greater computational cost.
        </p>
        <p>
          Dose equivalence is therefore conditional. The same nominal energy per
          length does not guarantee the same nonlinear source or chemical history
          when pulse statistics and dark intervals differ.
        </p>
      </GuideSection>

      <GuideSection id="chemistry" number="04 / Chemistry" title="What happens after excitation?">
        <p>
          Threshold models jump from exposure to cured material. Kinetic models
          introduce initiator depletion, radical generation, propagation, oxygen
          quenching, and termination. Reaction–diffusion models also allow species
          to move between neighboring regions, coupling the exposed voxel to its
          surroundings.
        </p>
        <div className="model-ladder">
          <div><span>01</span><strong>Dose threshold</strong><small>Fast process-window estimate</small></div>
          <div><span>02</span><strong>Local rate equations</strong><small>Time-dependent chemistry without transport</small></div>
          <div><span>03</span><strong>Reaction–diffusion</strong><small>Coupled kinetics and spatial transport</small></div>
          <div><span>04</span><strong>Network-resolved chemistry</strong><small>Material-specific species and fitted rates</small></div>
        </div>
      </GuideSection>

      <GuideSection id="development" number="05 / Development" title="Exposure does not end when the laser stops">
        <p>
          A binary development model retains every location above a conversion
          threshold. More detailed models make dissolution rate depend on local
          conversion or network density. Transport-aware approaches represent how
          developer reaches internal surfaces; moving-boundary models evolve the
          interface as material is removed.
        </p>
        <p>
          This layer is essential when two exposure histories produce similar
          conversion but different access paths, gradients, or weak connections.
        </p>
      </GuideSection>

      <GuideSection id="mechanics" number="06 / Mechanics" title="Survival can become a structural problem">
        <p>
          A chemically insoluble feature may still shrink, detach, bend, or collapse.
          Mechanics models can couple conversion to modulus and shrinkage, include
          adhesion at the substrate, and represent capillary forces during drying.
          These effects matter especially for high-aspect-ratio or weakly supported
          structures.
        </p>
        <GuideCallout label="Boundary of the present simulator">
          <p>
            The lab models dissolution but not stress, shrinkage, adhesion, fluid
            flow, or capillary collapse. A surviving calculated volume is therefore
            a chemical-development result, not a complete mechanical guarantee.
          </p>
        </GuideCallout>
      </GuideSection>

      <GuideSection id="calibration" number="07 / Calibration" title="More equations do not automatically create more truth">
        <p>
          Parameters must be identifiable from measurements relevant to the model.
          A detailed reaction network with guessed coefficients can be less predictive
          than a compact empirical model fitted within a controlled process window.
          Calibration should state the measured observables, uncertainty, parameter
          correlations, and the range over which extrapolation is attempted.
        </p>
      </GuideSection>

      <GuideSection id="current-lab" number="08 / Current lab" title="A causal sketch between threshold and calibration">
        <p>
          The browser laboratory combines a vectorial focus, a two-photon source,
          a timed three-dimensional scan path, reaction–diffusion fields, conversion,
          gelation, and bath-accessible development. It is more mechanistic than a
          fixed-voxel or dose-threshold visualizer, but its chemistry coefficients
          remain exploratory and dimensionless.
        </p>
        <p>
          Its purpose is to expose dependencies and counterfactuals: what changed,
          through which mechanism, and where the result diverged from the target.
          Quantitative prediction remains a separate calibration task.
        </p>
        <div className="inline-links">
          <a href="/method">Inspect the equations →</a>
          <a href="/lab">Run the model →</a>
        </div>
      </GuideSection>

      <GuideSection id="sources" number="09 / Sources" title="Foundations represented in the model map">
        <GuideSources sources={[
          { title: "Electromagnetic diffraction in optical systems, II", detail: "Richards & Wolf · Proceedings of the Royal Society A · 1959", href: "https://doi.org/10.1098/rspa.1959.0200" },
          { title: "Model for polymerization and self-deactivation in two-photon nanolithography", detail: "Johnson, Chen & Xu · Optics Express · 2022", href: "https://doi.org/10.1364/OE.461969" },
          { title: "Impact of Oxygen on Photopolymerization Kinetics and Polymer Structure", detail: "O’Brien & Bowman · Macromolecules · 2006", href: "https://doi.org/10.1021/ma051863l" },
          { title: "Improved development procedure to enhance the stability of microstructures", detail: "Purtov et al. · Microelectronic Engineering · 2018", href: "https://doi.org/10.1016/j.mee.2018.03.009" },
        ]} />
      </GuideSection>
    </GuidePage>
  );
}
