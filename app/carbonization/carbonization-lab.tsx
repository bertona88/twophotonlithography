"use client";

import { useEffect, useRef, useState } from "react";
import type { BccConfig, BccSnapshot, BccMessage, BccStatus } from "../bcc-types";
import BccView from "./bcc-view";
import styles from "./carbonization.module.css";

type View = { snapshot: BccSnapshot; config: BccConfig };
type Point = { time: number; solid: number; mobile: number; escaped: number; stress: number; height: number };
type Baseline = { view: View; history: Point[] };
const FIELDS = [
  { key: "stressMPa", label: "von Mises stress", unit: "MPa", maximum: 0 },
  { key: "precursor", label: "Precursor mass", unit: "/ initial local dry mass", maximum: 1 },
  { key: "char", label: "Char mass", unit: "/ initial local dry mass", maximum: 1 },
  { key: "mobile", label: "Mobile volatile products", unit: "/ initial local dry mass", maximum: 1 },
  { key: "order", label: "Carbon-network order", unit: "structural surrogate", maximum: 1 },
  { key: "porosity", label: "Unresolved micro-porosity", unit: "fraction", maximum: 1 },
  { key: "density", label: "Solid bulk density", unit: "kg/m³", maximum: 0 },
  { key: "naturalJacobian", label: "Natural volume ratio", unit: "stress-free J", maximum: 1 },
  { key: "jacobian", label: "Actual volume ratio", unit: "solved J", maximum: 1 },
] as const;
type FieldKey = typeof FIELDS[number]["key"];
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
const number = (v: number | undefined, digits = 3) => v === undefined || !Number.isFinite(v) ? "—" : v.toPrecision(digits);

function download(name: string, content: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HistoryChart({ history, baseline, duration, kind }: { history: Point[]; baseline: Baseline | null; duration: number; kind: "mass" | "stress" }) {
  const maximum = kind === "mass" ? 1 : Math.max(0.01, ...history.map(p => p.stress), ...(baseline?.history.map(p => p.stress) ?? []));
  const series = kind === "mass" ? [{ key: "solid", name: "Solid", color: "#c0a6f8" }, { key: "mobile", name: "Mobile", color: "#66c7c5" }, { key: "escaped", name: "Escaped", color: "#eac27b" }] as const : [{ key: "stress", name: "Peak stress", color: "#c0a6f8" }] as const;
  const path = (rows: Point[], key: "solid" | "mobile" | "escaped" | "stress") => rows.map(p => `${42 + p.time / duration * 510},${158 - p[key] / maximum * 128}`).join(" ");
  return <div className={styles.chart}>
    <svg viewBox="0 0 580 195" role="img" aria-label={kind === "mass" ? "Solid, mobile and escaped mass over physical time" : "Peak von Mises Cauchy stress over physical time"}>
      {[0, .5, 1].map(v => <g key={v}><line x1="42" x2="552" y1={158 - 128 * v} y2={158 - 128 * v} stroke="#2d3341"/><text x="34" y={162 - 128 * v} textAnchor="end">{number(v * maximum, 2)}</text></g>)}
      <text x="42" y="15">{kind === "mass" ? "Mass / initial dry mass" : "von Mises stress (MPa)"}</text>
      {series.map(s => <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2" points={path(history, s.key)}/>)}
      {baseline && <polyline fill="none" stroke="#dedbe5" strokeWidth="1.8" strokeDasharray="5 4" points={path(baseline.history, kind === "mass" ? "solid" : "stress")}/>}
      <text x="42" y="179">0 min</text><text x="552" y="179" textAnchor="end">{(duration / 60).toFixed(1)} min</text>
    </svg>
    <div className={styles.legend}>{series.map(s => <span key={s.key}><i style={{ background: s.color }}/>{s.name}</span>)}{baseline && <span><i style={{ background: "#dedbe5" }}/>Pinned {baseline.view.config.support}</span>}</div>
  </div>;
}

export default function CarbonizationLab() {
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const sequence = useRef(0);
  const accepted = useRef({ runId: 0, sequence: 0, status: "ready" as BccStatus });
  const pendingRequest = useRef(false);
  const autoStart = useRef(false);
  const [config, setConfig] = useState<BccConfig | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [status, setStatus] = useState<BccStatus>("ready");
  const [initialized, setInitialized] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<FieldKey>("stressMPa");
  const [probe, setProbe] = useState(0);
  const [reference, setReference] = useState(true);
  const [cutaway, setCutaway] = useState(false);

  useEffect(() => {
    const instance = new Worker(new URL("../bcc.worker.ts", import.meta.url), { type: "module" });
    worker.current = instance;
    instance.onmessage = ({ data }: MessageEvent<BccMessage>) => {
      if (data.type === "ready") {
        setInitialized(true); setConfig(data.defaults);
        pendingRequest.current = true; setPending(true); runId.current++;
        instance.postMessage({ type: "configure", runId: runId.current, config: data.defaults });
        return;
      }
      if (data.type === "error") {
        if (data.runId !== runId.current && data.runId !== 0) return;
        setError(data.message); autoStart.current = false;
        if (pendingRequest.current && accepted.current.runId) { runId.current = accepted.current.runId; sequence.current = accepted.current.sequence; setStatus(accepted.current.status); }
        else setStatus("error");
        pendingRequest.current = false; setPending(false); return;
      }
      if (data.runId !== runId.current) return;
      if (data.type === "checkpoint") { download(`bcc-carbonization-${data.runId}.json`, JSON.stringify(data.checkpoint)); return; }
      if (data.sequence <= sequence.current) return;
      sequence.current = data.sequence;
      accepted.current = { runId: data.runId, sequence: data.sequence, status: data.status };
      pendingRequest.current = false; setPending(false);
      setView({ snapshot: data.snapshot, config: data.config }); setStatus(data.status);
      if (data.sequence === 1) setConfig(data.config);
      const d = data.snapshot.diagnostics;
      if (d.failure) setError(`${d.failure.code}: ${d.failure.message}`);
      setHistory(previous => {
        const prior = data.sequence === 1 ? [] : previous;
        if (prior.at(-1)?.time === d.timeS) return prior;
        const compact = prior.length >= 2048 ? prior.filter((_, i) => i % 2 === 0) : prior;
        return [...compact, { time: d.timeS, solid: (d.precursorMassKg + d.charMassKg) / d.initialMassKg, mobile: d.mobileMassKg / d.initialMassKg, escaped: d.escapedMassKg / d.initialMassKg, stress: d.maxStressMPa, height: d.dimensionsUm[2] }];
      });
      if (data.status === "ready" && autoStart.current) { autoStart.current = false; instance.postMessage({ type: "start", runId: runId.current }); }
    };
    instance.onerror = event => { setError(event.message || "BCC solver worker failed"); setStatus("error"); setPending(false); pendingRequest.current = false; };
    return () => { instance.terminate(); worker.current = null; };
  }, []);

  function start(nextConfig = config) {
    if (!nextConfig || pendingRequest.current) return;
    pendingRequest.current = true; setPending(true); autoStart.current = true;
    runId.current = Math.max(runId.current, accepted.current.runId) + 1; sequence.current = 0;
    setError(null); setProbe(0);
    worker.current?.postMessage({ type: "configure", runId: runId.current, config: nextConfig });
  }
  function command(type: "pause" | "resume" | "cancel" | "step" | "export") { if (!pendingRequest.current) worker.current?.postMessage({ type, runId: runId.current }); }
  async function restore(file?: File) {
    if (!file || pendingRequest.current) return;
    pendingRequest.current = true; setPending(true);
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("BCC checkpoint exceeds 16 MiB");
      const checkpoint: unknown = JSON.parse(await file.text());
      runId.current = Math.max(runId.current, accepted.current.runId) + 1; sequence.current = 0; autoStart.current = false; setError(null); setProbe(0);
      worker.current?.postMessage({ type: "restore", runId: runId.current, checkpoint });
    } catch (e) { pendingRequest.current = false; setPending(false); setError(e instanceof Error ? e.message : String(e)); }
  }
  function compare() {
    if (!view || !config) return;
    setBaseline({ view, history });
    const next = { ...view.config, support: view.config.support === "bonded" ? "free" as const : "bonded" as const };
    setConfig(next); start(next);
  }
  function exportCsv() {
    if (!view) return;
    const s = view.snapshot;
    const keys = FIELDS.map(f => f.key);
    const rows = s.cellFields.precursor.map((_, i) => [i, ...s.cellCentersUm.slice(i * 3, i * 3 + 3), ...keys.map(key => s.cellFields[key][i])].join(","));
    download("bcc-carbonization-cells.csv", `# ${view.config.modelVersion}; support=${view.config.support}; time_s=${s.diagnostics.timeS}; illustrative uncalibrated material\ncell,x_um,y_um,z_um,${keys.join(",")}\n${rows.join("\n")}\n`, "text/csv");
  }
  const snapshot = view?.snapshot ?? null;
  const d = snapshot?.diagnostics;
  const running = status === "running";
  const frozen = running || pending;
  const activeConfig = view?.config ?? config;
  const extentUm = activeConfig ? activeConfig.cellsPerAxis * activeConfig.pitchM * 1e6 : 80;
  const selected = FIELDS.find(f => f.key === field)!;
  const values = snapshot?.cellFields[field] ?? [];
  const rangeMax = values.reduce((max, value) => Math.max(max, value), selected.maximum);
  const maximum = Math.max(rangeMax, 1e-9);
  const minimum = 0;
  const currentProbe = Math.min(probe, Math.max(0, values.length - 1));
  const inputChanged = !!view && !!config && JSON.stringify(view.config) !== JSON.stringify(config);
  const duration = Math.max(1, d?.durationS ?? 1, baseline?.view.snapshot.diagnostics.durationS ?? 1);

  return <main className={`${styles.lab} ${styles.bccLab}`}>
    <header className={styles.bccHeading}><div><p className={styles.eyebrow}>CARBONIZATION LAB</p><h1>BCC foam on a substrate</h1><p>Pyrolysis, gas escape and finite-strain contraction in a three-dimensional tetrahedral benchmark.</p></div><a href="/carbonization/strut">Radial strut benchmark ↗</a></header>
    {error && <div role="alert" className={styles.error}>{error}<span className={styles.errorHint}>The viewport retains the last accepted numerical state.</span></div>}
    <div className={styles.bccLayout}>
      <section className={styles.workspace} aria-label="BCC specimen and accepted results">
        <div className={styles.viewerToolbar}><label>Color by<select aria-label="Color by material field" value={field} onChange={e => setField(e.target.value as FieldKey)}>{FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label><div className={styles.viewOptions}><label><input type="checkbox" checked={reference} onChange={e => setReference(e.target.checked)}/>Dry reference</label><label><input type="checkbox" checked={cutaway} onChange={e => setCutaway(e.target.checked)}/>Section y = 0</label></div></div>
        <BccView snapshot={snapshot} field={field} minimum={minimum} maximum={maximum} reference={reference} cutaway={cutaway} probe={currentProbe} onProbe={setProbe} extentUm={extentUm} support={activeConfig?.support ?? "bonded"}/>
        <div className={styles.colorLegend}><span>{selected.label}</span><i/><span>{number(minimum)} – {number(rangeMax)} {selected.unit}</span></div>
        <div className={styles.stateLine}><span className={styles.statusDot} data-running={running}/><strong role="status">{pending ? "Preparing mesh…" : initialized ? status : "Initializing Rust/Wasm…"}</strong><span>{d ? `${(d.timeS / 60).toFixed(2)} / ${(d.durationS / 60).toFixed(1)} min` : "Accepted solver state"}</span><span>{d ? `${(d.specimenTemperatureK - 273.15).toFixed(1)} °C` : ""}</span></div>
        <progress className={styles.bccProgress} value={d?.timeS ?? 0} max={d?.durationS || 1} aria-label="Heating schedule progress"/>
        <div className={styles.bccMetrics}>
          <div><span>Solid retained</span><strong>{d ? percent((d.precursorMassKg + d.charMassKg) / d.initialMassKg) : "—"}</strong></div>
          <div><span>Current height</span><strong>{d ? `${d.dimensionsUm[2].toFixed(2)} µm` : "—"}</strong></div>
          <div><span>Volume / initial</span><strong>{d ? number(d.volumeRatio) : "—"}</strong></div>
          <div><span>Peak stress</span><strong>{d ? `${number(d.maxStressMPa)} MPa` : "—"}</strong></div>
        </div>
        {snapshot && <div className={styles.cellProbe}><label>Material probe · tetrahedron {currentProbe + 1} / {values.length.toLocaleString()}<input aria-label="Material probe tetrahedron" type="range" min="0" max={Math.max(0, values.length - 1)} value={currentProbe} onChange={e => setProbe(Number(e.target.value))}/></label><div><strong>{number(values[currentProbe], 5)} <small>{selected.unit}</small></strong><span>Current center ({snapshot.cellCentersUm.slice(currentProbe * 3, currentProbe * 3 + 3).map(n => n.toFixed(1)).join(", ")}) µm</span></div></div>}
        <p className={styles.viewerNote}>Rigid substrate at z = 0. {activeConfig?.support === "bonded" ? "Contact nodes are fixed in all directions; contact faces cannot release gas." : "Free control removes the bond and allows gas escape from all faces; the plate is a visual reference."} {reference && "Fine outlines show the initial dry geometry."}</p>
      </section>
      <aside className={`${styles.controls} ${styles.panel}`}>
        <h2>Specimen & furnace</h2>
        {!config ? <p>{error ? "Solver unavailable." : "Loading material and mesh defaults…"}</p> : <>
          <fieldset disabled={frozen}>
            <div className={styles.inputPair}><label>Cells per axis<select value={config.cellsPerAxis} onChange={e => setConfig({ ...config, cellsPerAxis: Number(e.target.value) })}><option value="1">1 × 1 × 1</option><option value="2">2 × 2 × 2</option></select></label><label>Cell pitch (µm)<input type="number" min="10" max="200" step="5" value={config.pitchM * 1e6} onChange={e => setConfig({ ...config, pitchM: e.target.valueAsNumber * 1e-6 })}/></label></div>
            <label>Strut radius / cell pitch<input type="number" min="0.15" max="0.3" step="0.01" value={config.strutRadiusRatio} onChange={e => setConfig({ ...config, strutRadiusRatio: e.target.valueAsNumber })}/></label>
            <p className={styles.note}>Nominal strut diameter {number(2 * config.strutRadiusRatio * config.pitchM * 1e6)} µm. Mesh approximates the joined BCC struts.</p>
            <label>Substrate connection<select value={config.support} onChange={e => setConfig({ ...config, support: e.target.value as BccConfig["support"] })}><option value="bonded">Perfectly bonded · rigid substrate</option><option value="free">Free shrinkage · no substrate bond</option></select></label>
            <label>Mesh resolution<select value={config.voxelsPerCell} onChange={e => setConfig({ ...config, voxelsPerCell: Number(e.target.value) })}><option value="10">10 voxels / cell · standard</option><option value="12">12 voxels / cell · refined</option></select></label>
            <h3>Temperature schedule</h3><div className={styles.waypointLabels}><span>Time (min)</span><span>Specimen (°C)</span></div>
            {config.schedule.map((p, i) => <div key={i} className={styles.waypoint}><input aria-label={`Waypoint ${i + 1} time in minutes`} type="number" min="0" disabled={i === 0} value={Number((p.timeS / 60).toFixed(4))} onChange={e => setConfig({ ...config, schedule: config.schedule.map((point, j) => i === j ? { ...point, timeS: e.target.valueAsNumber * 60 } : point) })}/><input aria-label={`Waypoint ${i + 1} temperature in Celsius`} type="number" min="0" max="1400" value={Number((p.temperatureK - 273.15).toFixed(2))} onChange={e => setConfig({ ...config, schedule: config.schedule.map((point, j) => i === j ? { ...point, temperatureK: e.target.valueAsNumber + 273.15 } : point) })}/></div>)}
            <p className={styles.note}>Uniform specimen temperature; linear ramps and equal-temperature holds. Inert atmosphere.</p>
            <details><summary>Material & solver settings</summary>
              <label>Char mass yield<input type="number" min="0.05" max="0.95" step="0.05" value={config.material.charYield} onChange={e => setConfig({ ...config, material: { ...config.material, charYield: e.target.valueAsNumber } })}/></label>
              <label>Base shear modulus (MPa)<input type="number" min="0.01" max="100000" value={config.shearModulusPa / 1e6} onChange={e => setConfig({ ...config, shearModulusPa: e.target.valueAsNumber * 1e6 })}/></label>
              <label>Poisson ratio<input type="number" min="0" max="0.4" step="0.05" value={config.poissonRatio} onChange={e => setConfig({ ...config, poissonRatio: e.target.valueAsNumber })}/></label>
              <label>Relaxation time (s; 0 = elastic)<input type="number" min="0" max="100000" step="30" value={config.relaxationTimeS} onChange={e => setConfig({ ...config, relaxationTimeS: e.target.valueAsNumber })}/></label>
              <label>Equilibrium modulus fraction<input type="number" min="0.05" max="1" step="0.05" value={config.equilibriumFraction} onChange={e => setConfig({ ...config, equilibriumFraction: e.target.valueAsNumber })}/></label>
              <label>Base diffusivity (m²/s)<input type="number" min="0" step="1e-16" value={config.material.diffusivityM2S} onChange={e => setConfig({ ...config, material: { ...config.material, diffusivityM2S: e.target.valueAsNumber } })}/></label>
              <label>Surface transfer (m/s)<input type="number" min="0" step="1e-8" value={config.material.surfaceTransferMS} onChange={e => setConfig({ ...config, material: { ...config.material, surfaceTransferMS: e.target.valueAsNumber } })}/></label>
              <label>Maximum increment (s)<input type="number" min="0.1" max="60" value={config.maxStepS} onChange={e => setConfig({ ...config, maxStepS: e.target.valueAsNumber })}/></label>
              <label>Chemistry error tolerance<input type="number" min="0.00001" max="0.01" step="0.0001" value={config.relativeTolerance} onChange={e => setConfig({ ...config, relativeTolerance: e.target.valueAsNumber })}/></label>
            </details>
          </fieldset>
          {inputChanged && <p className={styles.changed}>Inputs changed. Run to apply them to a new specimen.</p>}
          <div className={styles.actions}><button className={styles.primary} disabled={!initialized || frozen} onClick={() => start()}>{pending ? "Preparing mesh…" : view && (d?.timeS ?? 0) > 0 ? "Run again with these inputs" : "Run BCC benchmark"}</button><button disabled={!running || pending} onClick={() => command("pause")}>Pause</button><button disabled={pending || (status !== "paused" && status !== "ready") || !view} onClick={() => command("resume")}>Resume</button><button disabled={pending || (status !== "paused" && status !== "ready") || !view} onClick={() => command("step")}>One step</button><button disabled={pending || (!running && status !== "paused")} onClick={() => command("cancel")}>Cancel</button></div>
          <label className={styles.file}>Restore a BCC checkpoint (.json)<input type="file" accept=".json,application/json" disabled={!initialized || frozen} onChange={e => { void restore(e.target.files?.[0]); e.target.value = ""; }}/></label>
        </>}
      </aside>
    </div>
    {view && d && <section className={styles.analysisSection} aria-label="Accepted state diagnostics and comparison">
      <div className={styles.analysisHeading}><div><h2>Transformation & constraint</h2><p>Accepted solver states through physical time.</p></div><div className={styles.comparisonActions}><button disabled={frozen || d.timeS === 0} onClick={() => setBaseline({ view, history })}>Pin current run</button><button disabled={frozen || d.timeS === 0} onClick={compare}>Compare {view.config.support === "bonded" ? "free shrinkage" : "bonded substrate"}</button>{baseline && <button disabled={frozen} onClick={() => setBaseline(null)}>Clear comparison</button>}</div></div>
      <div className={styles.historyGrid}><HistoryChart history={history} baseline={baseline} duration={duration} kind="mass"/><HistoryChart history={history} baseline={baseline} duration={duration} kind="stress"/></div>
      {baseline && <div className={styles.comparisonRow}><span>Pinned <strong>{baseline.view.config.support}</strong> · {(baseline.view.snapshot.diagnostics.timeS / 60).toFixed(2)} min</span><span>Height {baseline.view.snapshot.diagnostics.dimensionsUm[2].toFixed(2)} µm → {d.dimensionsUm[2].toFixed(2)} µm</span><span>Peak stress {number(baseline.view.snapshot.diagnostics.maxStressMPa)} → {number(d.maxStressMPa)} MPa</span></div>}
      <dl className={styles.bccDiagnostics}>
        <div><dt>Current x × y × z envelope</dt><dd>{d.dimensionsUm.map(v => v.toFixed(2)).join(" × ")} µm</dd></div>
        <div><dt>Initial dry mass</dt><dd>{number(d.initialMassKg * 1e12, 5)} ng</dd></div>
        <div><dt>Escaped / initial mass</dt><dd>{percent(d.escapedMassKg / d.initialMassKg)}</dd></div>
        <div><dt>Mass balance error</dt><dd>{d.relativeMassError.toExponential(2)}</dd></div>
        <div><dt>Equilibrium residual</dt><dd>{d.mechanicalResidual.toExponential(2)}</dd></div>
        <div><dt>Minimum actual / natural J</dt><dd>{number(d.minJacobian)} / {number(d.minNaturalJacobian)}</dd></div>
        <div><dt>Mesh nodes / tetrahedra</dt><dd>{d.nodes.toLocaleString()} / {d.elements.toLocaleString()}</dd></div>
        <div><dt>Nominal strut diameter / voxel</dt><dd>{number(d.strutDiameterVoxels)} · {number(d.voxelSizeUm)} µm voxels</dd></div>
        <div><dt>Accepted / rejected increments</dt><dd>{d.acceptedSteps} / {d.rejectedSteps}</dd></div>
        <div><dt>Relaxation dissipation</dt><dd>{number(d.relaxationDissipationJ * 1e12)} pJ</dd></div>
        <div><dt>Estimated peak solver memory</dt><dd>{number(d.estimatedPeakBytes / 1048576)} MiB</dd></div>
        <div><dt>Accepted-state checksum</dt><dd>{d.checksum}</dd></div>
      </dl>
      <details className={styles.transportDetails}><summary>Gas positivity limiter: min α {number(d.transportLimiterMinAlpha)} / {d.transportLimitedSteps} limited steps</summary><p>α = 1 uses consistent finite-element diffusion. Lower α adds numerical diffusion to preserve nonnegative gas concentrations. Refine the mesh and timestep to assess its effect on transport.</p></details>
      <div className={styles.exportActions}><button disabled={pending} onClick={() => command("export")}>Export checkpoint</button><button onClick={exportCsv}>Export cell fields CSV</button></div>
      <p className={styles.note}>Checkpoints preserve the numerical state and inputs for deterministic continuation. Charts sample accepted snapshots. A pinned comparison lasts for this page session; compare at matching physical times and mesh resolution.</p>
    </section>}
    <section className={styles.modelScope}><div><p className={styles.eyebrow}>MODEL SCOPE</p><h2>Illustrative material.<br/> Explicit boundary conditions.</h2></div><div><p>The BCC specimen is a voxel-derived tetrahedral union of struts. Finite-strain mechanics, volatile transport and material conversion are solved in Rust/Wasm; the viewport displays accepted node positions and local fields.</p><p>A perfect bond fixes contact nodes to a rigid, nonshrinking substrate. Network order is a structural surrogate, not an sp² fraction. Uniform temperature produces uniform solid chemistry in this one-way model; gas gradients do not feed back into char formation. The material is uncalibrated; predictions exclude cracking, delamination, evolving contact, gas-pressure forces and temperature gradients.</p><p>Use mesh refinement and the <a href="/carbonization/strut">radial strut benchmark</a> to inspect numerical behavior. The <a href="/lab">printing lab</a> remains a separate preparation model; this benchmark does not simulate an imported Benchy.</p></div></section>
  </main>;
}
