/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from "next";
import { JsonLd } from "../site-chrome";
import { absoluteUrl, pageMetadata, SITE_NAME } from "../site-config";

export const metadata: Metadata = pageMetadata({
  title: "Two-Photon Lithography Model: Optics, Chemistry and Development",
  description:
    "How the Causal Lithography Lab turns a focused femtosecond beam into exposure, reaction-diffusion chemistry, and a developed structure.",
  path: "/method",
  type: "article",
});

const references = [
  {
    id: "01",
    authors: "B. Richards & E. Wolf",
    year: "1959",
    title:
      "Electromagnetic diffraction in optical systems, II. Structure of the image field in an aplanatic system",
    journal: "Proceedings of the Royal Society A 253, 358–379",
    href: "https://doi.org/10.1098/rspa.1959.0200",
  },
  {
    id: "02",
    authors: "S. Maruo, O. Nakamura & S. Kawata",
    year: "1997",
    title:
      "Three-dimensional microfabrication with two-photon-absorbed photopolymerization",
    journal: "Optics Letters 22, 132–134",
    href: "https://doi.org/10.1364/OL.22.000132",
  },
  {
    id: "03",
    authors: "B. H. Cumpston et al.",
    year: "1999",
    title:
      "Two-photon polymerization initiators for three-dimensional optical data storage and microfabrication",
    journal: "Nature 398, 51–54",
    href: "https://doi.org/10.1038/17989",
  },
  {
    id: "04",
    authors: "H.-B. Sun et al.",
    year: "2000",
    title:
      "Real three-dimensional microstructures fabricated by photopolymerization of resins through two-photon absorption",
    journal: "Optics Letters 25, 1110–1112",
    href: "https://doi.org/10.1364/OL.25.001110",
  },
  {
    id: "05",
    authors: "A. K. O’Brien & C. N. Bowman",
    year: "2006",
    title: "Impact of Oxygen on Photopolymerization Kinetics and Polymer Structure",
    journal: "Macromolecules 39, 2501–2506",
    href: "https://doi.org/10.1021/ma051863l",
  },
  {
    id: "06",
    authors: "J. E. Johnson, Y. Chen & X. Xu",
    year: "2022",
    title:
      "Model for polymerization and self-deactivation in two-photon nanolithography",
    journal: "Optics Express 30, 26824–26840",
    href: "https://doi.org/10.1364/OE.461969",
  },
  {
    id: "07",
    authors: "J. Purtov et al.",
    year: "2018",
    title:
      "Improved development procedure to enhance the stability of microstructures created by two-photon polymerization",
    journal: "Microelectronic Engineering 194, 45–50",
    href: "https://doi.org/10.1016/j.mee.2018.03.009",
  },
];

function Citation({ children }: { children: React.ReactNode }) {
  return <span className="article-citation">[{children}]</span>;
}

export default function MethodPage() {
  return (
    <main className="method-page">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "How the two-photon lithography model works",
          description:
            "A mechanistic account of the optical, reaction–diffusion, and development model running in the browser laboratory.",
          mainEntityOfPage: absoluteUrl("/method"),
          datePublished: "2026-08-02",
          dateModified: "2026-08-02",
          author: {
            "@type": "Organization",
            name: SITE_NAME,
            url: absoluteUrl("/"),
          },
          citation: references.map((reference) => reference.href),
        }}
      />
      <header className="method-nav">
        <a className="method-brand" href="/" aria-label="Return to the field guide home">
          <span className="method-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>two·photon</strong>
            <small>causal lithography lab</small>
          </span>
        </a>
        <a className="return-to-lab" href="/lab">
          Open the lab <span aria-hidden="true">↗</span>
        </a>
      </header>

      <article className="method-article">
        <section className="method-hero" aria-labelledby="method-title">
          <div className="method-hero-copy">
            <span className="method-kicker">Model note · Inside the calculated voxel</span>
            <h1 id="method-title">How the two-photon lithography model works</h1>
            <p>
              The lab is a mechanistic sketch: a vectorial focus drives a
              spatial reaction–diffusion model, then a bath-accessible
              development pass removes weakly converted material.
            </p>
            <div className="method-hero-actions">
              <a href="#optics">Start with the light</a>
              <a href="#references">Read the papers</a>
            </div>
          </div>

          <div
            className="focus-figure"
            aria-label="Diagram of a focused two-photon exposure volume"
          >
            <svg viewBox="0 0 720 620" role="img" aria-labelledby="focus-figure-title">
              <title id="focus-figure-title">
                A converging beam, focal volume, and calculated voxel field
              </title>
              <defs>
                <radialGradient id="psf-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor="#f7ecff" stopOpacity="1" />
                  <stop offset="0.18" stopColor="#bca7ff" stopOpacity="0.95" />
                  <stop offset="0.54" stopColor="#8b5cff" stopOpacity="0.34" />
                  <stop offset="1" stopColor="#8b5cff" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="beam-line" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#46d8ff" stopOpacity="0.06" />
                  <stop offset="0.75" stopColor="#bca7ff" stopOpacity="0.48" />
                  <stop offset="1" stopColor="#f7ecff" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <g className="focus-grid" opacity="0.34">
                {Array.from({ length: 11 }).map((_, index) => (
                  <line
                    key={`v-${index}`}
                    x1={110 + index * 50}
                    y1="338"
                    x2={110 + index * 50}
                    y2="560"
                  />
                ))}
                {Array.from({ length: 6 }).map((_, index) => (
                  <line
                    key={`h-${index}`}
                    x1="110"
                    y1={338 + index * 44}
                    x2="610"
                    y2={338 + index * 44}
                  />
                ))}
              </g>
              <path className="beam-fill" d="M165 56 L328 340 L392 340 L555 56 Z" />
              <path className="beam-edge" d="M165 56 L328 340" />
              <path className="beam-edge" d="M555 56 L392 340" />
              <ellipse className="pupil-ring" cx="360" cy="56" rx="195" ry="27" />
              <ellipse className="focus-glow" cx="360" cy="350" rx="102" ry="64" />
              <ellipse className="focus-core" cx="360" cy="350" rx="26" ry="52" />
              <path
                className="scan-trace"
                d="M182 485 C250 435 303 518 366 471 S494 433 552 487"
              />
              <circle className="scan-point" cx="366" cy="471" r="7" />
              <text x="166" y="26">FIXED SPECIMEN POWER</text>
              <text x="418" y="338">I² SOURCE</text>
              <text x="446" y="530">SCAN PATH</text>
            </svg>
            <div className="focus-figure-caption">
              <span>01</span>
              <p>
                The field shape changes with NA and wavelength before chemistry
                begins. The bright core is sampled over each simulation voxel.
              </p>
            </div>
          </div>
        </section>

        <div className="method-body">
          <aside className="method-index" aria-label="Article sections">
            <span>In this note</span>
            <a href="#scope">Scope</a>
            <a href="#volume">Volume</a>
            <a href="#scan-path">Scan path</a>
            <a href="#optics">Optics + power</a>
            <a href="#chemistry">Chemistry</a>
            <a href="#development">Development</a>
            <a href="#limits">Limits</a>
            <a href="#references">References</a>
          </aside>

          <div className="method-prose">
            <section id="scope" className="method-section">
              <span className="method-section-number">01 / Scope</span>
              <h2>A model for reasoning, not a virtual instrument certificate</h2>
              <p className="method-lede">
                Every displayed field comes from the Rust/Wasm simulation. The
                renderer does not paint a desired outcome, but the model is not
                calibrated to a named commercial resin or printer.
              </p>
              <p>
                The controls separate measured process inputs—power, pulse
                duration, repetition rate, speed, NA, wavelength—from
                dimensionless chemistry coefficients. Literature supports the
                mechanisms and qualitative dependencies; it does not make the
                default coefficients experimentally identified. Use the lab to
                ask causal questions, then validate any quantitative prediction
                against a real resin, objective, and development protocol.
              </p>
              <div className="evidence-key" aria-label="Parameter evidence key">
                <span><i className="key-input" /> Input</span>
                <span><i className="key-literature" /> Literature-shaped mechanism</span>
                <span><i className="key-exploratory" /> Exploratory coefficient</span>
              </div>
            </section>

            <section id="volume" className="method-section">
              <span className="method-section-number">02 / Volume</span>
              <h2>One occupancy, one evolving resin volume</h2>
              <p>
                The Micro‑Benchy is voxelized once. Occupied cells define the
                intended material; the solver tracks photoinitiator, oxygen,
                radical activity, conversion, and remaining mass in the full 3D
                domain. Off-target cells can still activate when the optical
                kernel or diffusing species reach them.
              </p>
              <p>
                That distinction is why the amber material can disagree with
                the slate target. The target is geometry. The amber volume is a
                calculated consequence.
              </p>
            </section>

            <section id="scan-path" className="method-section">
              <span className="method-section-number">03 / Scan path</span>
              <h2>Geometry becomes a timed exposure history</h2>
              <p>
                Layer height, hatch spacing, hatch angle, contour count, pass
                count, and scan speed build a deterministic path through the
                occupancy. Moving between adjacent path samples adds illuminated
                dwell time; longer jumps add dark time, during which diffusion,
                oxygen recovery, and radical loss continue.
              </p>
              <p>
                Power and speed therefore do different things. Power changes the
                source amplitude quadratically. Speed changes how long the source
                dwells along the same geometry. Repeated passes revisit the path
                after the intervening chemistry has evolved.
              </p>
            </section>

            <section id="optics" className="method-section method-section-featured">
              <span className="method-section-number">04 / Optics + power</span>
              <h2>Where the power is calculated</h2>
              <p className="method-lede">
                The power control is specimen-plane average power. It is not
                divided uniformly among voxels.
              </p>
              <div className="equation-stack" aria-label="Optical source equations">
                <div><span>Pulse energy</span><code>Eₚ = P / f</code></div>
                <div><span>Peak-power proxy</span><code>P̂ = Eₚ / τ</code></div>
                <div><span>Vector field</span><code>E(r) = Debye(NA, λ, polarization)</code></div>
                <div><span>Local source</span><code>s(r) ∝ |E(r)|⁴ · P² / (f τ)</code></div>
              </div>
              <p>
                The objective semi-angle is derived from NA and a fixed immersion
                refractive index. A circularly polarized vectorial Debye integral
                produces the focal electric field, following the high-aperture
                foundation of Richards and Wolf <Citation>1</Citation>. The
                pupil is normalized to fixed total power, so raising NA
                concentrates the same specimen power instead of silently adding
                energy.
              </p>
              <p>
                Two-photon initiation follows the squared local intensity,
                consistent with the focal confinement demonstrated in early 3D
                two-photon polymerization work <Citation>2–4</Citation>. The
                current implementation voxel-averages the narrow central lobe
                when the grid would otherwise under-resolve it. Its absolute
                dose constant is anchored to the default 16 mW, 80 MHz, 100 fs,
                NA 1.4, 780 nm case. That anchor is numerical, not a claim of
                resin-specific calibration.
              </p>
              <div className="method-callout">
                <span>Read this carefully</span>
                <p>
                  “16 mW” is a real process-style input. The conversion predicted
                  from it remains relative until the two-photon cross-section,
                  initiator quantum yield, optical losses, and resin kinetics are
                  fitted to experiment.
                </p>
              </div>
            </section>

            <section id="chemistry" className="method-section">
              <span className="method-section-number">05 / Chemistry</span>
              <h2>A deliberately compact reaction–diffusion system</h2>
              <p>
                Exposure depletes photoinitiator and generates radicals. Oxygen
                inhibits generation and quenches radicals; photoinitiator,
                oxygen, and radicals diffuse; radicals also disappear through
                linear loss and bimolecular termination. Surviving radicals
                accumulate conversion. These coupled effects are grounded in
                measured oxygen inhibition and spatial photopolymerization models
                <Citation>5–6</Citation>.
              </p>
              <div className="equation-stack chemistry-equations" aria-label="Reaction diffusion equations">
                <div><span>Initiator</span><code>∂ₜp = Dₚ∇²p − βsp</code></div>
                <div><span>Radicals</span><code>∂ₜr = Dᵣ∇²r + ηsp − (δ + qo)r − κr²</code></div>
                <div><span>Oxygen</span><code>∂ₜo = Dₒ∇²o − χqor</code></div>
                <div><span>Conversion</span><code>∂ₜx = γr(1 − x)</code></div>
              </div>
              <p>
                These equations preserve the causal vocabulary of radical
                photopolymerization without attempting a full resin reaction
                network. The coefficients identified as exploratory in the
                article are stable dimensionless controls, not values copied
                from one paper.
              </p>
            </section>

            <section id="development" className="method-section">
              <span className="method-section-number">06 / Development</span>
              <h2>The bath attacks what it can reach</h2>
              <p>
                Development begins at solvent-connected surfaces, not at the
                rectangular simulation boundary. A distance transform estimates
                bath depth through the occupied material. Local mass then decays
                faster where conversion is below the gel point and slower where a
                stronger network resists dissolution.
              </p>
              <div className="equation-stack single-equation" aria-label="Development equation">
                <div><span>Remaining mass</span><code>∂ₜm = −kᵈcᵈ(depth)m / exp(ρx)</code></div>
              </div>
              <p>
                Real post-processing also includes solvent choice, rinsing,
                shrinkage, adhesion, drying, and capillary collapse. Development
                studies show that these steps can decide whether delicate TPP
                structures survive <Citation>7</Citation>; the lab currently
                models dissolution only, not mechanics or drying.
              </p>
            </section>

            <section id="limits" className="method-section limits-section">
              <span className="method-section-number">07 / Limits</span>
              <h2>What the simulation leaves out</h2>
              <ul>
                <li>Objective transmission, aberration, interface mismatch, and measured beam profile.</li>
                <li>A resin-specific two-photon cross-section and fitted kinetic rate constants.</li>
                <li>Temperature rise, viscosity change, autoacceleration, vitrification, and shrinkage.</li>
                <li>Developer transport coupled to moving boundaries, swelling, stress, adhesion, and capillary forces.</li>
                <li>Arbitrary uploaded STL slicing—the current run remains tied to the bundled benchmark occupancy.</li>
              </ul>
              <p>
                Those omissions are boundaries, not footnotes. They define what
                a counterfactual run can teach and what still needs an experiment.
              </p>
            </section>

            <section id="references" className="method-section references-section">
              <span className="method-section-number">08 / Papers</span>
              <h2>Primary references</h2>
              <ol className="reference-list">
                {references.map((reference) => (
                  <li key={reference.id}>
                    <a href={reference.href} target="_blank" rel="noreferrer">
                      <span className="reference-id">{reference.id}</span>
                      <span className="reference-copy">
                        <strong>{reference.title}</strong>
                        <span>{reference.authors} · {reference.year}</span>
                        <small>{reference.journal}</small>
                      </span>
                      <span className="reference-arrow" aria-hidden="true">↗</span>
                    </a>
                  </li>
                ))}
              </ol>
            </section>

            <footer className="method-footer">
              <div>
                <span className="method-kicker">Continue experimenting</span>
                <h2>Return to the calculated volume.</h2>
              </div>
              <a href="/lab">Open the lab <span aria-hidden="true">↗</span></a>
            </footer>
          </div>
        </div>
      </article>
    </main>
  );
}
