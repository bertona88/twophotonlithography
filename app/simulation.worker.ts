import initReactionLens, {
  ReactionLensSimulation,
  WholeVolumeSimulation,
} from "./wasm/reaction_lens/reaction_lens.js";
import reactionLensWasmUrl from "./wasm/reaction_lens/reaction_lens_bg.wasm?url";

type LabStage =
  | "model"
  | "slicing"
  | "ready"
  | "exposing"
  | "paused"
  | "developing"
  | "complete";

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

type Incoming =
  | { type: "slice"; params: ModelParams }
  | { type: "configure"; params: ModelParams }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "develop" };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const GRID_W = 112;
const GRID_H = 68;
const GRID_N = GRID_W * GRID_H;
const SNAPSHOT_FIELD_COUNT = 6;
const SNAPSHOT_LEN = GRID_N * SNAPSHOT_FIELD_COUNT;
const DT_MODEL = 0.016;
const SEED = 0x07a1;
const MAX_PENDING_MESSAGES = 64;
const MIN_LAYER_HEIGHT_UM = 0.25;
const MIN_HATCH_SPACING_UM = 0.25;
const LENS_CELL_SIZE_NM = Math.round((15 / (GRID_W - 1)) * 1000);
const TOOLPATH_PARAMETER_KEYS = [
  "layerHeight",
  "hatchSpacing",
  "hatchAngle",
  "contourCount",
  "passes",
  "speed",
] as const satisfies readonly (keyof ModelParams)[];

type SolverState = "initializing" | "ready" | "error";

type RustDiagnostics = {
  solver: string;
  gridWidth: number;
  gridHeight: number;
  fieldCount: number;
  fieldOrder: string[];
  timestepModelTime?: number;
  timestepSeconds?: number;
  exposureStep: number;
  exposureStepsTotal: number;
  developmentStep: number;
  developmentStepsTotal: number;
  exposureSimulatedModelTime?: number;
  exposureSimulatedTimeSeconds?: number;
  darkSimulatedModelTime?: number;
  developmentSimulatedModelTime?: number;
  developmentSimulatedTimeSeconds?: number;
  simulatedModelTime?: number;
  simulatedTimeSeconds?: number;
  lightUpdates?: number;
  darkUpdates?: number;
  totalUpdates: number;
  seed: number;
  checksum: string;
  ownedMemoryBytes: number;
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
  exposureStep: number;
  exposureStepsTotal: number;
  developmentStep: number;
  developmentStepsTotal: number;
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

type VolumeGeometryExports = WholeVolumeSimulation & {
  get_scan_path(): number;
  scan_path_len(): number;
  get_layer_positions(): number;
  layer_positions_len(): number;
};

type VolumeSnapshot = {
  diagnostics: VolumeDiagnostics;
  conversion: Uint8Array;
  oxygen: Uint8Array;
  radicals: Uint8Array;
  remaining: Uint8Array;
};

let params: ModelParams;
let stage: LabStage = "model";
let timer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let exposureStep = 0;
let exposureStepsTotal = 1;
let developmentStep = 0;
let developmentStepsTotal = 1;
let lensSimulation: ReactionLensSimulation | null = null;
let volumeSimulation: WholeVolumeSimulation | null = null;
let benchyOccupancy: Uint8Array | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let solverState: SolverState = "initializing";
let solverInitializationError: string | null = null;
const pendingMessages: Incoming[] = [];
let rateWindowStartedAt = performance.now();
let rateWindowUpdates = 0;
let updatesPerSecond = 0;

let linePositions = new Float32Array(0);
let layerPositions = new Float32Array(0);
let macroPositions = new Float32Array(0);

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function post(message: unknown, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function postCommandError(command: string, error: unknown) {
  post({
    type: "commandError",
    command,
    message: errorMessage(error),
    solver: "Rust/Wasm",
    stage,
  });
}

function validateWorkerParameters(next: ModelParams) {
  for (const [name, value] of Object.entries(next)) {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be finite`);
    }
  }
  if (next.layerHeight < MIN_LAYER_HEIGHT_UM) {
    throw new Error(
      `layerHeight must be at least ${MIN_LAYER_HEIGHT_UM} µm`,
    );
  }
  if (next.hatchSpacing < MIN_HATCH_SPACING_UM) {
    throw new Error(
      `hatchSpacing must be at least ${MIN_HATCH_SPACING_UM} µm`,
    );
  }
  if (
    !Number.isInteger(next.contourCount) ||
    next.contourCount < 0 ||
    next.contourCount > 64
  ) {
    throw new Error(
      "contourCount must be a whole number between zero and 64",
    );
  }
  if (!Number.isInteger(next.passes) || next.passes < 1 || next.passes > 3) {
    throw new Error("passes must be a whole number between one and three");
  }
}

function toolpathParametersChanged(next: ModelParams) {
  return (
    !params ||
    linePositions.length === 0 ||
    TOOLPATH_PARAMETER_KEYS.some((key) => params[key] !== next[key])
  );
}

function requireLensSimulation() {
  if (!lensSimulation) {
    throw new Error("Rust/Wasm simulation has not been configured");
  }
  return lensSimulation;
}

function requireVolumeSimulation() {
  if (!volumeSimulation) {
    throw new Error("Rust/Wasm 3D volume has not been configured");
  }
  return volumeSimulation;
}

function memoryBudgetBytes() {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  const conservativeMegabytes = Number.isFinite(deviceMemory)
    ? Math.max(8, Math.min(64, (deviceMemory ?? 1) * 12))
    : 32;
  return Math.floor(conservativeMegabytes * 1024 * 1024);
}

function configureVolume(next: ModelParams) {
  if (volumeSimulation) {
    volumeSimulation.set_parameters(next);
    return;
  }
  if (!benchyOccupancy) {
    throw new Error("The official 3DBenchy occupancy asset is unavailable");
  }
  volumeSimulation = new WholeVolumeSimulation(
    {
      parameters: next,
      memoryBudgetBytes: memoryBudgetBytes(),
    },
    benchyOccupancy,
  );
}

function applyLensParameters(next: ModelParams) {
  validateWorkerParameters(next);
  configureVolume(next);
  if (lensSimulation) {
    lensSimulation.set_parameters(next);
    return;
  }
  lensSimulation = new ReactionLensSimulation(
    {
      exposureStepsTotal: Math.max(1, exposureStepsTotal),
      parameters: next,
    },
    SEED,
  );
}

function resetUpdateRate() {
  rateWindowStartedAt = performance.now();
  rateWindowUpdates = 0;
  updatesPerSecond = 0;
}

function recordSimulationUpdates(count: number) {
  rateWindowUpdates += count;
  const now = performance.now();
  const elapsedMilliseconds = now - rateWindowStartedAt;
  if (elapsedMilliseconds >= 250) {
    updatesPerSecond =
      elapsedMilliseconds > 0
        ? (rateWindowUpdates * 1000) / elapsedMilliseconds
        : 0;
    rateWindowStartedAt = now;
    rateWindowUpdates = 0;
  }
}

function normalizedDiagnostics(raw: RustDiagnostics) {
  const timestepModel =
    raw.timestepModelTime ?? raw.timestepSeconds ?? DT_MODEL;
  const exposureSimulatedModelTime =
    raw.exposureSimulatedModelTime ??
    raw.exposureSimulatedTimeSeconds ??
    raw.exposureStep * timestepModel;
  const darkSimulatedModelTime = raw.darkSimulatedModelTime ?? 0;
  const developmentSimulatedModelTime =
    raw.developmentSimulatedModelTime ??
    raw.developmentSimulatedTimeSeconds ??
    0;
  const simulatedModelTime =
    raw.simulatedModelTime ??
    raw.simulatedTimeSeconds ??
    exposureSimulatedModelTime +
      darkSimulatedModelTime +
      developmentSimulatedModelTime;

  return {
    ...raw,
    timestepModel,
    exposureSimulatedModelTime,
    darkSimulatedModelTime,
    developmentSimulatedModelTime,
    simulatedModelTime,
    updatesPerSecond,
    wasmMemoryBytes: wasmMemory?.buffer.byteLength ?? 0,
  };
}

function copyWasmFloat32Export(
  pointer: number,
  length: number,
  label: string,
) {
  if (!wasmMemory) {
    throw new Error("Rust/Wasm memory is unavailable");
  }
  if (!Number.isSafeInteger(pointer) || pointer < 0) {
    throw new Error(`Rust/Wasm ${label} has an invalid pointer`);
  }
  if (pointer % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Rust/Wasm ${label} pointer is not f32-aligned`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Rust/Wasm ${label} has an invalid length`);
  }
  const byteLength = length * Float32Array.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(byteLength) ||
    !Number.isSafeInteger(pointer + byteLength) ||
    pointer + byteLength > wasmMemory.buffer.byteLength
  ) {
    throw new Error(`Rust/Wasm ${label} points outside linear memory`);
  }
  return new Float32Array(wasmMemory.buffer, pointer, length).slice();
}

function readVolumeGeometry(diagnostics: VolumeDiagnostics) {
  const volume = requireVolumeSimulation() as VolumeGeometryExports;
  const scanPathPointer = volume.get_scan_path();
  linePositions = copyWasmFloat32Export(
    scanPathPointer,
    volume.scan_path_len(),
    "scan path",
  );
  if (linePositions.length % 6 !== 0) {
    throw new Error(
      "Rust/Wasm scan path does not contain packed XYZ line segments",
    );
  }

  const layerPositionsPointer = volume.get_layer_positions();
  layerPositions = copyWasmFloat32Export(
    layerPositionsPointer,
    volume.layer_positions_len(),
    "layer positions",
  );
  if (layerPositions.length !== diagnostics.layerCount) {
    throw new Error(
      `Rust/Wasm exported ${layerPositions.length} layer positions for ${diagnostics.layerCount} diagnostic layers`,
    );
  }
}

function sliceBenchy(next: ModelParams) {
  applyLensParameters(next);
  params = next;
  stage = "slicing";
  resetFields();
  const volumeSnapshot = readVolumeSnapshot();
  const { diagnostics: volumeDiagnostics } = volumeSnapshot;
  readVolumeGeometry(volumeDiagnostics);
  stage = "ready";
  sequence += 1;

  const pathExport = linePositions.slice();
  const renderExport = macroPositions.slice();
  const layerExport = layerPositions.slice();
  post(
    {
      type: "sliceResult",
      sequence,
      pathPositions: pathExport.buffer,
      renderPositions: renderExport.buffer,
      layerPositions: layerExport.buffer,
      layerCount: volumeDiagnostics.layerCount,
      passes: params.passes,
      pathLengthUm: volumeDiagnostics.pathLengthUm,
      estimatedExposureSeconds: volumeDiagnostics.estimatedExposureSeconds,
    },
    [pathExport.buffer, renderExport.buffer, layerExport.buffer],
  );
  emitSnapshot(volumeSnapshot);
}

function resetFields() {
  const volume = requireVolumeSimulation();
  volume.reset();
  const volumeDiagnostics = volume.get_diagnostics() as VolumeDiagnostics;
  exposureStep = 0;
  developmentStep = 0;
  exposureStepsTotal = volumeDiagnostics.exposureStepsTotal;
  developmentStepsTotal = volumeDiagnostics.developmentStepsTotal;
  const simulation = requireLensSimulation();
  simulation.set_exposure_steps_total(exposureStepsTotal);
  simulation.reset(SEED);
  resetUpdateRate();
  return volumeDiagnostics;
}

function runExposureBatch() {
  const batch = 6;
  const requestedSteps = Math.max(
    0,
    Math.min(batch, exposureStepsTotal - exposureStep),
  );
  const advancedSteps =
    requireVolumeSimulation().advance_exposure_steps(requestedSteps);
  requireLensSimulation().advance_exposure_steps(advancedSteps);
  exposureStep += advancedSteps;
  recordSimulationUpdates(advancedSteps);

  if (exposureStep >= exposureStepsTotal) {
    stage = "paused";
    stopTimer();
  }
  emitSnapshot();
}

function runDevelopmentBatch() {
  const batch = 4;
  const requestedSteps = Math.min(
    batch,
    Math.max(0, developmentStepsTotal - developmentStep),
  );
  const advancedSteps =
    requireVolumeSimulation().advance_development_steps(requestedSteps);
  developmentStep += advancedSteps;
  const volumeDevelopmentProgress =
    developmentStep / Math.max(1, developmentStepsTotal);
  const lens = requireLensSimulation();
  const lensDiagnostics = lens.get_diagnostics() as RustDiagnostics;
  const lensDevelopmentTarget =
    developmentStep >= developmentStepsTotal
      ? lensDiagnostics.developmentStepsTotal
      : Math.floor(
          volumeDevelopmentProgress * lensDiagnostics.developmentStepsTotal,
        );
  const lensAdvancedSteps = lens.advance_development_steps(
    Math.max(0, lensDevelopmentTarget - lensDiagnostics.developmentStep),
  );
  recordSimulationUpdates(lensAdvancedSteps);

  if (developmentStep >= developmentStepsTotal) {
    stage = "complete";
    stopTimer();
  }
  emitSnapshot();
}

function startExposure() {
  if (macroPositions.length === 0) return;
  stage = "exposing";
  stopTimer();
  timer = setInterval(
    () => runScheduledCommand("advanceExposure", runExposureBatch),
    46,
  );
  emitSnapshot();
}

function startDevelopment() {
  if (macroPositions.length === 0) return;
  stage = "developing";
  stopTimer();
  timer = setInterval(
    () => runScheduledCommand("advanceDevelopment", runDevelopmentBatch),
    48,
  );
  emitSnapshot();
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function runScheduledCommand(command: string, callback: () => void) {
  try {
    callback();
  } catch (error) {
    stopTimer();
    stage = "paused";
    postCommandError(command, error);
  }
}

function readLensSnapshot() {
  const simulation = requireLensSimulation();
  if (!wasmMemory) {
    throw new Error("Rust/Wasm memory is unavailable");
  }

  const pointer = simulation.get_snapshot();
  const snapshotLength = simulation.snapshot_len();
  if (snapshotLength !== SNAPSHOT_LEN) {
    throw new Error(
      `Rust/Wasm snapshot length ${snapshotLength} does not match ${SNAPSHOT_LEN}`,
    );
  }

  // wasm-bindgen may grow (and therefore replace) the memory buffer. Reacquire
  // it after get_snapshot(), then copy only into JS-owned storage. The main
  // thread never receives a view into authoritative Wasm state.
  const memoryBuffer = wasmMemory.buffer;
  if (
    pointer + snapshotLength * Float32Array.BYTES_PER_ELEMENT >
    memoryBuffer.byteLength
  ) {
    throw new Error("Rust/Wasm snapshot points outside linear memory");
  }
  const fields = new Float32Array(memoryBuffer, pointer, snapshotLength);
  const oxygenScale = Math.max(1e-6, params.oxygen);
  const lens = new Uint8Array(GRID_N * 4);
  const oxygenOffset = GRID_N;
  const radicalOffset = GRID_N * 2;
  const conversionOffset = GRID_N * 3;
  const massOffset = GRID_N * 5;
  let oxygenMean = 0;
  let conversionMean = 0;
  let radicalMax = 0;
  let gelled = 0;
  let surviving = 0;

  for (let index = 0; index < GRID_N; index += 1) {
    const oxygen = fields[oxygenOffset + index];
    const radical = fields[radicalOffset + index];
    const conversion = fields[conversionOffset + index];
    const remainingMass = fields[massOffset + index];
    lens[index * 4] = Math.round(
      clamp(oxygen / oxygenScale) * 255,
    );
    lens[index * 4 + 1] = Math.round(
      clamp(Math.log1p(radical) / Math.log(5)) * 255,
    );
    lens[index * 4 + 2] = Math.round(clamp(conversion) * 255);
    lens[index * 4 + 3] = Math.round(clamp(remainingMass) * 255);
    oxygenMean += oxygen / oxygenScale;
    conversionMean += conversion;
    radicalMax = Math.max(radicalMax, radical);
    if (conversion >= params.gelPoint) gelled += 1;
    if (remainingMass >= 0.5) surviving += 1;
  }

  const diagnostics = normalizedDiagnostics(
    simulation.get_diagnostics() as RustDiagnostics,
  );
  if (
    diagnostics.gridWidth !== GRID_W ||
    diagnostics.gridHeight !== GRID_H ||
    diagnostics.fieldCount !== SNAPSHOT_FIELD_COUNT
  ) {
    throw new Error(
      "Rust/Wasm diagnostics do not match the worker snapshot contract",
    );
  }
  return {
    lens,
    diagnostics,
    lensStatistics: {
      oxygenMean: oxygenMean / GRID_N,
      conversionMean: conversionMean / GRID_N,
      radicalMax,
      gelledFraction: gelled / GRID_N,
      survivingFraction: surviving / GRID_N,
    },
  };
}

function readVolumeSnapshot() {
  const volume = requireVolumeSimulation();
  if (!wasmMemory) {
    throw new Error("Rust/Wasm memory is unavailable");
  }
  const pointer = volume.get_snapshot();
  const snapshotLength = volume.snapshot_len();
  if (snapshotLength % 7 !== 0) {
    throw new Error("Rust/Wasm 3D snapshot does not use the seven-field contract");
  }
  const memoryBuffer = wasmMemory.buffer;
  if (pointer + snapshotLength * 4 > memoryBuffer.byteLength) {
    throw new Error("Rust/Wasm 3D snapshot points outside linear memory");
  }
  const packed = new Float32Array(memoryBuffer, pointer, snapshotLength);
  const count = snapshotLength / 7;
  const refreshPositions = macroPositions.length !== count * 3;
  if (refreshPositions) {
    macroPositions = new Float32Array(count * 3);
  }
  const conversion = new Uint8Array(count);
  const oxygen = new Uint8Array(count);
  const radicals = new Uint8Array(count);
  const remaining = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const source = index * 7;
    if (refreshPositions) {
      const target = index * 3;
      macroPositions[target] = packed[source];
      macroPositions[target + 1] = packed[source + 1];
      macroPositions[target + 2] = packed[source + 2];
    }
    conversion[index] = Math.round(clamp(packed[source + 3]) * 255);
    oxygen[index] = Math.round(clamp(packed[source + 4]) * 255);
    radicals[index] = Math.round(clamp(packed[source + 5]) * 255);
    remaining[index] = Math.round(clamp(packed[source + 6]) * 255);
  }

  return {
    diagnostics: volume.get_diagnostics() as VolumeDiagnostics,
    conversion,
    oxygen,
    radicals,
    remaining,
  };
}

function emitSnapshot(volumeSnapshot?: VolumeSnapshot) {
  const { lens, diagnostics, lensStatistics } = readLensSnapshot();
  const currentVolumeSnapshot = volumeSnapshot ?? readVolumeSnapshot();
  const {
    diagnostics: volumeDiagnostics,
    conversion,
    oxygen,
    radicals,
    remaining,
  } = currentVolumeSnapshot;
  const exposureProgress = requireVolumeSimulation().exposure_progress();
  const developmentProgress = requireVolumeSimulation().development_progress();
  const focus = Array.from(requireVolumeSimulation().focus());

  const pulseEnergyPj =
    (params.power * 1e-3) / (params.repetitionRate * 1e6) / 1e-12;
  const volumeMetrics = {
    oxygenMean: volumeDiagnostics.oxygenMean,
    radicalMax: volumeDiagnostics.radicalMax,
    conversionMean: volumeDiagnostics.conversionMean,
    gelledFraction: volumeDiagnostics.gelledFraction,
    survivingFraction: volumeDiagnostics.survivingFraction,
    pulseEnergyPj,
    peakPowerW:
      pulseEnergyPj * 1e-12 / Math.max(1e-15, params.pulseDuration * 1e-15),
    checksum: volumeDiagnostics.checksum,
    cellSizeNm: Math.round(Math.min(...volumeDiagnostics.voxelPitchUm) * 1000),
    offTargetActiveVoxels: volumeDiagnostics.offTargetActiveVoxels,
    offTargetConversionMean: volumeDiagnostics.offTargetConversionMean,
    offTargetGelledFraction: volumeDiagnostics.offTargetGelledFraction,
    offTargetSurvivingFraction: volumeDiagnostics.offTargetSurvivingFraction,
  };

  post(
    {
      type: "snapshot",
      sequence,
      stage,
      exposureProgress,
      developmentProgress,
      simulatedSeconds: volumeDiagnostics.simulatedTimeSeconds,
      focus,
      lens: lens.buffer,
      lensWidth: GRID_W,
      lensHeight: GRID_H,
      conversion: conversion.buffer,
      oxygen: oxygen.buffer,
      radicals: radicals.buffer,
      remaining: remaining.buffer,
      diagnostics,
      lensDiagnostics: diagnostics,
      volumeDiagnostics,
      lensMetrics: {
        ...lensStatistics,
        cellSizeNm: LENS_CELL_SIZE_NM,
        timestepModel: diagnostics.timestepModel,
      },
      metrics: volumeMetrics,
      volumeMetrics,
    },
    [
      lens.buffer,
      conversion.buffer,
      oxygen.buffer,
      radicals.buffer,
      remaining.buffer,
    ],
  );
}

function processMessage(message: Incoming) {
  if (message.type === "slice") {
    stopTimer();
    sliceBenchy(message.params);
    return;
  }
  if (message.type === "configure") {
    stopTimer();
    if (toolpathParametersChanged(message.params)) {
      sliceBenchy(message.params);
      return;
    }
    applyLensParameters(message.params);
    params = message.params;
    resetFields();
    stage = macroPositions.length ? "ready" : "model";
    emitSnapshot();
    return;
  }
  if (message.type === "start") {
    startExposure();
    return;
  }
  if (message.type === "pause") {
    if (stage === "exposing") {
      stopTimer();
      stage = "paused";
      emitSnapshot();
    }
    return;
  }
  if (message.type === "resume") {
    if (stage === "paused" && exposureStep < exposureStepsTotal) {
      startExposure();
    }
    return;
  }
  if (message.type === "develop") {
    startDevelopment();
    return;
  }
  if (message.type === "reset") {
    stopTimer();
    resetFields();
    stage = macroPositions.length ? "ready" : "model";
    emitSnapshot();
    return;
  }
  const unsupported = message as { type?: unknown };
  throw new Error(
    `Unsupported simulation command: ${String(unsupported.type ?? "unknown")}`,
  );
}

function processMessageSafely(message: Incoming) {
  try {
    processMessage(message);
  } catch (error) {
    stopTimer();
    if (stage === "exposing" || stage === "developing") {
      stage = "paused";
    }
    postCommandError(message.type, error);
  }
}

scope.onmessage = (event) => {
  const candidate = event.data as unknown;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as { type?: unknown }).type !== "string"
  ) {
    postCommandError("unknown", "Simulation command must include a string type");
    return;
  }
  const message = candidate as Incoming;
  if (solverState === "ready") {
    processMessageSafely(message);
    return;
  }
  if (solverState === "error") {
    postCommandError(
      message.type,
      solverInitializationError ?? "Rust/Wasm initialization failed",
    );
    return;
  }
  if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
    postCommandError(
      message.type,
      "Rust/Wasm is still initializing and the command queue is full",
    );
    return;
  }
  pendingMessages.push(message);
};

async function initializeSolver() {
  post({
    type: "solverStatus",
    status: "initializing",
    solver: "Rust/Wasm",
  });
  try {
    const initialized = await initReactionLens({
      module_or_path: reactionLensWasmUrl,
    });
    const occupancyResponse = await fetch("/benchy/3dbenchy-occupancy.bin");
    if (!occupancyResponse.ok) {
      throw new Error(
        `Could not load the 3DBenchy occupancy (${occupancyResponse.status})`,
      );
    }
    benchyOccupancy = new Uint8Array(await occupancyResponse.arrayBuffer());
    const memory = initialized.memory;
    wasmMemory = memory;
    solverState = "ready";
    post({
      type: "solverStatus",
      status: "ready",
      solver: "Rust/Wasm",
      diagnostics: {
        solver: "Rust/Wasm",
        gridWidth: GRID_W,
        gridHeight: GRID_H,
        timestepModel: DT_MODEL,
        updatesPerSecond: 0,
        simulatedModelTime: 0,
        ownedMemoryBytes: 0,
        wasmMemoryBytes: memory.buffer.byteLength,
        checksum: "00000000",
      },
    });

    const queuedMessages = pendingMessages.splice(0);
    for (const message of queuedMessages) {
      processMessageSafely(message);
    }
  } catch (error) {
    stopTimer();
    solverState = "error";
    solverInitializationError = errorMessage(error);
    post({
      type: "solverStatus",
      status: "error",
      solver: "Rust/Wasm",
      message: solverInitializationError,
    });
    const rejectedMessages = pendingMessages.splice(0);
    for (const message of rejectedMessages) {
      postCommandError(message.type, solverInitializationError);
    }
  }
}

void initializeSolver();
