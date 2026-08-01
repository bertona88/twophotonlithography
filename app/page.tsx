"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type { FieldMode } from "./lab-viewport";
import { shouldIgnoreLabShortcut } from "./keyboard-shortcuts";
import { multipassPathProgress } from "./volume-visualization";

const LabViewport = dynamic(() => import("./lab-viewport"), {
  ssr: false,
});

type LabStage =
  | "model"
  | "slicing"
  | "ready"
  | "exposing"
  | "paused"
  | "developing"
  | "complete"
  | "compare";

type PanelTab = "specimen" | "path" | "light" | "resin" | "development";
type DirtyKind = "slice" | "physics" | null;
type PresetKey = "wake" | "cliff" | "fine";

type ModelParams = {
  layerHeight: number;
  hatchSpacing: number;
  hatchAngle: number;
  contourCount: number;
  passes: number;
  power: number;
  speed: number;
  repetitionRate: number;
  pulseDuration: number;
  wavelength: number;
  na: number;
  initiator: number;
  oxygen: number;
  piDepletion: number;
  radicalYield: number;
  darkLoss: number;
  oxygenQuench: number;
  termination: number;
  propagation: number;
  oxygenDiffusion: number;
  radicalDiffusion: number;
  piDiffusion: number;
  gelPoint: number;
  developerRate: number;
  developerResistance: number;
  developmentTime: number;
};

type ModelKey = keyof ModelParams;

type ChemistryMetrics = {
  oxygenMean: number;
  conversionMean: number;
  radicalMax: number;
  gelledFraction: number;
  survivingFraction: number;
};

type Metrics = ChemistryMetrics & {
  pulseEnergyPj: number;
  peakPowerW: number;
  checksum: string;
  cellSizeNm: number;
};

type LensMetrics = ChemistryMetrics & {
  cellSizeNm: number;
  timestepModel: number;
};

type SolverState = "initializing" | "ready" | "error";

type SolverDiagnostics = {
  solver: "Rust/Wasm";
  gridWidth: number;
  gridHeight: number;
  timestepModel: number;
  updatesPerSecond: number;
  simulatedModelTime: number;
  ownedMemoryBytes: number;
  wasmMemoryBytes: number;
  checksum: string;
};

type VolumeDiagnostics = {
  solver: string;
  qualityTier: string;
  gridWidth: number;
  gridHeight: number;
  gridDepth: number;
  voxelPitchUm: [number, number, number];
  memoryBudgetBytes: number;
  ownedMemoryBytes: number;
  downgradeReason?: string;
  psfModel: string;
  psfPupilSamples: number;
  psfKernelVoxels: number;
  scanPoints: number;
  layerCount: number;
  pathLengthUm: number;
  estimatedExposureSeconds: number;
  simulatedTimeSeconds: number;
  oxygenMean: number;
  radicalMax: number;
  conversionMean: number;
  gelledFraction: number;
  survivingFraction: number;
  checksum: string;
};

type SliceInfo = {
  layerCount: number;
  pathLengthUm: number;
  estimatedExposureSeconds: number;
};

type RunResult = {
  metrics: Metrics;
  lensMetrics: LensMetrics;
  conversion: Uint8Array;
  oxygen: Uint8Array;
  radicals: Uint8Array;
  remaining: Uint8Array;
  lensPixels: Uint8Array;
  lensWidth: number;
  lensHeight: number;
  diagnostics: SolverDiagnostics;
  volumeDiagnostics: VolumeDiagnostics;
  diffusion: number;
};

type ParameterDefinition = {
  key: ModelKey;
  name: string;
  symbol: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  provenance?: "input" | "published" | "exploratory";
  log?: boolean;
};

const DEFAULT_PARAMS: ModelParams = {
  layerHeight: 0.48,
  hatchSpacing: 0.72,
  hatchAngle: 37,
  contourCount: 2,
  passes: 1,
  power: 16,
  speed: 45,
  repetitionRate: 80,
  pulseDuration: 100,
  wavelength: 780,
  na: 1.4,
  initiator: 1,
  oxygen: 1,
  piDepletion: 0.02,
  radicalYield: 1,
  darkLoss: 0.15,
  oxygenQuench: 8,
  termination: 2,
  propagation: 0.7,
  oxygenDiffusion: 0.0035,
  radicalDiffusion: 0.00008,
  piDiffusion: 0.00036,
  gelPoint: 0.3,
  developerRate: 1.5,
  developerResistance: 9,
  developmentTime: 45,
};

const SLICER_KEYS = new Set<ModelKey>([
  "layerHeight",
  "hatchSpacing",
  "hatchAngle",
  "contourCount",
  "passes",
  "speed",
]);

const PARAMETER_GROUPS: Record<Exclude<PanelTab, "specimen">, ParameterDefinition[]> =
  {
    path: [
      {
        key: "layerHeight",
        name: "Layer height",
        symbol: "Δz",
        unit: "µm",
        min: 0.25,
        max: 1.2,
        step: 0.01,
        provenance: "input",
      },
      {
        key: "hatchSpacing",
        name: "Hatch spacing",
        symbol: "h",
        unit: "µm",
        min: 0.25,
        max: 1.8,
        step: 0.01,
        provenance: "input",
      },
      {
        key: "hatchAngle",
        name: "Hatch angle",
        symbol: "θ",
        unit: "°",
        min: 0,
        max: 180,
        step: 1,
        provenance: "input",
      },
      {
        key: "contourCount",
        name: "Contour passes",
        symbol: "N꜀",
        unit: "",
        min: 1,
        max: 4,
        step: 1,
        provenance: "input",
      },
      {
        key: "passes",
        name: "Exposure passes",
        symbol: "Nₚ",
        unit: "",
        min: 1,
        max: 3,
        step: 1,
        provenance: "input",
      },
    ],
    light: [
      {
        key: "power",
        name: "Specimen power",
        symbol: "P",
        unit: "mW",
        min: 6,
        max: 32,
        step: 0.1,
        provenance: "input",
      },
      {
        key: "speed",
        name: "Scan speed",
        symbol: "v",
        unit: "µm/s",
        min: 8,
        max: 140,
        step: 1,
        provenance: "input",
      },
      {
        key: "na",
        name: "Numerical aperture",
        symbol: "NA",
        unit: "",
        min: 0.7,
        max: 1.49,
        step: 0.01,
        provenance: "input",
      },
      {
        key: "wavelength",
        name: "Wavelength",
        symbol: "λ",
        unit: "nm",
        min: 720,
        max: 1064,
        step: 1,
        provenance: "input",
      },
      {
        key: "pulseDuration",
        name: "Pulse duration",
        symbol: "τₚ",
        unit: "fs",
        min: 50,
        max: 400,
        step: 1,
        provenance: "input",
      },
      {
        key: "repetitionRate",
        name: "Repetition rate",
        symbol: "f",
        unit: "MHz",
        min: 10,
        max: 100,
        step: 1,
        provenance: "input",
      },
    ],
    resin: [
      {
        key: "initiator",
        name: "Initial photoinitiator",
        symbol: "p₀",
        unit: "rel.",
        min: 0.2,
        max: 2,
        step: 0.01,
        provenance: "exploratory",
      },
      {
        key: "oxygen",
        name: "Boundary oxygen",
        symbol: "o₀",
        unit: "rel.",
        min: 0,
        max: 2,
        step: 0.01,
        provenance: "exploratory",
      },
      {
        key: "piDepletion",
        name: "PI depletion",
        symbol: "β",
        unit: "T₀⁻¹",
        min: 0,
        max: 0.12,
        step: 0.001,
        provenance: "published",
      },
      {
        key: "radicalYield",
        name: "Radical yield",
        symbol: "η",
        unit: "rel.",
        min: 0.1,
        max: 3,
        step: 0.01,
        provenance: "exploratory",
      },
      {
        key: "darkLoss",
        name: "Dark radical loss",
        symbol: "δ",
        unit: "T₀⁻¹",
        min: 0,
        max: 1,
        step: 0.01,
        provenance: "exploratory",
      },
      {
        key: "oxygenQuench",
        name: "Oxygen quenching",
        symbol: "q",
        unit: "rel.",
        min: 0,
        max: 16,
        step: 0.1,
        provenance: "published",
      },
      {
        key: "termination",
        name: "Bimolecular termination",
        symbol: "κ",
        unit: "rel.",
        min: 0,
        max: 8,
        step: 0.05,
        provenance: "exploratory",
      },
      {
        key: "propagation",
        name: "Propagation",
        symbol: "γ",
        unit: "T₀⁻¹",
        min: 0.05,
        max: 2,
        step: 0.01,
        provenance: "exploratory",
      },
      {
        key: "oxygenDiffusion",
        name: "Oxygen diffusion",
        symbol: "Dₒ",
        unit: "L₀²/T₀",
        min: 0,
        max: 0.012,
        step: 0.0001,
        provenance: "published",
      },
      {
        key: "radicalDiffusion",
        name: "Radical diffusion",
        symbol: "Dᵣ",
        unit: "L₀²/T₀",
        min: 0,
        max: 0.003,
        step: 0.00001,
        provenance: "exploratory",
      },
      {
        key: "piDiffusion",
        name: "PI diffusion",
        symbol: "Dₚ",
        unit: "L₀²/T₀",
        min: 0,
        max: 0.003,
        step: 0.00001,
        provenance: "published",
      },
      {
        key: "gelPoint",
        name: "Gel point",
        symbol: "xᵍ",
        unit: "conv.",
        min: 0.1,
        max: 0.7,
        step: 0.01,
        provenance: "exploratory",
      },
    ],
    development: [
      {
        key: "developerRate",
        name: "Base dissolution",
        symbol: "k₀",
        unit: "T₀⁻¹",
        min: 0.1,
        max: 4,
        step: 0.05,
        provenance: "exploratory",
      },
      {
        key: "developerResistance",
        name: "Gel resistance",
        symbol: "aₖ",
        unit: "",
        min: 1,
        max: 16,
        step: 0.1,
        provenance: "exploratory",
      },
      {
        key: "developmentTime",
        name: "Development time",
        symbol: "tᵈ",
        unit: "T₀",
        min: 5,
        max: 120,
        step: 1,
        provenance: "input",
      },
    ],
  };

const EMPTY_METRICS: Metrics = {
  oxygenMean: 1,
  conversionMean: 0,
  radicalMax: 0,
  gelledFraction: 0,
  survivingFraction: 1,
  pulseEnergyPj: 200,
  peakPowerW: 2000,
  checksum: "00000000",
  cellSizeNm: 135,
};

const EMPTY_LENS_METRICS: LensMetrics = {
  oxygenMean: 1,
  conversionMean: 0,
  radicalMax: 0,
  gelledFraction: 0,
  survivingFraction: 1,
  cellSizeNm: 135,
  timestepModel: 0.016,
};

const EMPTY_SOLVER_DIAGNOSTICS: SolverDiagnostics = {
  solver: "Rust/Wasm",
  gridWidth: 112,
  gridHeight: 68,
  timestepModel: 0.016,
  updatesPerSecond: 0,
  simulatedModelTime: 0,
  ownedMemoryBytes: 0,
  wasmMemoryBytes: 0,
  checksum: "00000000",
};

const FIELD_LABELS: Record<FieldMode, { label: string; color: string }> = {
  conversion: { label: "Conversion", color: "#ff8a3d" },
  oxygen: { label: "Oxygen", color: "#46d8ff" },
  radicals: { label: "Radicals", color: "#ffca5a" },
  development: { label: "Remaining mass", color: "#f1e4c8" },
};

const PANEL_LABELS: Record<PanelTab, { short: string; full: string; glyph: string }> =
  {
    specimen: { short: "Model", full: "Specimen", glyph: "◇" },
    path: { short: "Path", full: "Slicing & path", glyph: "≋" },
    light: { short: "Light", full: "Light & motion", glyph: "⌁" },
    resin: { short: "Resin", full: "Reaction model", glyph: "∿" },
    development: { short: "Develop", full: "Development", glyph: "∇" },
  };

const MOBILE_LAYOUT_QUERY =
  "(max-width: 840px), (max-height: 540px) and (pointer: coarse) and (orientation: landscape)";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "wake", label: "Twice-written wake" },
  { key: "cliff", label: "Power cliff" },
  { key: "fine", label: "Fine roof" },
];

function formatNumber(value: number, digits = 2) {
  if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatMemory(bytes: number) {
  if (!bytes) return "memory pending";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB linear memory`;
}

function ParamRow({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: ParameterDefinition;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const provenance = definition.provenance ?? "input";
  return (
    <div className="param-row">
      <div className="param-row-heading">
        <div>
          <span className="param-symbol">{definition.symbol}</span>
          <span className="param-name">{definition.name}</span>
        </div>
        <span className={`provenance provenance-${provenance}`}>{provenance}</span>
      </div>
      <div className="param-control">
        <input
          aria-label={definition.name}
          type="range"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <label className="numeric-entry">
          <input
            aria-label={`${definition.name} numeric value`}
            type="number"
            min={definition.min}
            max={definition.max}
            step={definition.step}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span>{definition.unit}</span>
        </label>
      </div>
    </div>
  );
}

function ReactionLens({
  pixels,
  width,
  height,
  fieldMode,
  onFieldMode,
  mobileOpen,
  onMobileClose,
  metrics,
  solverState,
  diagnostics,
}: {
  pixels: Uint8Array | null;
  width: number;
  height: number;
  fieldMode: FieldMode;
  onFieldMode: (mode: FieldMode) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  metrics: LensMetrics;
  solverState: SolverState;
  diagnostics: SolverDiagnostics;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels || !width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const image = context.createImageData(width, height);

    for (let index = 0; index < width * height; index += 1) {
      const oxygenValue = pixels[index * 4] / 255;
      const radicalValue = pixels[index * 4 + 1] / 255;
      const conversionValue = pixels[index * 4 + 2] / 255;
      const remainingValue = pixels[index * 4 + 3] / 255;
      let red = 6;
      let green = 8;
      let blue = 16;
      let intensity = 0;

      if (fieldMode === "oxygen") {
        intensity = oxygenValue;
        red += 64 * intensity;
        green += 204 * intensity;
        blue += 239 * intensity;
      } else if (fieldMode === "radicals") {
        intensity = radicalValue;
        red += 249 * intensity;
        green += 187 * intensity;
        blue += 74 * intensity;
      } else if (fieldMode === "development") {
        intensity = remainingValue * Math.min(1, conversionValue * 2.2);
        red += 235 * intensity;
        green += 222 * intensity;
        blue += 194 * intensity;
      } else {
        intensity = conversionValue;
        const gel = Math.max(0, (conversionValue - 0.3) / 0.7);
        red += 245 * intensity;
        green += 112 * intensity + 100 * gel;
        blue += 34 * intensity + 155 * gel;
      }

      image.data[index * 4] = Math.min(255, red);
      image.data[index * 4 + 1] = Math.min(255, green);
      image.data[index * 4 + 2] = Math.min(255, blue);
      image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [pixels, width, height, fieldMode]);

  return (
    <section
      className={`reaction-lens glass-panel ${mobileOpen ? "mobile-open" : ""}`}
      id="reaction-lens-panel"
      aria-label="2D Reaction Lens diagnostic"
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <div className="lens-heading">
        <div>
          <span className="eyebrow">Reaction Lens · 2D diagnostic</span>
          <strong>15 × 9 µm · XZ field</strong>
        </div>
        <span className="live-indicator">
          <i />
          {solverState === "ready" ? `${metrics.cellSizeNm} nm cells` : solverState}
        </span>
        <button
          className="mobile-lens-close"
          onClick={onMobileClose}
          type="button"
          aria-label="Close Reaction Lens"
        >
          ×
        </button>
      </div>
      <div className="lens-canvas-wrap">
        <canvas ref={canvasRef} className="lens-canvas" />
        <div className="lens-reticle" aria-hidden="true" />
        <span className="axis axis-x">X</span>
        <span className="axis axis-z">Z</span>
      </div>
      <div className="field-selector">
        {(Object.keys(FIELD_LABELS) as FieldMode[]).map((mode) => (
          <button
            key={mode}
            className={fieldMode === mode ? "active" : ""}
            onClick={() => onFieldMode(mode)}
            style={{ "--field-color": FIELD_LABELS[mode].color } as React.CSSProperties}
            type="button"
          >
            <i />
            {FIELD_LABELS[mode].label}
          </button>
        ))}
      </div>
      <div className="lens-readouts">
        <span>
          O₂ <strong>{(metrics.oxygenMean * 100).toFixed(1)}%</strong>
        </span>
        <span>
          R max <strong>{metrics.radicalMax.toFixed(2)}</strong>
        </span>
        <span>
          x̄ <strong>{(metrics.conversionMean * 100).toFixed(1)}%</strong>
        </span>
        <span>
          gel <strong>{(metrics.gelledFraction * 100).toFixed(1)}%</strong>
        </span>
      </div>
      <div
        className="lens-diagnostics"
        aria-label="2D Reaction Lens solver diagnostics"
      >
        <span>
          <strong>{diagnostics.solver}</strong>
          {`${diagnostics.gridWidth}×${diagnostics.gridHeight}`}
        </span>
        <span>
          <strong>2D lens tier</strong>
          {`Δt ${diagnostics.timestepModel.toFixed(3)} T₀`}
        </span>
        <span>
          <strong>{formatMemory(diagnostics.ownedMemoryBytes)}</strong>
          {`2D owned · t ${diagnostics.simulatedModelTime.toFixed(2)} T₀`}
        </span>
        <span>
          <strong>{formatMemory(diagnostics.wasmMemoryBytes)}</strong>
          {`total · replay ${diagnostics.checksum}`}
        </span>
      </div>
    </section>
  );
}

function stageLabel(stage: LabStage, exposureProgress: number) {
  if (stage === "paused" && exposureProgress >= 0.999) return "Exposure complete";
  return (
    {
      model: "Specimen ready",
      slicing: "Compiling path",
      ready: "Path ready",
      exposing: "Exposure running",
      paused: "Exposure paused",
      developing: "Developer advancing",
      complete: "Developed structure",
      compare: "Comparison complete",
    } as Record<LabStage, string>
  )[stage];
}

function processIndex(stage: LabStage, exposureProgress: number) {
  if (stage === "model" || stage === "slicing") return stage === "model" ? 0 : 1;
  if (stage === "ready") return 1;
  if (stage === "exposing" || stage === "paused") {
    return exposureProgress >= 0.999 ? 2 : 2;
  }
  return 3;
}

export default function Home() {
  const workerRef = useRef<Worker | null>(null);
  const variantRunningRef = useRef(false);
  const variantDiffusionRef = useRef(DEFAULT_PARAMS.oxygenDiffusion);
  const lensTriggerRef = useRef<HTMLButtonElement | null>(null);
  const parameterSheetRef = useRef<HTMLElement | null>(null);
  const parameterCloseRef = useRef<HTMLButtonElement | null>(null);
  const latestArraysRef = useRef<{
    conversion: Uint8Array;
    oxygen: Uint8Array;
    radicals: Uint8Array;
    remaining: Uint8Array;
  } | null>(null);

  const [params, setParams] = useState<ModelParams>(DEFAULT_PARAMS);
  const [stage, setStage] = useState<LabStage>("model");
  const [panelTab, setPanelTab] = useState<PanelTab>("resin");
  const [panelOpen, setPanelOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobileLensOpen, setMobileLensOpen] = useState(false);
  const [dirty, setDirty] = useState<DirtyKind>(null);
  const [fieldMode, setFieldMode] = useState<FieldMode>("conversion");
  const [pathPositions, setPathPositions] = useState<Float32Array | null>(null);
  const [layerPositions, setLayerPositions] = useState<Float32Array | null>(null);
  const [macroPositions, setMacroPositions] = useState<Float32Array | null>(null);
  const [conversion, setConversion] = useState<Uint8Array | null>(null);
  const [oxygen, setOxygen] = useState<Uint8Array | null>(null);
  const [radicals, setRadicals] = useState<Uint8Array | null>(null);
  const [remaining, setRemaining] = useState<Uint8Array | null>(null);
  const [lensPixels, setLensPixels] = useState<Uint8Array | null>(null);
  const [lensWidth, setLensWidth] = useState(112);
  const [lensHeight, setLensHeight] = useState(68);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [lensMetrics, setLensMetrics] =
    useState<LensMetrics>(EMPTY_LENS_METRICS);
  const [sliceInfo, setSliceInfo] = useState<SliceInfo | null>(null);
  const [appliedPasses, setAppliedPasses] = useState(DEFAULT_PARAMS.passes);
  const [exposureProgress, setExposureProgress] = useState(0);
  const [developmentProgress, setDevelopmentProgress] = useState(0);
  const [simulatedSeconds, setSimulatedSeconds] = useState(0);
  const [focus, setFocus] = useState<[number, number, number]>([0, 0, 7]);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [variant, setVariant] = useState<RunResult | null>(null);
  const [comparisonView, setComparisonView] = useState<"A" | "B">("B");
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [solverState, setSolverState] =
    useState<SolverState>("initializing");
  const [solverError, setSolverError] = useState<string | null>(null);
  const [solverDiagnostics, setSolverDiagnostics] =
    useState<SolverDiagnostics>(EMPTY_SOLVER_DIAGNOSTICS);
  const [volumeDiagnostics, setVolumeDiagnostics] =
    useState<VolumeDiagnostics | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const orientationQuery = window.matchMedia("(orientation: landscape)");
    let previousMatch = mobileQuery.matches;

    const applyLayout = (matches: boolean, initial = false) => {
      setIsMobileLayout(matches);
      setMobileLensOpen(false);
      if (initial) {
        setPanelOpen(!matches);
      } else if (matches || previousMatch !== matches) {
        setPanelOpen(false);
      }
      previousMatch = matches;
    };

    applyLayout(mobileQuery.matches, true);
    const handleChange = (event: MediaQueryListEvent) => {
      applyLayout(event.matches);
    };
    const handleOrientationChange = () => {
      if (!mobileQuery.matches) return;
      setPanelOpen(false);
      setMobileLensOpen(false);
    };
    mobileQuery.addEventListener("change", handleChange);
    orientationQuery.addEventListener("change", handleOrientationChange);
    return () => {
      mobileQuery.removeEventListener("change", handleChange);
      orientationQuery.removeEventListener("change", handleOrientationChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobileLayout || !panelOpen) return;
    const dialog = parameterSheetRef.current;
    if (!dialog) return;

    const returnTarget =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPanelOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKey);
    const focusFrame = window.requestAnimationFrame(() => {
      parameterCloseRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKey);
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
  }, [isMobileLayout, panelOpen]);

  useEffect(() => {
    const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "solverStatus") {
        setSolverState(message.status);
        if (message.status === "ready") {
          setSolverError(null);
          if (message.diagnostics) {
            setSolverDiagnostics(message.diagnostics);
          }
        }
        if (message.status === "error") {
          variantRunningRef.current = false;
          setSolverError(message.message || "The Rust/Wasm solver could not initialize.");
        }
        return;
      }
      if (message.type === "commandError") {
        if (variantRunningRef.current) {
          variantRunningRef.current = false;
          setBaseline(null);
          setVariant(null);
        }
        setNotice(message.message || "The simulation command was rejected.");
        if (message.stage) {
          setStage(message.stage);
        }
        if (message.command === "slice") {
          setDirty("slice");
        } else if (message.command === "configure") {
          setDirty("physics");
        }
        return;
      }
      if (message.type === "sliceResult") {
        setPathPositions(new Float32Array(message.pathPositions));
        setMacroPositions(new Float32Array(message.renderPositions));
        setLayerPositions(new Float32Array(message.layerPositions));
        setSliceInfo({
          layerCount: message.layerCount,
          pathLengthUm: message.pathLengthUm,
          estimatedExposureSeconds: message.estimatedExposureSeconds,
        });
        setAppliedPasses(
          Number.isFinite(message.passes) ? message.passes : DEFAULT_PARAMS.passes,
        );
        setSelectedLayer(Math.max(0, Math.floor(message.layerCount * 0.43)));
        setStage("ready");
        return;
      }
      if (message.type !== "snapshot") return;

      const nextConversion = new Uint8Array(message.conversion);
      const nextOxygen = new Uint8Array(message.oxygen);
      const nextRadicals = message.radicals
        ? new Uint8Array(message.radicals)
        : new Uint8Array(nextConversion.length);
      const nextRemaining = new Uint8Array(message.remaining);
      const nextLensPixels = new Uint8Array(message.lens);
      const nextDiagnostics =
        message.lensDiagnostics ??
        message.diagnostics ??
        EMPTY_SOLVER_DIAGNOSTICS;
      const nextVolumeMetrics = message.volumeMetrics ?? message.metrics;
      latestArraysRef.current = {
        conversion: nextConversion,
        oxygen: nextOxygen,
        radicals: nextRadicals,
        remaining: nextRemaining,
      };
      setConversion(nextConversion);
      setOxygen(nextOxygen);
      setRadicals(nextRadicals);
      setRemaining(nextRemaining);
      setLensPixels(nextLensPixels);
      setLensWidth(message.lensWidth);
      setLensHeight(message.lensHeight);
      setMetrics(nextVolumeMetrics);
      setLensMetrics(message.lensMetrics);
      setExposureProgress(message.exposureProgress);
      setDevelopmentProgress(message.developmentProgress);
      setSimulatedSeconds(message.simulatedSeconds);
      setFocus(message.focus);
      setSolverDiagnostics(nextDiagnostics);
      setVolumeDiagnostics(message.volumeDiagnostics);

      if (message.stage === "complete" && variantRunningRef.current) {
        variantRunningRef.current = false;
        setVariant({
          metrics: nextVolumeMetrics,
          lensMetrics: message.lensMetrics,
          conversion: nextConversion.slice(),
          oxygen: nextOxygen.slice(),
          radicals: nextRadicals.slice(),
          remaining: nextRemaining.slice(),
          lensPixels: nextLensPixels.slice(),
          lensWidth: message.lensWidth,
          lensHeight: message.lensHeight,
          diagnostics: nextDiagnostics,
          volumeDiagnostics: message.volumeDiagnostics,
          diffusion: variantDiffusionRef.current,
        });
        setStage("compare");
        setNotice(
          `Branch B completed at Dₒ ${variantDiffusionRef.current.toFixed(4)}; comparison metrics are ready.`,
        );
      } else {
        setStage(message.stage);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      variantRunningRef.current = false;
      setBaseline(null);
      setVariant(null);
      setSolverState("error");
      setSolverError(
        event.message || "The simulation worker failed before Rust/Wasm initialized.",
      );
    };
    worker.onmessageerror = () => {
      variantRunningRef.current = false;
      setBaseline(null);
      setVariant(null);
      setSolverState("error");
      setSolverError("The simulation worker returned an unreadable message.");
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (shouldIgnoreLabShortcut(event)) {
        return;
      }
      if (solverState !== "ready") return;
      if (event.code === "Space") {
        event.preventDefault();
        if (stage === "exposing") workerRef.current?.postMessage({ type: "pause" });
        if (stage === "paused" && exposureProgress < 0.999) {
          workerRef.current?.postMessage({ type: "resume" });
        }
      }
      if (event.key === "[") {
        setSelectedLayer((value) => Math.max(0, value - 1));
      }
      if (event.key === "]") {
        setSelectedLayer((value) =>
          Math.min((sliceInfo?.layerCount ?? 1) - 1, value + 1),
        );
      }
      if (event.key.toLowerCase() === "l") {
        setFieldMode((value) =>
          value === "conversion" ? "oxygen" : "conversion",
        );
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [stage, exposureProgress, sliceInfo, solverState]);

  const updateParam = useCallback(
    (key: ModelKey, value: number) => {
      setParams((current) => ({ ...current, [key]: value }));
      if (stage !== "model" && stage !== "slicing") {
        setDirty((current) =>
          current === "slice" || SLICER_KEYS.has(key) ? "slice" : "physics",
        );
      }
    },
    [stage],
  );

  const slice = useCallback(
    (nextParams = params) => {
      variantRunningRef.current = false;
      setDirty(null);
      setBaseline(null);
      setVariant(null);
      setStage("slicing");
      setExposureProgress(0);
      setDevelopmentProgress(0);
      workerRef.current?.postMessage({ type: "slice", params: nextParams });
    },
    [params],
  );

  const applyPhysics = useCallback(() => {
    variantRunningRef.current = false;
    setDirty(null);
    setBaseline(null);
    setVariant(null);
    workerRef.current?.postMessage({ type: "configure", params });
    setStage("ready");
  }, [params]);

  const branchOxygen = useCallback(() => {
    const arrays = latestArraysRef.current;
    if (!arrays || !lensPixels || !volumeDiagnostics) return;
    const nextDiffusion = Math.min(0.012, params.oxygenDiffusion * 2);
    if (nextDiffusion <= params.oxygenDiffusion) {
      setNotice(
        "Doubling the current oxygen diffusion would not produce a distinct branch.",
      );
      return;
    }
    setBaseline({
      metrics,
      lensMetrics,
      conversion: arrays.conversion.slice(),
      oxygen: arrays.oxygen.slice(),
      radicals: arrays.radicals.slice(),
      remaining: arrays.remaining.slice(),
      lensPixels: lensPixels.slice(),
      lensWidth,
      lensHeight,
      diagnostics: solverDiagnostics,
      volumeDiagnostics,
      diffusion: params.oxygenDiffusion,
    });
    setVariant(null);
    setComparisonView("B");
    const nextParams = {
      ...params,
      oxygenDiffusion: nextDiffusion,
    };
    setParams(nextParams);
    variantDiffusionRef.current = nextParams.oxygenDiffusion;
    variantRunningRef.current = true;
    workerRef.current?.postMessage({ type: "configure", params: nextParams });
    workerRef.current?.postMessage({ type: "start" });
    setStage("exposing");
    setNotice(
      `Branch B is replaying the identical path with Dₒ ${params.oxygenDiffusion.toFixed(4)} → ${nextDiffusion.toFixed(4)}.`,
    );
  }, [
    lensHeight,
    lensMetrics,
    lensPixels,
    lensWidth,
    metrics,
    params,
    solverDiagnostics,
    volumeDiagnostics,
  ]);

  const primaryAction = useCallback(() => {
    if (solverState !== "ready") return;
    if (dirty === "slice") {
      slice();
      return;
    }
    if (dirty === "physics") {
      applyPhysics();
      return;
    }
    if (stage === "model") {
      slice();
      return;
    }
    if (stage === "ready") {
      workerRef.current?.postMessage({ type: "start" });
      setStage("exposing");
      return;
    }
    if (stage === "exposing") {
      workerRef.current?.postMessage({ type: "pause" });
      return;
    }
    if (stage === "paused" && exposureProgress < 0.999) {
      workerRef.current?.postMessage({ type: "resume" });
      return;
    }
    if (stage === "paused") {
      workerRef.current?.postMessage({ type: "develop" });
      setStage("developing");
      return;
    }
    if (stage === "complete") {
      branchOxygen();
      return;
    }
    if (stage === "compare") {
      setComparisonView((value) => (value === "A" ? "B" : "A"));
    }
  }, [
    dirty,
    stage,
    exposureProgress,
    slice,
    applyPhysics,
    branchOxygen,
    solverState,
  ]);

  const primaryLabel = useMemo(() => {
    if (solverState === "initializing") return "Loading Rust solver…";
    if (solverState === "error") return "Solver unavailable";
    if (dirty === "slice") return "Apply & reslice";
    if (dirty === "physics") return "Apply & reset fields";
    if (stage === "model") return "Slice specimen";
    if (stage === "slicing") return "Compiling path…";
    if (stage === "ready") return "Begin exposure";
    if (stage === "exposing") return "Pause exposure";
    if (stage === "paused" && exposureProgress < 0.999) return "Resume exposure";
    if (stage === "paused") return "Admit developer";
    if (stage === "developing") return "Developing…";
    if (stage === "complete") return "Fork oxygen diffusion";
    return `Show run ${comparisonView === "A" ? "B" : "A"}`;
  }, [dirty, stage, exposureProgress, comparisonView, solverState]);

  const selectedRun = useMemo(() => {
    if (stage === "compare" && comparisonView === "A" && baseline) {
      return baseline;
    }
    if (stage === "compare" && comparisonView === "B" && variant) {
      return variant;
    }
    return null;
  }, [baseline, comparisonView, stage, variant]);

  const displayArrays =
    selectedRun ?? { conversion, oxygen, radicals, remaining };

  const displayMetrics = selectedRun?.metrics ?? metrics;
  const displayLensMetrics = selectedRun?.lensMetrics ?? lensMetrics;
  const displayLensPixels = selectedRun?.lensPixels ?? lensPixels;
  const displayLensWidth = selectedRun?.lensWidth ?? lensWidth;
  const displayLensHeight = selectedRun?.lensHeight ?? lensHeight;
  const displaySolverDiagnostics =
    selectedRun?.diagnostics ?? solverDiagnostics;
  const displayVolumeDiagnostics =
    selectedRun?.volumeDiagnostics ?? volumeDiagnostics;
  const selectedLayerZ = layerPositions?.[selectedLayer] ?? 0.18;

  const activeProcess = processIndex(stage, exposureProgress);
  const timelineProgress =
    stage === "developing" || stage === "complete" || stage === "compare"
      ? exposureProgress * 0.82 + developmentProgress * 0.18
      : exposureProgress * 0.82;

  const applyPreset = (preset: PresetKey) => {
    let next = { ...params };
    if (preset === "wake") {
      next = {
        ...next,
        passes: 2,
        speed: 38,
        oxygen: 1.15,
        oxygenDiffusion: 0.0022,
      };
    }
    if (preset === "cliff") {
      next = {
        ...next,
        power: 12.4,
        speed: 58,
        oxygenQuench: 10.5,
        passes: 1,
      };
    }
    if (preset === "fine") {
      next = {
        ...next,
        layerHeight: 0.32,
        hatchSpacing: 0.46,
        hatchAngle: 53,
      };
    }
    setParams(next);
    const changesSlicer = Array.from(SLICER_KEYS).some(
      (key) => next[key] !== params[key],
    );
    setDirty((current) =>
      current === "slice" || changesSlicer ? "slice" : "physics",
    );
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    setNotice(
      `${file.name} is staged for mesh voxelization. This run uses the bundled official 3DBenchy occupancy until import is implemented.`,
    );
  };

  return (
    <main
      className="lab-shell"
      data-solver-state={solverState}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <LabViewport
        pathPositions={pathPositions}
        macroPositions={macroPositions}
        conversion={displayArrays.conversion}
        oxygen={displayArrays.oxygen}
        radicals={displayArrays.radicals}
        remaining={displayArrays.remaining}
        focus={focus}
        progress={
          stage === "ready"
            ? 1
            : stage === "model" || stage === "slicing"
              ? 0
              : multipassPathProgress(exposureProgress, appliedPasses)
        }
        selectedLayerZ={selectedLayerZ}
        voxelPitch={
          displayVolumeDiagnostics?.voxelPitchUm ?? [0.18, 0.17, 0.18]
        }
        fieldMode={fieldMode}
        stage={stage}
      />

      <header className="lab-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div>
            <strong>two·photon</strong>
            <span>causal lithography lab</span>
          </div>
        </div>

        <nav className="process-rail" aria-label="Experiment process">
          {["MODEL", "SLICE", "EXPOSE", "DEVELOP"].map((label, index) => (
            <div
              className={`${index === activeProcess ? "active" : ""} ${
                index < activeProcess ? "complete" : ""
              }`}
              key={label}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </nav>

        <div className="solver-status">
          <span
            className={
              solverState === "ready" &&
              (stage === "exposing" || stage === "developing")
                ? "running"
                : ""
            }
          >
            <i />
            {solverState === "error"
              ? "Solver unavailable"
              : solverState === "initializing"
                ? "Initializing solver"
                : stageLabel(stage, exposureProgress)}
          </span>
          <strong>Rust/Wasm · 4F-RD · seed 07A1</strong>
        </div>
      </header>

      <section className="specimen-tag glass-panel" aria-label="Specimen details">
        <div className="eyebrow-row">
          <span className="eyebrow">Target / official benchmark mesh</span>
          <span className="target-badge">TARGET</span>
        </div>
        <h1>Micro‑Benchy</h1>
        <p>22.0 × 11.4 × 17.6 µm · CreativeTools 3DBenchy</p>
        <div className="specimen-meta">
          <span>
            <i className="violet" /> focus PSF
          </span>
          <span>
            <i className="slate" /> intended path
          </span>
          <span>
            <i className="amber" /> calculated matter
          </span>
        </div>
        {sliceInfo && (
          <div className="slice-summary">
            <span>
              <strong>{sliceInfo.layerCount}</strong> layers
            </span>
            <span>
              <strong>{formatNumber(sliceInfo.pathLengthUm, 0)}</strong> µm path
            </span>
            <span>
              <strong>
                {formatNumber(sliceInfo.estimatedExposureSeconds, 1)}
              </strong>{" "}
              s physical
            </span>
          </div>
        )}
      </section>

      <nav className="mobile-quick-tools" aria-label="Lab tools">
        <button
          ref={lensTriggerRef}
          className={mobileLensOpen ? "active" : ""}
          onClick={() => {
            setPanelOpen(false);
            setMobileLensOpen((value) => !value);
          }}
          type="button"
          aria-controls="reaction-lens-panel"
          aria-expanded={mobileLensOpen}
        >
          <span aria-hidden="true">⌗</span>
          Reaction Lens
        </button>
        <button
          className={panelOpen ? "active" : ""}
          onClick={() => {
            setMobileLensOpen(false);
            setPanelOpen(true);
          }}
          type="button"
          aria-controls="parameter-sheet"
          aria-expanded={panelOpen}
        >
          <span aria-hidden="true">⌁</span>
          Parameters
        </button>
      </nav>

      <ReactionLens
        pixels={displayLensPixels}
        width={displayLensWidth}
        height={displayLensHeight}
        fieldMode={fieldMode}
        onFieldMode={setFieldMode}
        mobileOpen={mobileLensOpen}
        onMobileClose={() => {
          lensTriggerRef.current?.focus();
          setMobileLensOpen(false);
        }}
        metrics={displayLensMetrics}
        solverState={solverState}
        diagnostics={displaySolverDiagnostics}
      />

      <aside
        className={`parameter-dock ${panelOpen ? "open" : ""}`}
        data-mobile-layout={isMobileLayout ? "true" : "false"}
        aria-hidden={isMobileLayout && !panelOpen ? true : undefined}
      >
        <button
          className="mobile-sheet-backdrop"
          onClick={() => setPanelOpen(false)}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="parameter-spine" aria-label="Parameter groups">
          {(Object.keys(PANEL_LABELS) as PanelTab[]).map((tab) => (
            <button
              key={tab}
              className={panelTab === tab && panelOpen ? "active" : ""}
              onClick={() => {
                if (isMobileLayout) {
                  setPanelTab(tab);
                  setPanelOpen(true);
                } else if (panelTab === tab) {
                  setPanelOpen((value) => !value);
                } else {
                  setPanelTab(tab);
                  setPanelOpen(true);
                }
              }}
              type="button"
              aria-label={PANEL_LABELS[tab].full}
              aria-pressed={panelTab === tab && panelOpen}
            >
              <span>{PANEL_LABELS[tab].glyph}</span>
              <small>{PANEL_LABELS[tab].short}</small>
            </button>
          ))}
        </div>

        <section
          className="parameter-sheet glass-panel"
          id="parameter-sheet"
          ref={parameterSheetRef}
          role={isMobileLayout && panelOpen ? "dialog" : undefined}
          aria-modal={isMobileLayout && panelOpen ? true : undefined}
          aria-hidden={!panelOpen ? true : undefined}
          inert={!panelOpen ? true : undefined}
          aria-labelledby="parameter-sheet-title"
          tabIndex={isMobileLayout ? -1 : undefined}
        >
          <div className="sheet-heading">
            <div>
              <span className="eyebrow">Parameter sheet</span>
              <h2 id="parameter-sheet-title">{PANEL_LABELS[panelTab].full}</h2>
            </div>
            <button
              className="sheet-close"
              ref={parameterCloseRef}
              onClick={() => setPanelOpen(false)}
              type="button"
              aria-label="Close parameter sheet"
            >
              ×
            </button>
          </div>

          <div
            className="mobile-parameter-tabs"
            aria-label="Parameter groups"
          >
            {(Object.keys(PANEL_LABELS) as PanelTab[]).map((tab) => (
              <button
                key={tab}
                className={panelTab === tab ? "active" : ""}
                onClick={() => setPanelTab(tab)}
                type="button"
                aria-pressed={panelTab === tab}
              >
                <span aria-hidden="true">{PANEL_LABELS[tab].glyph}</span>
                {PANEL_LABELS[tab].short}
              </button>
            ))}
          </div>

          <div className="mobile-presets" aria-label="Physics experiment presets">
            <span className="eyebrow">Experiments</span>
            <div>
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => applyPreset(preset.key)}
                  type="button"
                  disabled={stage === "slicing"}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="parameter-sheet-body">
            {panelTab === "specimen" ? (
              <div className="specimen-sheet">
                <div className="mesh-card">
                  <div className="mesh-miniature" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div>
                    <strong>3DBenchy.stl</strong>
                    <span>Official mesh · 225,706 triangles</span>
                  </div>
                  <span className="ok-chip">ready</span>
                </div>
                <div className="transform-grid">
                  <label>
                    Scale
                    <strong>1.000</strong>
                  </label>
                  <label>
                    Rotation Z
                    <strong>0.0°</strong>
                  </label>
                  <label>
                    Anchors
                    <strong>auto / 3</strong>
                  </label>
                  <label>
                    Clearance
                    <strong>0.18 µm</strong>
                  </label>
                </div>
                <p className="sheet-note">
                  The mesh is voxelized once. Rust scans that occupancy through a
                  dense three-dimensional resin field; rendering never mutates it.
                </p>
                {displayVolumeDiagnostics && (
                  <>
                    <p className="sheet-note">Executed 3D Benchy volume diagnostics</p>
                    <div
                      className="transform-grid"
                      aria-label="3D Benchy volume diagnostics"
                    >
                      <label>
                        Quality / grid
                        <strong>
                          {displayVolumeDiagnostics.qualityTier} ·{" "}
                          {displayVolumeDiagnostics.gridWidth}×
                          {displayVolumeDiagnostics.gridHeight}×
                          {displayVolumeDiagnostics.gridDepth}
                        </strong>
                      </label>
                      <label>
                        Voxel pitch
                        <strong>
                          {displayVolumeDiagnostics.voxelPitchUm
                            .map((value) => value.toFixed(3))
                            .join("×")} µm
                        </strong>
                      </label>
                      <label title={displayVolumeDiagnostics.downgradeReason}>
                        Owned / budget
                        <strong>
                          {formatMemory(displayVolumeDiagnostics.ownedMemoryBytes)} /{" "}
                          {formatMemory(displayVolumeDiagnostics.memoryBudgetBytes)}
                        </strong>
                      </label>
                      <label>
                        PSF quadrature
                        <strong>
                          {displayVolumeDiagnostics.psfPupilSamples} rays ·{" "}
                          {displayVolumeDiagnostics.psfKernelVoxels} voxels
                        </strong>
                      </label>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="parameter-list">
                {PARAMETER_GROUPS[panelTab].map((definition) => (
                  <ParamRow
                    key={definition.key}
                    definition={definition}
                    value={params[definition.key]}
                    onChange={(value) => updateParam(definition.key, value)}
                    disabled={stage === "slicing"}
                  />
                ))}
              </div>
            )}

            {panelTab === "resin" && (
              <div className="equation-card">
                <div>
                  <span className="eyebrow">Executed model</span>
                  <span className="model-chip">3D · deterministic</span>
                </div>
                <code>|E|² = Debye(NA, λ, circular polarization)</code>
                <code>dose ∝ |E|⁴ · P² / (f · τ)</code>
                <code>∂ₜp = Dₚ∇²p − βsp</code>
                <code>∂ₜr = Dᵣ∇²r + ηsp − (δ + qo)r − κr²</code>
                <code>∂ₜo = Dₒ∇²o − χqor</code>
                <code>∂ₜx = γr(1 − x)</code>
                <p>
                  The full volume, exposure, threshold conversion, oxygen
                  inhibition, and development state are owned by Rust/Wasm.
                </p>
              </div>
            )}
          </div>
        </section>
      </aside>

      <div className="preset-rail" aria-label="Physics experiment presets">
        <span className="eyebrow">Experiments</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => applyPreset(preset.key)}
            type="button"
            disabled={stage === "slicing"}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {baseline && (
        <section className="comparison-card glass-panel">
          <div className="comparison-heading">
            <div>
              <span className="eyebrow">Counterfactual branch</span>
              <strong>Dₒ sweep · same path / same seed</strong>
            </div>
            <div className="ab-toggle">
              <button
                className={comparisonView === "A" ? "active" : ""}
                onClick={() => setComparisonView("A")}
                type="button"
              >
                A
              </button>
              <button
                className={comparisonView === "B" ? "active" : ""}
                onClick={() => setComparisonView("B")}
                type="button"
                disabled={!variant}
              >
                B
              </button>
            </div>
          </div>
          <div className="comparison-values">
            <span>
              diffusion
              <strong>
                {baseline.diffusion.toFixed(4)} →{" "}
                {(variant?.diffusion ?? params.oxygenDiffusion).toFixed(4)}
              </strong>
            </span>
            <span>
              gelled
              <strong>
                {(baseline.metrics.gelledFraction * 100).toFixed(1)}% →{" "}
                {variant
                  ? `${(variant.metrics.gelledFraction * 100).toFixed(1)}%`
                  : "running"}
              </strong>
            </span>
            <span>
              survives
              <strong>
                {(baseline.metrics.survivingFraction * 100).toFixed(1)}% →{" "}
                {variant
                  ? `${(variant.metrics.survivingFraction * 100).toFixed(1)}%`
                  : "—"}
              </strong>
            </span>
          </div>
        </section>
      )}

      <section className="causal-tape glass-panel" aria-label="Causal experiment tape">
        <div className="tape-topline">
          <div className="tape-identity">
            <span className="eyebrow">Causal tape</span>
            <strong>
              {simulatedSeconds.toFixed(2)} s
              <small>physical exposure time</small>
            </strong>
          </div>
          {sliceInfo && (
            <label className="layer-scrubber">
              <span>
                Layer{" "}
                <strong>
                  {selectedLayer + 1}/{sliceInfo.layerCount} · z{" "}
                  {formatNumber(selectedLayerZ, 2)} µm
                </strong>
              </span>
              <input
                aria-label="Inspected layer"
                type="range"
                min={0}
                max={Math.max(0, sliceInfo.layerCount - 1)}
                value={selectedLayer}
                onChange={(event) => setSelectedLayer(Number(event.target.value))}
              />
            </label>
          )}
          <div className="integrity-readout">
            <span>
              volume gel{" "}
              <strong>
                {(displayMetrics.gelledFraction * 100).toFixed(1)}%
              </strong>
            </span>
            <span>
              replay <strong>{displayMetrics.checksum}</strong>
            </span>
          </div>
        </div>
        <div className="timeline">
          <div className="timeline-track">
            <div
              className="timeline-progress"
              style={{ width: `${timelineProgress * 100}%` }}
            />
            <div
              className="timeline-playhead"
              style={{ left: `${timelineProgress * 100}%` }}
            >
              <i />
            </div>
            {Array.from({ length: 22 }).map((_, index) => (
              <i
                className="layer-tick"
                key={index}
                style={{ left: `${(index / 21) * 82}%` }}
              />
            ))}
            <span className="phase-label expose-phase">EXPOSURE</span>
            <span className="phase-label develop-phase">DEVELOP</span>
          </div>
        </div>
      </section>

      <section className="mobile-run-status glass-panel" aria-label="Simulation status">
        <div>
          <span className="mobile-stage-index" aria-hidden="true">
            {String(activeProcess + 1).padStart(2, "0")}
          </span>
          <span>
            <small>Current stage</small>
            <strong>{stageLabel(stage, exposureProgress)}</strong>
          </span>
          <output>{Math.round(timelineProgress * 100)}%</output>
        </div>
        <div
          className="mobile-run-progress"
          role="progressbar"
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(timelineProgress * 100)}
        >
          <i style={{ width: `${timelineProgress * 100}%` }} />
        </div>
      </section>

      <button
        className={`primary-actuator ${
          stage === "exposing" || stage === "developing" ? "active" : ""
        }`}
        onClick={primaryAction}
        type="button"
        disabled={
          solverState !== "ready" ||
          stage === "slicing" ||
          stage === "developing"
        }
      >
        <span className="actuator-icon" aria-hidden="true">
          {stage === "exposing" ? "Ⅱ" : stage === "developing" ? "◌" : "↗"}
        </span>
        <span>
          <small>{dirty ? "Parameters changed" : stageLabel(stage, exposureProgress)}</small>
          <strong>{primaryLabel}</strong>
        </span>
        <i className="actuator-progress">
          <b
            style={{
              width: `${
                stage === "developing"
                  ? developmentProgress * 100
                  : exposureProgress * 100
              }%`,
            }}
          />
        </i>
      </button>

      {dirty && (
        <div className="stale-notice">
          <i />
          {dirty === "slice"
            ? "Toolpath is out of date"
            : "Chemistry fields need replay"}
        </div>
      )}

      {solverError && (
        <div className="solver-alert" role="alert">
          <strong>Rust/Wasm initialization failed</strong>
          <span>{solverError}</span>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} type="button" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <span className="drop-icon">↓</span>
            <strong>Drop mesh into the chamber</strong>
            <p>STL preview is accepted; this run remains on official 3DBenchy.</p>
          </div>
        </div>
      )}
    </main>
  );
}
