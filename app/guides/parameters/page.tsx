import type { Metadata } from "next";
import { pageMetadata } from "../../site-config";
import { GuideCallout, GuidePage, GuideSection } from "../guide-shell";
import { parameterCount, parameterGroups, type ParameterGroup } from "../parameter-data";

export const metadata: Metadata = pageMetadata({
  title: "Two-Photon Lithography Parameters Explained",
  description:
    "An intuitive guide to laser power, scan speed, numerical aperture, wavelength, pulse duration, repetition rate, oxygen, diffusion, gelation, and development.",
  path: "/guides/parameters",
  type: "article",
});

const sections = [
  { id: "how-to-read", label: "How to read" },
  ...parameterGroups.map((group) => ({ id: group.id, label: group.title })),
  { id: "interactions", label: "Key interactions" },
  { id: "evidence", label: "Evidence boundary" },
];

function ParameterGroupSection({ group }: { group: ParameterGroup }) {
  return (
    <GuideSection id={group.id} number={`${group.number} / ${group.title.split(" ")[0]}`} title={group.title}>
      <p className="guide-lede parameter-group-lede">{group.description}</p>
      <div className="parameter-atlas-list">
        {group.parameters.map((parameter) => (
          <section className="parameter-atlas-entry" id={parameter.key} key={parameter.key}>
            <header>
              <span className="parameter-symbol">{parameter.symbol}</span>
              <div><h3>{parameter.name}</h3><small>{parameter.unit}</small></div>
              <span className={`evidence-badge evidence-${parameter.evidence.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{parameter.evidence}</span>
            </header>
            <p className="parameter-intuition">{parameter.intuition}</p>
            <dl>
              <div><dt>Turn it up</dt><dd>{parameter.increase}</dd></div>
              <div><dt>Watch it with</dt><dd>{parameter.watch}</dd></div>
              <div><dt>Inside this model</dt><dd>{parameter.model}</dd></div>
            </dl>
            <a href="/lab">Try it in the lab <span aria-hidden="true">↗</span></a>
          </section>
        ))}
      </div>
    </GuideSection>
  );
}

export default function ParametersGuide() {
  return (
    <GuidePage
      eyebrow={`Guide 05 · ${parameterCount} live controls`}
      title="Two-photon lithography parameters, intuitively"
      description="Every control changes a particular link in the causal chain. This atlas explains what each one means, what increasing it tends to do, what it interacts with, and what the browser model actually computes."
      path="/guides/parameters"
      readTime="24 min reference"
      sections={sections}
    >
      <GuideSection id="how-to-read" number="01 / Orientation" title="Parameters are not independent knobs" featured>
        <p className="guide-lede">
          A setting only becomes meaningful inside a relationship: power at a
          given speed, NA at a given path spacing, oxygen at a given diffusion
          rate, development time at a given conversion field.
        </p>
        <p>
          Use the atlas to trace which physical or numerical route a control
          changes. “Turn it up” describes a directional intuition within this
          model, not a universal recipe for a real fabrication system.
        </p>
        <div className="evidence-key parameter-evidence-key">
          <span><i className="key-input" /> Process input</span>
          <span><i className="key-literature" /> Literature-shaped mechanism</span>
          <span><i className="key-exploratory" /> Exploratory coefficient</span>
        </div>
        <div className="parameter-jump-list" aria-label="Parameter categories">
          {parameterGroups.map((group) => (
            <a href={`#${group.id}`} key={group.id}><span>{group.number}</span>{group.title}</a>
          ))}
        </div>
      </GuideSection>

      {parameterGroups.map((group) => <ParameterGroupSection group={group} key={group.id} />)}

      <GuideSection id="interactions" number="06 / Interactions" title="The six comparisons worth learning first">
        <div className="interaction-list">
          <div><span>01</span><strong>Power × speed</strong><p>Source strength and dwell time can both raise exposure, but they change the chemical clock differently.</p></div>
          <div><span>02</span><strong>NA × path spacing</strong><p>A tighter focus can raise central intensity while reducing overlap between neighboring path samples.</p></div>
          <div><span>03</span><strong>Power × repetition rate × pulse duration</strong><p>Average power alone does not specify pulse energy or the nonlinear peak-power proxy.</p></div>
          <div><span>04</span><strong>Oxygen × diffusion × scan timing</strong><p>Inhibition depends on both how fast oxygen is consumed and how fast it is replenished.</p></div>
          <div><span>05</span><strong>Radical yield × loss × termination</strong><p>Generation competes with linear decay, oxygen quenching, and concentration-dependent termination.</p></div>
          <div><span>06</span><strong>Conversion × resistance × development time</strong><p>The exposed field becomes a surviving structure only after transport and dissolution act.</p></div>
        </div>
      </GuideSection>

      <GuideSection id="evidence" number="07 / Evidence" title="Physical-looking units do not imply complete calibration">
        <p>
          Power, speed, wavelength, numerical aperture, pulse duration, repetition
          rate, and geometric settings are expressed like experimental inputs.
          The compact chemistry coefficients use stable relative or normalized
          units because they are not fitted to a named material and protocol.
        </p>
        <GuideCallout label="Use this atlas for reasoning">
          <p>
            The directional explanations help construct and inspect counterfactuals.
            They are not process recipes, safety limits, material data sheets, or
            evidence that the default coefficients predict a particular resin.
          </p>
        </GuideCallout>
        <div className="inline-links">
          <a href="/guides/model-space">Compare model fidelity →</a>
          <a href="/method">Inspect equations and sources →</a>
        </div>
      </GuideSection>
    </GuidePage>
  );
}
