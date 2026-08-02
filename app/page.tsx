"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type { FieldMode, PsfPreview } from "./lab-viewport";
import { shouldIgnoreLabShortcut } from "./keyboard-shortcuts";
import {
  isLayerInspectionLocked,
  nearestLayerIndex,
} from "./layer-inspection";
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
  offTargetActiveVoxels: number;
  offTargetConversionMean: number;
  offTargetGelledFraction: number;
  offTargetSurvivingFraction: number;
};

type SliceMetrics = ChemistryMetrics & {
  targetCells: number;
  voxelPitchNm: [number, number];
};

type SolverState = "initializing" | "ready" | "error";

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
  psfPreview: PsfPreview;
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
  targetVoxels: number;
  renderVoxels: number;
  offTargetActiveVoxels: number;
  offTargetConversionMean: number;
  offTargetGelledFraction: number;
  offTargetSurvivingFraction: number;
  checksum: string;
};

type SliceInfo = {
  layerCount: number;
  pathLengthUm: number;
  estimatedExposureSeconds: number;
};

type RunResult = {
  params: ModelParams;
  metrics: Metrics;
  sliceMetrics: SliceMetrics;
  conversion: Uint8Array;
  oxygen: Uint8Array;
  radicals: Uint8Array;
  remaining: Uint8Array;
  slicePixels: Uint8Array;
  sliceWidth: number;
  sliceHeight: number;
  sliceZUm: number;
  volumeDiagnostics: VolumeDiagnostics;
};

type ParameterChange = {
  definition: ParameterDefinition;
  before: number;
  after: number;
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
        max: 100_000,
        step: 1,
        provenance: "input",
        log: true,
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

const PARAMETER_DEFINITIONS = Object.values(PARAMETER_GROUPS).flat();

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
  offTargetActiveVoxels: 0,
  offTargetConversionMean: 0,
  offTargetGelledFraction: 0,
  offTargetSurvivingFraction: 0,
};

const EMPTY_SLICE_METRICS: SliceMetrics = {
  oxygenMean: 1,
  conversionMean: 0,
  radicalMax: 0,
  gelledFraction: 0,
  survivingFraction: 1,
  targetCells: 0,
  voxelPitchNm: [179, 170],
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

const METHOD_ANCHORS: Record<PanelTab, string> = {
  specimen: "volume",
  path: "scan-path",
  light: "optics",
  resin: "chemistry",
  development: "development",
};

const MOBILE_LAYOUT_QUERY =
  "(max-width: 840px), (max-height: 540px) and (pointer: coarse) and (orientation: landscape)";

function formatNumber(value: number, digits = 2) {
  if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function parameterChanges(
  before: ModelParams,
  after: ModelParams,
): ParameterChange[] {
  return PARAMETER_DEFINITIONS.flatMap((definition) =>
    before[definition.key] === after[definition.key]
      ? []
      : [
          {
            definition,
            before: before[definition.key],
            after: after[definition.key],
          },
        ],
  );
}

function formatParameterValue(
  value: number,
  definition: ParameterDefinition,
) {
  const digits =
    definition.step < 0.0001
      ? 5
      : definition.step < 0.001
        ? 4
        : definition.step < 0.01
          ? 3
          : definition.step < 1
            ? 2
            : 0;
  const formatted = formatNumber(value, digits);
  return definition.unit ? `${formatted} ${definition.unit}` : formatted;
}

function describeParameterChanges(changes: ParameterChange[]) {
  if (changes.length === 1) {
    return `${changes[0].definition.name}: ${formatParameterValue(
      changes[0].before,
      changes[0].definition,
    )} → ${formatParameterValue(changes[0].after, changes[0].definition)}`;
  }
  return `${changes.length} parameters changed`;
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
  const sliderMin = definition.log ? 0 : definition.min;
  const sliderMax = definition.log ? 1 : definition.max;
  const boundedValue = Math.min(
    definition.max,
    Math.max(definition.min, value),
  );
  const sliderValue = definition.log
    ? Math.log(boundedValue / definition.min) /
      Math.log(definition.max / definition.min)
    : value;

  const handleSliderChange = (rawValue: number) => {
    if (!definition.log) {
      onChange(rawValue);
      return;
    }

    const logarithmicValue =
      definition.min *
      (definition.max / definition.min) ** rawValue;
    const stepCount = Math.round(
      (logarithmicValue - definition.min) / definition.step,
    );
    onChange(
      Math.min(
        definition.max,
        Math.max(
          definition.min,
          definition.min + stepCount * definition.step,
        ),
      ),
    );
  };

  return (
    <div className="param-row">
      <div className="param-row-heading">
        <div>
          <span className="param-symbol">{definition.symbol}</span>
          <span className="param-name">{definition.name}</span>
        </div>
      </div>
      <div className="param-control">
        <input
          aria-label={definition.name}
          aria-valuetext={formatParameterValue(value, definition)}
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={definition.log ? 0.001 : definition.step}
          value={sliderValue}
          disabled={disabled}
          onChange={(event) => handleSliderChange(Number(event.target.value))}
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

function FieldSelector({
  fieldMode,
  onFieldMode,
}: {
  fieldMode: FieldMode;
  onFieldMode: (mode: FieldMode) => void;
}) {
  return (
    <div className="field-selector" aria-label="Displayed chemistry field">
      <span className="field-selector-label">Field</span>
      {(Object.keys(FIELD_LABELS) as FieldMode[]).map((mode) => (
        <button
          key={mode}
          className={fieldMode === mode ? "active" : ""}
          onClick={() => onFieldMode(mode)}
          style={{ "--field-color": FIELD_LABELS[mode].color } as React.CSSProperties}
          type="button"
          aria-pressed={fieldMode === mode}
        >
          <i />
          {FIELD_LABELS[mode].label}
        </button>
      ))}
    </div>
  );
}

function ReactionLens({
  pixels,
  width,
  height,
  sliceZUm,
  fieldMode,
  mobileOpen,
  onMobileClose,
  metrics,
  solverState,
  volumeDiagnostics,
  wasmMemoryBytes,
  updatesPerSecond,
}: {
  pixels: Uint8Array | null;
  width: number;
  height: number;
  sliceZUm: number;
  fieldMode: FieldMode;
  mobileOpen: boolean;
  onMobileClose: () => void;
  metrics: SliceMetrics;
  solverState: SolverState;
  volumeDiagnostics: VolumeDiagnostics | null;
  wasmMemoryBytes: number;
  updatesPerSecond: number;
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
      const source = index * 5;
      const oxygenValue = pixels[source] / 255;
      const radicalValue = pixels[source + 1] / 255;
      const conversionValue = pixels[source + 2] / 255;
      const remainingValue = pixels[source + 3] / 255;
      const occupied = pixels[source + 4] > 0;
      let red = occupied ? 12 : 6;
      let green = occupied ? 15 : 8;
      let blue = occupied ? 26 : 16;
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
      aria-label="Authoritative 3D volume section"
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <div className="lens-heading">
        <div>
          <span className="eyebrow">Reaction Lens · 3D volume section</span>
          <strong>Authoritative XY · z {formatNumber(sliceZUm, 2)} µm</strong>
        </div>
        <span className="live-indicator">
          <i />
          {solverState === "ready"
            ? `${metrics.voxelPitchNm[0]} × ${metrics.voxelPitchNm[1]} nm`
            : solverState}
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
        <span className="axis axis-z">Y</span>
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
        aria-label="Authoritative volume slice diagnostics"
      >
        <span>
          <strong>{volumeDiagnostics?.solver ?? "Rust/Wasm 3D volume"}</strong>
          {volumeDiagnostics
            ? `${volumeDiagnostics.gridWidth}×${volumeDiagnostics.gridHeight}×${volumeDiagnostics.gridDepth}`
            : `${width}×${height} plane`}
        </span>
        <span>
          <strong>{volumeDiagnostics?.qualityTier ?? "volume tier"}</strong>
          {`${metrics.targetCells.toLocaleString()} target cells`}
        </span>
        <span>
          <strong>{formatMemory(volumeDiagnostics?.ownedMemoryBytes ?? 0)}</strong>
          {`${updatesPerSecond.toFixed(0)} solver steps/s`}
        </span>
        <span>
          <strong>{formatMemory(wasmMemoryBytes)}</strong>
          {`total · replay ${volumeDiagnostics?.checksum ?? "pending"}`}
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
  const activeRunParamsRef = useRef<ModelParams>({ ...DEFAULT_PARAMS });
  const completedRunRef = useRef<RunResult | null>(null);
  const lensTriggerRef = useRef<HTMLButtonElement | null>(null);
  const parameterSheetRef = useRef<HTMLElement | null>(null);
  const parameterCloseRef = useRef<HTMLButtonElement | null>(null);
  const opticsPreviewRequestRef = useRef(0);
  const layerPositionsRef = useRef<Float32Array | null>(null);
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
  const [slicePixels, setSlicePixels] = useState<Uint8Array | null>(null);
  const [sliceWidth, setSliceWidth] = useState(128);
  const [sliceHeight, setSliceHeight] = useState(72);
  const [sliceZUm, setSliceZUm] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [sliceMetrics, setSliceMetrics] =
    useState<SliceMetrics>(EMPTY_SLICE_METRICS);
  const [sliceInfo, setSliceInfo] = useState<SliceInfo | null>(null);
  const [appliedPasses, setAppliedPasses] = useState(DEFAULT_PARAMS.passes);
  const [exposureProgress, setExposureProgress] = useState(0);
  const [developmentProgress, setDevelopmentProgress] = useState(0);
  const [simulatedSeconds, setSimulatedSeconds] = useState(0);
  const [focus, setFocus] = useState<[number, number, number]>([0, 0, 7]);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [sectionCutEnabled, setSectionCutEnabled] = useState(false);
  const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [variant, setVariant] = useState<RunResult | null>(null);
  const [comparisonView, setComparisonView] = useState<"A" | "B">("B");
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [solverState, setSolverState] =
    useState<SolverState>("initializing");
  const [solverError, setSolverError] = useState<string | null>(null);
  const [volumeDiagnostics, setVolumeDiagnostics] =
    useState<VolumeDiagnostics | null>(null);
  const [wasmMemoryBytes, setWasmMemoryBytes] = useState(0);
  const [updatesPerSecond, setUpdatesPerSecond] = useState(0);
  const [opticsPreview, setOpticsPreview] = useState<PsfPreview | null>(null);

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
          setWasmMemoryBytes(message.wasmMemoryBytes ?? 0);
        }
        if (message.status === "error") {
          variantRunningRef.current = false;
          setSolverError(message.message || "The Rust/Wasm solver could not initialize.");
        }
        return;
      }
      if (message.type === "opticsPreview") {
        if (message.requestId === opticsPreviewRequestRef.current) {
          setOpticsPreview(message.preview);
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
        const nextLayerPositions = new Float32Array(message.layerPositions);
        setPathPositions(new Float32Array(message.pathPositions));
        setMacroPositions(new Float32Array(message.renderPositions));
        layerPositionsRef.current = nextLayerPositions;
        setLayerPositions(nextLayerPositions);
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
      if (message.type === "sliceInspection") {
        setSlicePixels(new Uint8Array(message.slicePixels));
        setSliceWidth(message.sliceWidth);
        setSliceHeight(message.sliceHeight);
        setSliceZUm(message.sliceZUm);
        setSliceMetrics(message.sliceMetrics);
        return;
      }
      if (message.type !== "snapshot") return;

      const nextConversion = new Uint8Array(message.conversion);
      const nextOxygen = new Uint8Array(message.oxygen);
      const nextRadicals = message.radicals
        ? new Uint8Array(message.radicals)
        : new Uint8Array(nextConversion.length);
      const nextRemaining = new Uint8Array(message.remaining);
      const nextSlicePixels = new Uint8Array(message.slicePixels);
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
      setSlicePixels(nextSlicePixels);
      setSliceWidth(message.sliceWidth);
      setSliceHeight(message.sliceHeight);
      setSliceZUm(message.sliceZUm);
      setMetrics(nextVolumeMetrics);
      setSliceMetrics(message.sliceMetrics);
      setExposureProgress(message.exposureProgress);
      setDevelopmentProgress(message.developmentProgress);
      setSimulatedSeconds(message.simulatedSeconds);
      setFocus(message.focus);
      if (
        message.stage === "exposing" ||
        (message.stage === "paused" && message.exposureProgress >= 0.999)
      ) {
        setSelectedLayer(
          nearestLayerIndex(layerPositionsRef.current, message.sliceZUm),
        );
      }
      setVolumeDiagnostics(message.volumeDiagnostics);
      setWasmMemoryBytes(message.wasmMemoryBytes ?? 0);
      setUpdatesPerSecond(message.updatesPerSecond ?? 0);

      if (message.stage === "complete" && variantRunningRef.current) {
        variantRunningRef.current = false;
        const completedRun: RunResult = {
          params: { ...activeRunParamsRef.current },
          metrics: nextVolumeMetrics,
          sliceMetrics: message.sliceMetrics,
          conversion: nextConversion.slice(),
          oxygen: nextOxygen.slice(),
          radicals: nextRadicals.slice(),
          remaining: nextRemaining.slice(),
          slicePixels: nextSlicePixels.slice(),
          sliceWidth: message.sliceWidth,
          sliceHeight: message.sliceHeight,
          sliceZUm: message.sliceZUm,
          volumeDiagnostics: message.volumeDiagnostics,
        };
        completedRunRef.current = completedRun;
        setVariant(completedRun);
        setStage("compare");
        setNotice("Branch B completed; comparison metrics are ready.");
      } else {
        if (message.stage === "complete") {
          completedRunRef.current = {
            params: { ...activeRunParamsRef.current },
            metrics: nextVolumeMetrics,
            sliceMetrics: message.sliceMetrics,
            conversion: nextConversion.slice(),
            oxygen: nextOxygen.slice(),
            radicals: nextRadicals.slice(),
            remaining: nextRemaining.slice(),
            slicePixels: nextSlicePixels.slice(),
            sliceWidth: message.sliceWidth,
            sliceHeight: message.sliceHeight,
            sliceZUm: message.sliceZUm,
            volumeDiagnostics: message.volumeDiagnostics,
          };
        }
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
    if (solverState !== "ready") return;
    const requestId = opticsPreviewRequestRef.current + 1;
    opticsPreviewRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      workerRef.current?.postMessage({
        type: "previewOptics",
        requestId,
        na: params.na,
        wavelength: params.wavelength,
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [params.na, params.wavelength, solverState]);

  useEffect(() => {
    if (solverState !== "ready") return;
    if (stage === "exposing") return;
    const zUm = layerPositions?.[selectedLayer];
    if (!Number.isFinite(zUm)) return;
    workerRef.current?.postMessage({ type: "inspectSlice", zUm });
  }, [layerPositions, selectedLayer, solverState, stage]);

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
      if (event.key === "[" && !isLayerInspectionLocked(stage)) {
        setSelectedLayer((value) => Math.max(0, value - 1));
      }
      if (event.key === "]" && !isLayerInspectionLocked(stage)) {
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
      completedRunRef.current = null;
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
    completedRunRef.current = null;
    setDirty(null);
    setBaseline(null);
    setVariant(null);
    workerRef.current?.postMessage({ type: "configure", params });
    setStage("ready");
  }, [params]);

  const runComparison = useCallback(() => {
    const completedRun = completedRunRef.current;
    if (!completedRun) return;
    const changes = parameterChanges(completedRun.params, params);
    if (!changes.length) {
      setDirty(null);
      setNotice("Change any parameter to create run B.");
      return;
    }
    setBaseline(completedRun);
    setVariant(null);
    setComparisonView("B");
    setDirty(null);
    activeRunParamsRef.current = { ...params };
    variantRunningRef.current = true;
    const changesToolpath = changes.some(({ definition }) =>
      SLICER_KEYS.has(definition.key),
    );
    if (changesToolpath) {
      setStage("slicing");
      workerRef.current?.postMessage({ type: "slice", params });
    } else {
      setStage("exposing");
      workerRef.current?.postMessage({ type: "configure", params });
    }
    workerRef.current?.postMessage({ type: "start" });
    setNotice(`Branch B is replaying with ${describeParameterChanges(changes)}.`);
  }, [params]);

  const primaryAction = useCallback(() => {
    if (solverState !== "ready") return;
    if (dirty && (stage === "complete" || stage === "compare")) {
      runComparison();
      return;
    }
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
      activeRunParamsRef.current = { ...params };
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
      setPanelOpen(true);
      setNotice("Change any parameter to create an A/B comparison.");
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
    params,
    runComparison,
    solverState,
  ]);

  const primaryLabel = useMemo(() => {
    if (solverState === "initializing") return "Loading Rust solver…";
    if (solverState === "error") return "Solver unavailable";
    if (dirty && (stage === "complete" || stage === "compare")) {
      return "Run A/B comparison";
    }
    if (dirty === "slice") return "Apply & reslice";
    if (dirty === "physics") return "Apply & reset fields";
    if (stage === "model") return "Slice specimen";
    if (stage === "slicing") return "Compiling path…";
    if (stage === "ready") return "Begin exposure";
    if (stage === "exposing") return "Pause exposure";
    if (stage === "paused" && exposureProgress < 0.999) return "Resume exposure";
    if (stage === "paused") return "Admit developer";
    if (stage === "developing") return "Developing…";
    if (stage === "complete") return "Change a parameter to compare";
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

  const comparisonChanges = useMemo(
    () =>
      baseline ? parameterChanges(baseline.params, variant?.params ?? params) : [],
    [baseline, params, variant],
  );

  const displayArrays =
    selectedRun ?? { conversion, oxygen, radicals, remaining };

  const displayMetrics = selectedRun?.metrics ?? metrics;
  const displaySliceMetrics = selectedRun?.sliceMetrics ?? sliceMetrics;
  const displaySlicePixels = selectedRun?.slicePixels ?? slicePixels;
  const displaySliceWidth = selectedRun?.sliceWidth ?? sliceWidth;
  const displaySliceHeight = selectedRun?.sliceHeight ?? sliceHeight;
  const displaySliceZUm = selectedRun?.sliceZUm ?? sliceZUm;
  const displayVolumeDiagnostics =
    selectedRun?.volumeDiagnostics ?? volumeDiagnostics;
  const selectedLayerZ = layerPositions?.[selectedLayer] ?? 0.18;

  const activeProcess = processIndex(stage, exposureProgress);
  const overallProgress =
    stage === "developing" || stage === "complete" || stage === "compare"
      ? exposureProgress * 0.82 + developmentProgress * 0.18
      : exposureProgress * 0.82;
  const layerInspectionLocked = isLayerInspectionLocked(stage);
  const layerModeStatus =
    stage === "exposing"
      ? `Following laser · ${Math.round(exposureProgress * 100)}%`
      : stage === "developing"
        ? `Inspect freely · develop ${Math.round(developmentProgress * 100)}%`
        : stage === "compare"
          ? "Comparison view"
          : stage === "complete"
            ? "Developed · inspect freely"
            : stage === "paused" && exposureProgress >= 0.999
              ? "Exposure complete · inspect freely"
              : "Manual inspection";

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
        sectionEnabled={Boolean(sliceInfo) && sectionCutEnabled}
        voxelPitch={
          displayVolumeDiagnostics?.voxelPitchUm ?? [0.18, 0.17, 0.18]
        }
        opticsPreview={opticsPreview}
        fieldMode={fieldMode}
        stage={stage}
      />

      <FieldSelector fieldMode={fieldMode} onFieldMode={setFieldMode} />

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
        pixels={displaySlicePixels}
        width={displaySliceWidth}
        height={displaySliceHeight}
        sliceZUm={displaySliceZUm}
        fieldMode={fieldMode}
        mobileOpen={mobileLensOpen}
        onMobileClose={() => {
          lensTriggerRef.current?.focus();
          setMobileLensOpen(false);
        }}
        metrics={displaySliceMetrics}
        solverState={solverState}
        volumeDiagnostics={displayVolumeDiagnostics}
        wasmMemoryBytes={wasmMemoryBytes}
        updatesPerSecond={updatesPerSecond}
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
            <div className="sheet-heading-actions">
              <a
                className="sheet-method-link"
                href={`/method#${METHOD_ANCHORS[panelTab]}`}
              >
                Model notes <span aria-hidden="true">↗</span>
              </a>
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
                      <label>
                        Render / target
                        <strong>
                          {displayVolumeDiagnostics.renderVoxels.toLocaleString()} /{" "}
                          {displayVolumeDiagnostics.targetVoxels.toLocaleString()}
                        </strong>
                      </label>
                      <label>
                        Off-target activity
                        <strong>
                          {displayVolumeDiagnostics.offTargetActiveVoxels.toLocaleString()} voxels
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

          </div>
        </section>
      </aside>

      {baseline && !dirty && (
        <section className="comparison-card glass-panel">
          <div className="comparison-heading">
            <div>
              <span className="eyebrow">Counterfactual branch</span>
              <strong>
                {comparisonChanges.length === 1
                  ? `${comparisonChanges[0].definition.name} · deterministic replay`
                  : `${comparisonChanges.length} parameters · deterministic replay`}
              </strong>
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
            {comparisonChanges.map((change) => (
              <span key={change.definition.key}>
                {change.definition.name.toLowerCase()}
                <strong>
                  {formatParameterValue(change.before, change.definition)} →{" "}
                  {formatParameterValue(change.after, change.definition)}
                </strong>
              </span>
            ))}
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

      <section className="causal-tape glass-panel" aria-label="Process state">
        <div className="tape-topline">
          <div className="tape-identity">
            <span className="eyebrow">Process state</span>
            <strong>
              {simulatedSeconds.toFixed(2)} s
              <small>physical exposure time</small>
            </strong>
          </div>
          {sliceInfo && (
            <div className="layer-scrubber">
              <div className="layer-scrubber-heading">
                <label htmlFor="inspection-layer">
                  Layer{" "}
                  <strong>
                    {selectedLayer + 1}/{sliceInfo.layerCount} · z{" "}
                    {formatNumber(selectedLayerZ, 2)} µm
                  </strong>
                </label>
                <span
                  className={`layer-mode ${stage === "exposing" ? "following" : ""}`}
                  id="layer-mode-status"
                >
                  {layerModeStatus}
                </span>
                <button
                  className={sectionCutEnabled ? "active" : ""}
                  type="button"
                  aria-pressed={sectionCutEnabled}
                  onClick={() => setSectionCutEnabled((value) => !value)}
                >
                  Section cut
                </button>
              </div>
              <input
                id="inspection-layer"
                aria-label="Inspected layer"
                type="range"
                min={0}
                max={Math.max(0, sliceInfo.layerCount - 1)}
                value={selectedLayer}
                disabled={layerInspectionLocked}
                aria-describedby="layer-mode-status"
                onChange={(event) => setSelectedLayer(Number(event.target.value))}
              />
            </div>
          )}
          <div className="integrity-readout">
            <span>
              target gel{" "}
              <strong>
                {(displayMetrics.gelledFraction * 100).toFixed(1)}%
              </strong>
            </span>
            <span title={`${displayMetrics.offTargetActiveVoxels} affected voxels`}>
              spill gel{" "}
              <strong>
                {(displayMetrics.offTargetGelledFraction * 100).toFixed(1)}%
              </strong>
            </span>
            <span>
              replay <strong>{displayMetrics.checksum}</strong>
            </span>
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
          <output>{Math.round(overallProgress * 100)}%</output>
        </div>
        <div
          className="mobile-run-progress"
          role="progressbar"
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overallProgress * 100)}
        >
          <i style={{ width: `${overallProgress * 100}%` }} />
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
