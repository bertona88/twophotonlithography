import initReactionLens, {
  preview_volume_psf,
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
  | { type: "inspectSlice"; zUm: number }
  | {
      type: "previewOptics";
      na: number;
      wavelength: number;
      requestId: number;
    }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "develop" };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const XY_SLICE_FIELD_COUNT = 5;
const MAX_PENDING_MESSAGES = 64;
const MIN_LAYER_HEIGHT_UM = 0.25;
const MIN_HATCH_SPACING_UM = 0.25;
const SOLVER_SLICE_BUDGET_MS = 24;
const SNAPSHOT_INTERVAL_MS = 100;
const DIAGNOSTICS_INTERVAL_MS = 500;
const EXPOSURE_STEPS_PER_SLICE = 6;
const DEVELOPMENT_STEPS_PER_SLICE = 4;
const TOOLPATH_PARAMETER_KEYS = [
  "layerHeight",
  "hatchSpacing",
  "hatchAngle",
  "contourCount",
  "passes",
  "speed",
] as const satisfies readonly (keyof ModelParams)[];

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

type PsfPreview = {
  model: string;
  qualityTier: string;
  pupilSamples: number;
  kernelVoxels: number;
  na: number;
  wavelengthNm: number;
  coneHalfAngleRad: number;
  fwhmRadiiUm: [number, number, number];
  tenthMaxRadiiUm: [number, number, number];
};

type VolumeGeometryExports = WholeVolumeSimulation & {
  get_scan_path(): number;
  scan_path_len(): number;
  get_layer_positions(): number;
  layer_positions_len(): number;
  get_xy_slice(zUm: number): number;
  xy_slice_len(): number;
  xy_slice_width(): number;
  xy_slice_height(): number;
  xy_slice_z_um(): number;
  get_cached_diagnostics(): VolumeDiagnostics;
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
let volumeSimulation: WholeVolumeSimulation | null = null;
let benchyOccupancy: Uint8Array | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let solverState: SolverState = "initializing";
let solverInitializationError: string | null = null;
const pendingMessages: Incoming[] = [];
let rateWindowStartedAt = performance.now();
let rateWindowUpdates = 0;
let updatesPerSecond = 0;
let inspectedZUm = 0;
let lastSnapshotAt = 0;
let lastDiagnosticsAt = 0;

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

function configureSimulation(next: ModelParams) {
  validateWorkerParameters(next);
  configureVolume(next);
}

function resetUpdateRate() {
  const now = performance.now();
  rateWindowStartedAt = now;
  rateWindowUpdates = 0;
  updatesPerSecond = 0;
  lastSnapshotAt = now;
  lastDiagnosticsAt = now;
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
  configureSimulation(next);
  params = next;
  stage = "slicing";
  resetFields();
  const volumeSnapshot = readVolumeSnapshot();
  const { diagnostics: volumeDiagnostics } = volumeSnapshot;
  readVolumeGeometry(volumeDiagnostics);
  inspectedZUm =
    layerPositions[Math.max(0, Math.floor(layerPositions.length * 0.43))] ??
    volumeDiagnostics.voxelPitchUm[2];
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
  resetUpdateRate();
  return volumeDiagnostics;
}

function publishScheduledSnapshot(forceDiagnostics = false) {
  const now = performance.now();
  if (!forceDiagnostics && now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) {
    return;
  }
  const refreshDiagnostics =
    forceDiagnostics || now - lastDiagnosticsAt >= DIAGNOSTICS_INTERVAL_MS;
  emitSnapshot(undefined, refreshDiagnostics);
  const publishedAt = performance.now();
  lastSnapshotAt = publishedAt;
  if (refreshDiagnostics) {
    lastDiagnosticsAt = publishedAt;
  }
}

function scheduleNext(callback: () => void) {
  timer = setTimeout(callback, 0);
}

function runExposureSlice() {
  const sliceStartedAt = performance.now();
  let advancedSteps = 0;
  do {
    const remainingSteps = exposureStepsTotal - exposureStep;
    if (remainingSteps <= 0) break;
    const advanced = requireVolumeSimulation().advance_exposure_steps(1);
    exposureStep += advanced;
    advancedSteps += advanced;
    if (advanced === 0) break;
  } while (
    advancedSteps < EXPOSURE_STEPS_PER_SLICE &&
    performance.now() - sliceStartedAt < SOLVER_SLICE_BUDGET_MS
  );
  recordSimulationUpdates(advancedSteps);

  if (exposureStep >= exposureStepsTotal) {
    stage = "paused";
    stopTimer();
    publishScheduledSnapshot(true);
    return;
  }
  publishScheduledSnapshot();
  scheduleNext(() => runScheduledCommand("advanceExposure", runExposureSlice));
}

function runDevelopmentSlice() {
  const sliceStartedAt = performance.now();
  let advancedSteps = 0;
  do {
    const remainingSteps = developmentStepsTotal - developmentStep;
    if (remainingSteps <= 0) break;
    const advanced = requireVolumeSimulation().advance_development_steps(1);
    developmentStep += advanced;
    advancedSteps += advanced;
    if (advanced === 0) break;
  } while (
    advancedSteps < DEVELOPMENT_STEPS_PER_SLICE &&
    performance.now() - sliceStartedAt < SOLVER_SLICE_BUDGET_MS
  );
  recordSimulationUpdates(advancedSteps);

  if (developmentStep >= developmentStepsTotal) {
    stage = "complete";
    stopTimer();
    publishScheduledSnapshot(true);
    return;
  }
  publishScheduledSnapshot();
  scheduleNext(() =>
    runScheduledCommand("advanceDevelopment", runDevelopmentSlice),
  );
}

function startExposure() {
  if (macroPositions.length === 0) return;
  stage = "exposing";
  stopTimer();
  resetUpdateRate();
  emitSnapshot(undefined, false);
  lastSnapshotAt = performance.now();
  scheduleNext(() =>
    runScheduledCommand("advanceExposure", runExposureSlice),
  );
}

function startDevelopment() {
  if (macroPositions.length === 0) return;
  stage = "developing";
  stopTimer();
  resetUpdateRate();
  emitSnapshot(undefined, false);
  lastSnapshotAt = performance.now();
  scheduleNext(() =>
    runScheduledCommand("advanceDevelopment", runDevelopmentSlice),
  );
}

function stopTimer() {
  if (timer !== null) {
    clearTimeout(timer);
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

function readXYSlice(volumeDiagnostics: VolumeDiagnostics) {
  const volume = requireVolumeSimulation() as VolumeGeometryExports;
  if (!wasmMemory) {
    throw new Error("Rust/Wasm memory is unavailable");
  }

  const pointer = volume.get_xy_slice(inspectedZUm);
  const snapshotLength = volume.xy_slice_len();
  const width = volume.xy_slice_width();
  const height = volume.xy_slice_height();
  const cellCount = width * height;
  if (snapshotLength !== cellCount * XY_SLICE_FIELD_COUNT) {
    throw new Error(
      "Rust/Wasm XY slice does not use the five-field plane contract",
    );
  }

  // wasm-bindgen may grow (and therefore replace) the memory buffer. Reacquire
  // it after get_xy_slice(), then copy only into JS-owned storage. The main
  // thread never receives a view into authoritative Wasm state.
  const memoryBuffer = wasmMemory.buffer;
  if (
    pointer + snapshotLength * Float32Array.BYTES_PER_ELEMENT >
    memoryBuffer.byteLength
  ) {
    throw new Error("Rust/Wasm XY slice points outside linear memory");
  }
  const fields = new Float32Array(memoryBuffer, pointer, snapshotLength);
  const pixels = new Uint8Array(cellCount * XY_SLICE_FIELD_COUNT);
  let oxygenMean = 0;
  let conversionMean = 0;
  let radicalMax = 0;
  let gelled = 0;
  let surviving = 0;
  let targetCells = 0;

  for (let index = 0; index < cellCount; index += 1) {
    const source = index * XY_SLICE_FIELD_COUNT;
    const oxygen = fields[source];
    const radical = fields[source + 1];
    const conversion = fields[source + 2];
    const remainingMass = fields[source + 3];
    const occupied = fields[source + 4] >= 0.5;
    pixels[source] = Math.round(clamp(oxygen) * 255);
    pixels[source + 1] = Math.round(
      clamp(Math.log1p(radical) / Math.log(5)) * 255,
    );
    pixels[source + 2] = Math.round(clamp(conversion) * 255);
    pixels[source + 3] = Math.round(clamp(remainingMass) * 255);
    pixels[source + 4] = occupied ? 255 : 0;
    if (!occupied) continue;
    targetCells += 1;
    oxygenMean += oxygen;
    conversionMean += conversion;
    radicalMax = Math.max(radicalMax, radical);
    if (conversion >= params.gelPoint) gelled += 1;
    if (remainingMass >= 0.5) surviving += 1;
  }

  const denominator = Math.max(1, targetCells);
  inspectedZUm = volume.xy_slice_z_um();
  return {
    pixels,
    width,
    height,
    zUm: inspectedZUm,
    metrics: {
      oxygenMean: oxygenMean / denominator,
      conversionMean: conversionMean / denominator,
      radicalMax,
      gelledFraction: gelled / denominator,
      survivingFraction: surviving / denominator,
      targetCells,
      voxelPitchNm: [
        Math.round(volumeDiagnostics.voxelPitchUm[0] * 1000),
        Math.round(volumeDiagnostics.voxelPitchUm[1] * 1000),
      ],
    },
  };
}

function readVolumeSnapshot(refreshDiagnostics = true) {
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
    diagnostics: refreshDiagnostics
      ? (volume.get_diagnostics() as VolumeDiagnostics)
      : (volume as VolumeGeometryExports).get_cached_diagnostics(),
    conversion,
    oxygen,
    radicals,
    remaining,
  };
}

function emitSnapshot(
  volumeSnapshot?: VolumeSnapshot,
  refreshDiagnostics = true,
) {
  const currentVolumeSnapshot =
    volumeSnapshot ?? readVolumeSnapshot(refreshDiagnostics);
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
  if (
    stage === "exposing" ||
    (stage === "paused" && exposureProgress >= 0.999)
  ) {
    inspectedZUm = focus[2];
  }
  const slice = readXYSlice(volumeDiagnostics);

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
      slicePixels: slice.pixels.buffer,
      sliceWidth: slice.width,
      sliceHeight: slice.height,
      sliceZUm: slice.zUm,
      sliceMetrics: slice.metrics,
      conversion: conversion.buffer,
      oxygen: oxygen.buffer,
      radicals: radicals.buffer,
      remaining: remaining.buffer,
      volumeDiagnostics,
      updatesPerSecond,
      wasmMemoryBytes: wasmMemory?.buffer.byteLength ?? 0,
      metrics: volumeMetrics,
      volumeMetrics,
    },
    [
      slice.pixels.buffer,
      conversion.buffer,
      oxygen.buffer,
      radicals.buffer,
      remaining.buffer,
    ],
  );
}

function emitSliceInspection() {
  const volumeDiagnostics =
    requireVolumeSimulation().get_diagnostics() as VolumeDiagnostics;
  const slice = readXYSlice(volumeDiagnostics);
  post(
    {
      type: "sliceInspection",
      slicePixels: slice.pixels.buffer,
      sliceWidth: slice.width,
      sliceHeight: slice.height,
      sliceZUm: slice.zUm,
      sliceMetrics: slice.metrics,
      volumeChecksum: volumeDiagnostics.checksum,
    },
    [slice.pixels.buffer],
  );
}

function processMessage(message: Incoming) {
  if (message.type === "previewOptics") {
    const preview = preview_volume_psf(
      message.na,
      message.wavelength,
      memoryBudgetBytes(),
    ) as PsfPreview;
    post({ type: "opticsPreview", requestId: message.requestId, preview });
    return;
  }
  if (message.type === "slice") {
    stopTimer();
    sliceBenchy(message.params);
    return;
  }
  if (message.type === "inspectSlice") {
    if (!Number.isFinite(message.zUm)) {
      throw new Error("Slice Z position must be finite");
    }
    inspectedZUm = message.zUm;
    emitSliceInspection();
    return;
  }
  if (message.type === "configure") {
    stopTimer();
    if (toolpathParametersChanged(message.params)) {
      sliceBenchy(message.params);
      return;
    }
    configureSimulation(message.params);
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
      wasmMemoryBytes: memory.buffer.byteLength,
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
