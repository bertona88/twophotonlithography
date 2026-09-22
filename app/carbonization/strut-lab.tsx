"use client";

import { useEffect, useRef, useState } from "react";
import { PYROLYSIS_FIELDS, type PyrolysisConfig, type PyrolysisDiagnostics, type PyrolysisMessage, type PyrolysisStatus } from "../pyrolysis-types";
import styles from "./carbonization.module.css";

type View = { fields: Float64Array; diagnostics: PyrolysisDiagnostics; config: PyrolysisConfig };
type History = { time: number; solid: number; mobile: number; escaped: number }[];
type Baseline = { view: View; history: History };
const fields = [
  { index: 1, label: "Precursor mass / initial mass", unit: "fraction", max: 1 },
  { index: 2, label: "Char mass / initial mass", unit: "fraction", max: 1 },
  { index: 3, label: "Mobile products / initial mass", unit: "fraction", max: 1 },
  { index: 4, label: "Carbon-network order", unit: "surrogate, not sp²", max: 1 },
  { index: 5, label: "Unresolved micro-porosity", unit: "fraction", max: 1 },
  { index: 6, label: "Stress-free bulk density", unit: "kg/m³", max: 2200 },
  { index: 7, label: "Natural volume ratio J", unit: "stress-free constitutive ratio", max: 1 },
  { index: 10, label: "Actual volume ratio", unit: "solved J", max: 1 },
  { index: 11, label: "Actual solid density", unit: "kg/m³", max: 2200 },
  { index: 12, label: "Radial stretch", unit: "current / reference", max: 1 },
  { index: 13, label: "Hoop stretch", unit: "current / reference", max: 1 },
  { index: 14, label: "Axial stretch", unit: "current / reference", max: 1 },
  { index: 15, label: "Radial Cauchy stress", unit: "Pa · tension positive", max: 1 },
  { index: 16, label: "Hoop Cauchy stress", unit: "Pa · tension positive", max: 1 },
  { index: 17, label: "Axial Cauchy stress", unit: "Pa · tension positive", max: 1 },
];
const stride = PYROLYSIS_FIELDS.length;
const percent = (value: number) => `${(100 * value).toFixed(2)}%`;

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Chart({ series, label, xLabel, yLabel, maximum = 1, minimum = 0 }: {
  series: { values: [number, number][]; color: string; dashed?: boolean; name: string }[];
  label: string; xLabel: string; yLabel: string; maximum?: number; minimum?: number;
}) {
  return <div className={styles.chart}>
    <svg viewBox="0 0 600 240" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 0.5, 1].map(v => <g key={v}><line x1="50" x2="580" y1={200 - v * 165} y2={200 - v * 165} stroke="#303541" /><text x="42" y={204 - v * 165} textAnchor="end">{(minimum + v * (maximum - minimum)).toPrecision(2)}</text></g>)}
      {series.map(s => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dashed ? "6 4" : undefined} points={s.values.map(([x, y]) => `${50 + 530 * x},${200 - 165 * (y - minimum) / (maximum - minimum)}`).join(" ")} />)}
      <text x="50" y="219">0</text><text x="580" y="219" textAnchor="end">1</text>
      <text x="315" y="238" textAnchor="middle">{xLabel}</text><text x="50" y="18">{yLabel}</text>
    </svg>
    <div className={styles.legend}>{series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}{s.dashed ? " (pinned)" : ""}</span>)}</div>
  </div>;
}

export default function CarbonizationLab() {
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const acceptedRunId = useRef(0);
  const acceptedStatus = useRef<PyrolysisStatus>("ready");
  const pendingRequest = useRef(false);
  const sequence = useRef(0);
  const autoStart = useRef(false);
  const [config, setConfig] = useState<PyrolysisConfig | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [history, setHistory] = useState<History>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [status, setStatus] = useState<PyrolysisStatus>("ready");
  const [initialized, setInitialized] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldIndex, setFieldIndex] = useState(3);
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    const instance = new Worker(new URL("../pyrolysis.worker.ts", import.meta.url), { type: "module" });
    worker.current = instance;
    instance.onmessage = ({ data }: MessageEvent<PyrolysisMessage>) => {
      if (data.type === "ready") { setInitialized(true); setConfig(data.defaults); return; }
      if (data.type === "error") {
        if (data.runId === runId.current || data.runId === 0) {
          setError(data.message); autoStart.current = false;
          if (pendingRequest.current) {
            runId.current = acceptedRunId.current;
            setStatus(acceptedStatus.current);
          } else setStatus("error");
          pendingRequest.current = false; setPending(false);
        }
        return;
      }
      if (data.runId !== runId.current) return;
      if (data.type === "checkpoint") {
        download(`carbonization-run-${data.runId}.json`, JSON.stringify(data.checkpoint, null, 2)); return;
      }
      if (data.sequence <= sequence.current) return;
      sequence.current = data.sequence;
      const next = { fields: new Float64Array(data.fields), diagnostics: data.diagnostics, config: data.config };
      acceptedRunId.current = data.runId;
      acceptedStatus.current = data.status;
      pendingRequest.current = false; setPending(false);
      if (data.sequence === 1) setConfig(data.config);
      setView(next); setStatus(data.status);
      const d = data.diagnostics;
      if (d.failure) setError(`${d.failure.code}: ${d.failure.message} (${d.failure.quantity}, cell ${d.failure.cell}, trial ${d.failure.trialTimeS.toPrecision(5)} s)`);
      setHistory(previous => {
        const existing = data.sequence === 1 ? [] : previous;
        if (existing.length && existing[existing.length - 1].time === d.timeS) return existing;
        // Display history only; exported Rust checkpoints retain numerical state.
        const points = existing.length >= 2048 ? existing.filter((_, i) => i % 2 === 0) : existing;
        return [...points, { time: d.timeS, solid: (d.precursorMassKg + d.charMassKg) / d.initialMassKg, mobile: d.mobileMassKg / d.initialMassKg, escaped: d.escapedMassKg / d.initialMassKg }];
      });
      if (data.status === "ready" && autoStart.current) { autoStart.current = false; instance.postMessage({ type: "start", runId: runId.current }); }
    };
    instance.onerror = (event) => { setError(event.message || "Carbonization worker failed"); setStatus("error"); };
    return () => { instance.terminate(); worker.current = null; };
  }, []);

  function start() {
    if (!config || pendingRequest.current) return;
    pendingRequest.current = true; setPending(true);
    runId.current++; sequence.current = 0; autoStart.current = true;
    setError(null); setProbe(0);
    worker.current?.postMessage({ type: "configure", runId: runId.current, config });
  }
  function command(type: "pause" | "resume" | "cancel" | "step" | "export") { if (!pendingRequest.current) worker.current?.postMessage({ type, runId: runId.current }); }
  async function restore(file?: File) {
    if (!file || pendingRequest.current) return;
    pendingRequest.current = true; setPending(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Radial checkpoint exceeds 2 MiB");
      const checkpoint: unknown = JSON.parse(await file.text());
      runId.current++; sequence.current = 0; autoStart.current = false;
      setError(null); setProbe(0);
      worker.current?.postMessage({ type: "restore", runId: runId.current, checkpoint });
    } catch (e) { pendingRequest.current = false; setPending(false); setError(e instanceof Error ? e.message : String(e)); }
  }
  const d = view?.diagnostics;
  const selectedField = fields.find(f => f.index === fieldIndex)!;
  const rows = view ? Array.from({ length: view.diagnostics.radialCells }, (_, i) => Array.from(view.fields.slice(i * stride, (i + 1) * stride))) : [];
  const currentProbe = rows[Math.min(probe, rows.length - 1)];
  const profile = (v: View): [number, number][] => Array.from({ length: v.diagnostics.radialCells }, (_, i) => [v.fields[i * stride] / v.config.radiusM, v.fields[i * stride + fieldIndex]]);
  const duration = Math.max(d?.durationS ?? 1, baseline?.view.diagnostics.durationS ?? 1);
  const plotValues = [...rows.map(r => r[fieldIndex]), ...(baseline ? profile(baseline.view).map(p => p[1]) : [])];
  const minimum = Math.min(0, ...plotValues);
  const maximum = Math.max(selectedField.max, ...plotValues);
  const color = (value: number) => {
    const t = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
    return `hsl(${265 - 215 * t} 75% ${24 + 40 * t}%)`;
  };
  const geometryScale = Math.max(1, (d?.currentRadiusM ?? 0) / (view?.config.radiusM ?? 1));
  const running = status === "running";

  return <main className={styles.lab}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>CARBONIZATION LAB · ELASTIC STRUT</p><h1>Inside the transforming strut</h1><p>Follow material transformation, contraction and constraint stress through a furnace schedule.</p></div><a href="/carbonization">← BCC foam on substrate</a></header>
    <div className={styles.scope}><strong>Coupled long-cylinder benchmark · uncalibrated demonstration material</strong><p>Prescribed uniform specimen temperature and inert atmosphere, with sealed ends. Solve radial deformation and a uniform axial stretch; natural volume and actual volume are distinct. Network order is a structural surrogate, not an sp² percentage. This elastic long-cylinder reduction excludes end effects, bending, buckling, relaxation, gas pressure and whole-Benchy mechanics.</p></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    <div className={styles.layout}>
      <aside className={styles.panel}>
        <h2>Specimen & schedule</h2>
        {!config ? <p>{error ? "Solver unavailable." : "Initializing Rust/Wasm…"}</p> : <>
          <fieldset disabled={running || pending}>
            <label>Radius (µm)<input type="number" min="0.01" max="1000" step="0.1" value={config.radiusM * 1e6} onChange={e => setConfig({ ...config, radiusM: e.target.valueAsNumber * 1e-6 })} /></label>
            <label>Reference length (µm)<input type="number" min="0.01" max="1000000" value={config.lengthM * 1e6} onChange={e => setConfig({ ...config, lengthM: e.target.valueAsNumber * 1e-6 })} /></label>
            <label>Radial cells<select value={config.radialCells} onChange={e => setConfig({ ...config, radialCells: Number(e.target.value) })}>{[16, 32, 64, 128, 256].map(n => <option key={n}>{n}</option>)}</select></label>
            <p className={styles.note}>Independent synthetic cylinder. It is not a sampled strut from the Benchy. End and junction effects are outside this reduction.</p>
            <h3>Mechanics & supports</h3>
            <label>Geometry model<select value={config.mechanics.enabled ? "coupled" : "fixed"} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, enabled: e.target.value === "coupled" } })}><option value="coupled">Solved finite-strain deformation</option><option value="fixed">Fixed-reference transport control</option></select></label>
            <fieldset disabled={!config.mechanics.enabled}>
              <label>Axial boundary<select value={config.mechanics.axialBoundary} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, axialBoundary: e.target.value as PyrolysisConfig["mechanics"]["axialBoundary"] } })}><option value="free">Force-free</option><option value="prescribed">Prescribed anchor separation</option><option value="compliant">Compliant axial spring</option></select></label>
              {config.mechanics.axialBoundary !== "free" && <label>Final anchor separation / initial length<input type="number" min="0.2" max="2" step="0.05" value={config.mechanics.finalAnchorStretch} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, finalAnchorStretch: e.target.valueAsNumber } })} /></label>}
              {config.mechanics.axialBoundary === "compliant" && <label>Axial spring stiffness (N/m)<input type="number" min="0" max="1000000" step="1" value={config.mechanics.axialStiffnessNM} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, axialStiffnessNM: e.target.valueAsNumber } })} /></label>}
              <label>Shear modulus (MPa)<input type="number" min="0.000001" max="1000000" value={config.mechanics.shearModulusPa / 1e6} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, shearModulusPa: e.target.valueAsNumber * 1e6 } })} /></label>
              <label>Poisson ratio<input type="number" min="0" max="0.45" step="0.05" value={config.mechanics.poissonRatio} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, poissonRatio: e.target.valueAsNumber } })} /></label>
              <label>Thermal expansion (1/K)<input type="number" min="0" max="0.0005" step="0.00001" value={config.mechanics.thermalExpansionPerK} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, thermalExpansionPerK: e.target.valueAsNumber } })} /></label>
              <label>Hypothetical axial anisotropy<input type="number" min="-1" max="1" step="0.1" value={config.mechanics.axialAnisotropy} onChange={e => setConfig({ ...config, mechanics: { ...config.mechanics, axialAnisotropy: e.target.valueAsNumber } })} /></label>
            </fieldset>
            <p className={styles.note}>The outer surface is traction-free. Anchors move linearly from the initial separation over the whole schedule. An axial constraint is not a bonded end-face model. Modulus is constant; relaxation is not modeled.</p>
            <h3>Temperature waypoints</h3>
            <div className={styles.waypointLabels}><span>Time (min)</span><span>Specimen (°C)</span></div>
            {config.schedule.map((point, i) => <div className={styles.waypoint} key={i}>
              <input aria-label={`Waypoint ${i + 1} time in minutes`} type="number" min="0" disabled={i === 0} value={point.timeS / 60} onChange={e => setConfig({ ...config, schedule: config.schedule.map((p, j) => j === i ? { ...p, timeS: e.target.valueAsNumber * 60 } : p) })} />
              <input aria-label={`Waypoint ${i + 1} temperature in Celsius`} type="number" min="0" max="1400" value={Math.round((point.temperatureK - 273.15) * 100) / 100} onChange={e => setConfig({ ...config, schedule: config.schedule.map((p, j) => j === i ? { ...p, temperatureK: e.target.valueAsNumber + 273.15 } : p) })} />
            </div>)}
            <p className={styles.note}>Linear ramps between points; equal temperatures create a hold. Reactions use Kelvin and seconds.</p>
            <details><summary>Material & numerical controls</summary>
              <label>Char mass yield<input type="number" min="0" max="1" step="0.05" value={config.material.charYield} onChange={e => setConfig({ ...config, material: { ...config.material, charYield: e.target.valueAsNumber } })} /></label>
              <label>Base diffusivity (m²/s)<input type="number" min="0" step="1e-16" value={config.material.diffusivityM2S} onChange={e => setConfig({ ...config, material: { ...config.material, diffusivityM2S: e.target.valueAsNumber } })} /></label>
              <label>Surface transfer (m/s)<input type="number" min="0" step="1e-8" value={config.material.surfaceTransferMS} onChange={e => setConfig({ ...config, material: { ...config.material, surfaceTransferMS: e.target.valueAsNumber } })} /></label>
              <label>Maximum increment (s)<input type="number" min="0.000001" max="600" value={config.maxStepS} onChange={e => setConfig({ ...config, maxStepS: e.target.valueAsNumber })} /></label>
              <label>Relative tolerance<input type="number" min="1e-8" max="0.1" step="0.0001" value={config.relativeTolerance} onChange={e => setConfig({ ...config, relativeTolerance: e.target.valueAsNumber })} /></label>
              <p className={styles.note}>Changing gas escape does not create a solid-state gradient in this one-way material. All rates and validity bounds are included in the exported checkpoint.</p>
            </details>
          </fieldset>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={!initialized || running || pending} onClick={start}>{pending ? "Preparing run…" : view ? "Run again with these inputs" : "Run benchmark"}</button>
            <button disabled={!running} onClick={() => command("pause")}>Pause</button>
            <button disabled={status !== "paused" && !(status === "ready" && view)} onClick={() => command("resume")}>Resume</button>
            <button disabled={status !== "paused" && !(status === "ready" && view)} onClick={() => command("step")}>One step</button>
            <button disabled={!running && status !== "paused"} onClick={() => command("cancel")}>Cancel</button>
          </div>
          <label className={styles.file}>Restore a saved radial checkpoint<input type="file" accept=".json,application/json" disabled={!initialized || running || pending} onChange={e => { void restore(e.target.files?.[0]); e.target.value = ""; }} /></label>
        </>}
      </aside>
      <section className={styles.results} aria-label="Carbonization results">
        <div className={styles.panel}>
          <div className={styles.resultHeader}><h2>Solved section & material profiles</h2><span className={styles.badge} role="status">{initialized ? status : "initializing"}</span></div>
          <label>Inspect field<select value={fieldIndex} onChange={e => setFieldIndex(Number(e.target.value))}>{fields.map(f => <option key={f.index} value={f.index}>{f.label}</option>)}</select></label>
          {view && d ? <>
            <div className={styles.metrics}>
              <div><span>Accepted time</span><strong>{(d.timeS / 60).toFixed(2)} min</strong></div>
              <div><span>Specimen temperature</span><strong>{(d.specimenTemperatureK - 273.15).toFixed(1)} °C</strong></div>
              <div><span>Solid retained</span><strong>{percent((d.precursorMassKg + d.charMassKg) / d.initialMassKg)}</strong></div>
              <div><span>Products escaped</span><strong>{percent(d.escapedMassKg / d.initialMassKg)}</strong></div>
              <div><span>Current diameter</span><strong>{(2 * d.currentRadiusM * 1e6).toPrecision(4)} µm</strong></div>
              <div><span>Current length</span><strong>{(d.currentLengthM * 1e6).toPrecision(4)} µm</strong></div>
              <div><span>Diameter shrinkage</span><strong>{percent(1 - d.currentRadiusM / view.config.radiusM)}</strong></div>
              <div><span>Length shrinkage</span><strong>{percent(1 - d.currentLengthM / view.config.lengthM)}</strong></div>
            </div>
            <progress value={d.timeS} max={d.durationS} aria-label="Heating schedule progress" />
            <div className={styles.profile}>
              <svg viewBox="0 0 220 240" role="img" aria-label={`${selectedField.label} across the current circular section`}>
                <title>Current section from Rust deformation; dashed outline is the dry reference</title>
                {[...rows].reverse().map((row, j) => <circle key={j} cx="110" cy="110" r={100 * row[18] / view.config.radiusM / geometryScale} fill={color(row[fieldIndex])} />)}
                <circle cx="110" cy="110" r={100 * (currentProbe?.[9] ?? 0) / view.config.radiusM / geometryScale} fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="3 3" />
                <circle cx="110" cy="110" r={100 / geometryScale} fill="none" stroke="#9ba2b5" strokeDasharray="5 4" />
                <text x="110" y="235" textAnchor="middle" fill="#cbd0de">Current R = {(d.currentRadiusM * 1e6).toPrecision(3)} µm</text>
              </svg>
              <Chart label={`${selectedField.label} radial profile`} xLabel="Material radius / reference radius" yLabel={selectedField.unit} maximum={maximum} minimum={minimum} series={[
                { name: "Current", color: "#b9a0ff", values: profile(view) },
                ...(baseline ? [{ name: "Comparison", color: "#ffbe70", values: profile(baseline.view), dashed: true }] : []),
              ]} />
            </div>
            <label>Material probe · annulus {Math.min(probe, rows.length - 1) + 1} / {rows.length}<input type="range" min="0" max={rows.length - 1} value={Math.min(probe, rows.length - 1)} onChange={e => setProbe(Number(e.target.value))} /></label>
            {currentProbe && <div className={styles.probe}><span>Reference R = {(currentProbe[0] * 1e6).toPrecision(4)} µm · current r = {(currentProbe[9] * 1e6).toPrecision(4)} µm</span><strong>{selectedField.label}: {currentProbe[fieldIndex].toPrecision(5)}</strong><span>{selectedField.unit}</span></div>}
          </> : <div className={styles.empty}>Set a schedule and run the benchmark to inspect the authoritative radial state.</div>}
        </div>
        {view && d && <div className={styles.panel}>
          <h2>Where the mass goes</h2>
          <Chart label="Solid, mobile and escaped mass over physical time" xLabel={`Time / ${ (duration / 60).toFixed(1) } min`} yLabel="Mass / initial dry mass" series={[
            { name: "Solid", color: "#b9a0ff", values: history.map(p => [p.time / duration, p.solid]) },
            { name: "Mobile", color: "#6ed6ce", values: history.map(p => [p.time / duration, p.mobile]) },
            { name: "Escaped", color: "#ffbe70", values: history.map(p => [p.time / duration, p.escaped]) },
            ...(baseline ? [{ name: "Comparison solid", color: "#d3c5fa", dashed: true, values: baseline.history.map(p => [p.time / duration, p.solid] as [number, number]) }] : []),
          ]} />
          <dl className={styles.diagnostics}>
            <div><dt>Initial dry mass</dt><dd>{(d.initialMassKg * 1e15).toPrecision(5)} pg</dd></div>
            <div><dt>Char / initial mass</dt><dd>{percent(d.charMassKg / d.initialMassKg)}</dd></div>
            <div><dt>Actual volume / dry volume</dt><dd>{d.volumeRatio.toPrecision(5)}</dd></div>
            <div><dt>Axial specimen force (tension positive)</dt><dd>{(d.axialForceN * 1e6).toPrecision(5)} µN</dd></div>
            <div><dt>Normalized equilibrium residual</dt><dd>{d.mechanicalResidual.toExponential(2)}</dd></div>
            <div><dt>Geometry model</dt><dd>{view.config.mechanics.enabled ? "Coupled elastic cylinder" : "Fixed-reference control"}</dd></div>
            <div><dt>Mass balance error</dt><dd>{d.relativeMassError.toExponential(2)}</dd></div>
            <div><dt>Accepted / rejected increments</dt><dd>{d.acceptedSteps} / {d.rejectedSteps}</dd></div>
            <div><dt>Estimated peak solver memory</dt><dd>{(d.estimatedPeakBytes / 1024).toFixed(0)} KiB</dd></div>
            <div><dt>Accepted-state checksum</dt><dd>{d.checksum}</dd></div>
          </dl>
          <div className={styles.actions}>
            <button disabled={running} onClick={() => setBaseline({ view, history })}>Pin as comparison</button>
            <button disabled={!baseline} onClick={() => setBaseline(null)}>Clear comparison</button>
            <button onClick={() => command("export")}>Export checkpoint</button>
            <button onClick={() => download("carbonization-profile.csv", `# ${d.modelVersion}; time_s=${d.timeS}; ${d.geometry}; ${d.calibration}\n${d.fieldOrder}\n${rows.map(r => r.join(",")).join("\n")}\n`, "text/csv")}>Export radial CSV</button>
          </div>
          {baseline && <p className={styles.note}>Pinned run: R = {(baseline.view.config.radiusM * 1e6).toPrecision(3)} µm, {baseline.view.diagnostics.radialCells} cells, accepted time {(baseline.view.diagnostics.timeS / 60).toFixed(2)} min. Profiles compare normalized reference radius.</p>}
          <p className={styles.note}>Charts sample accepted snapshots. Export a checkpoint to preserve the full radial state, configuration and adaptive timestep for deterministic continuation. Pinning a comparison lasts for this page session.</p>
        </div>}
        <div className={styles.panel}><h2>From developed polymer to carbon</h2><p>The printing lab can export an audited, full-resolution dry specimen with its preparation assumptions, mass ledger and connected fragments. This radial benchmark uses its own synthetic cylinder. The current mechanics solve is restricted to the long cylinder. The BCC foam benchmark adds a three-dimensional tetrahedral specimen with a bonded substrate and relaxation. Arbitrary imported-object mechanics remain outside this benchmark.</p><a href="/carbonization">Open BCC foam benchmark →</a></div>
      </section>
    </div>
  </main>;
}
