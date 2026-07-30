import initReactionLens, {
  ReactionLensSimulation,
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
const LENS_W_UM = 15;
const DT_MODEL = 0.016;
const SEED = 0x07a1;
const MAX_PENDING_MESSAGES = 64;
const MIN_HATCH_SPACING_UM = 0.25;
const MAX_HATCH_LINES_PER_REGION = 256;

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

let params: ModelParams;
let stage: LabStage = "model";
let timer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let exposureStep = 0;
let exposureStepsTotal = 1;
let developmentStep = 0;
let developmentStepsTotal = 1;
let pathLength = 0;
let lensSimulation: ReactionLensSimulation | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let solverState: SolverState = "initializing";
let solverInitializationError: string | null = null;
const pendingMessages: Incoming[] = [];
let rateWindowStartedAt = performance.now();
let rateWindowUpdates = 0;
let updatesPerSecond = 0;

let linePositions = new Float32Array(0);
let macroPositions = new Float32Array(0);
let macroP = new Float32Array(0);
let macroO = new Float32Array(0);
let macroR = new Float32Array(0);
let macroX = new Float32Array(0);
let macroMass = new Float32Array(0);
let macroDeveloper = new Float32Array(0);
let macroScratchP = new Float32Array(0);
let macroScratchO = new Float32Array(0);
let macroScratchR = new Float32Array(0);
let macroScratchX = new Float32Array(0);
let macroScratchDeveloper = new Float32Array(0);
let macroScratchMass = new Float32Array(0);

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
  if (next.layerHeight <= 0) {
    throw new Error("layerHeight must be greater than zero");
  }
  if (next.hatchSpacing < MIN_HATCH_SPACING_UM) {
    throw new Error(
      `hatchSpacing must be at least ${MIN_HATCH_SPACING_UM} µm`,
    );
  }
  if (next.contourCount < 0) {
    throw new Error("contourCount must not be negative");
  }
  if (next.contourCount > 64) {
    throw new Error("contourCount must not exceed 64");
  }
}

function requireLensSimulation() {
  if (!lensSimulation) {
    throw new Error("Rust/Wasm simulation has not been configured");
  }
  return lensSimulation;
}

function applyLensParameters(next: ModelParams) {
  validateWorkerParameters(next);
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

function distance3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function hatchLineBudget(radius: number, spacing: number) {
  const budget = Math.ceil((radius * 2) / spacing) + 2;
  if (
    !Number.isSafeInteger(budget) ||
    budget < 1 ||
    budget > MAX_HATCH_LINES_PER_REGION
  ) {
    throw new Error(
      `Hatch region requires an unsupported number of lines (${budget})`,
    );
  }
  return budget;
}

function addSegment(
  lines: number[],
  nodes: number[],
  a: [number, number, number],
  b: [number, number, number],
) {
  lines.push(...a, ...b);
  const length = distance3(...a, ...b);
  pathLength += length;
  const count = Math.max(1, Math.ceil(length / 0.55));
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    nodes.push(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    );
  }
}

function addLoop(
  lines: number[],
  nodes: number[],
  points: [number, number, number][],
) {
  for (let index = 0; index < points.length; index += 1) {
    addSegment(lines, nodes, points[index], points[(index + 1) % points.length]);
  }
}

function addEllipse(
  lines: number[],
  nodes: number[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  z: number,
  points = 42,
) {
  const loop: [number, number, number][] = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    loop.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, z]);
  }
  addLoop(lines, nodes, loop);
}

function addRectangle(
  lines: number[],
  nodes: number[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z: number,
) {
  addLoop(lines, nodes, [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ]);
}

function hatchEllipse(
  lines: number[],
  nodes: number[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  z: number,
  spacing: number,
  angleDegrees: number,
) {
  const angle = (angleDegrees * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const radius = Math.hypot(rx, ry);
  const lineBudget = hatchLineBudget(radius, spacing);
  let lineCount = 0;

  for (let offset = -radius; offset <= radius; offset += spacing) {
    if (lineCount >= lineBudget) {
      throw new Error("Hatch ellipse exceeded its bounded line budget");
    }
    lineCount += 1;
    let start: [number, number, number] | null = null;
    let previous: [number, number, number] | null = null;
    const samples = 90;
    for (let sample = 0; sample <= samples; sample += 1) {
      const along = -radius + (sample / samples) * radius * 2;
      const px = cx + ux * along + vx * offset;
      const py = cy + uy * along + vy * offset;
      const inside =
        ((px - cx) * (px - cx)) / (rx * rx) +
          ((py - cy) * (py - cy)) / (ry * ry) <=
        1;
      if (inside && start === null) {
        start = [px, py, z];
      }
      if (inside) {
        previous = [px, py, z];
      }
      if ((!inside || sample === samples) && start && previous) {
        addSegment(lines, nodes, start, previous);
        start = null;
        previous = null;
      }
    }
  }
}

function hatchRectangle(
  lines: number[],
  nodes: number[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z: number,
  spacing: number,
  angleDegrees: number,
) {
  const angle = ((angleDegrees % 180) * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const radius = Math.hypot(x1 - x0, y1 - y0) / 2;
  const lineBudget = hatchLineBudget(radius, spacing);
  let lineCount = 0;

  for (let offset = -radius; offset <= radius; offset += spacing) {
    if (lineCount >= lineBudget) {
      throw new Error("Hatch rectangle exceeded its bounded line budget");
    }
    lineCount += 1;
    let start: [number, number, number] | null = null;
    let previous: [number, number, number] | null = null;
    const samples = 96;
    for (let sample = 0; sample <= samples; sample += 1) {
      const along = -radius + (sample / samples) * radius * 2;
      const px = cx + ux * along + vx * offset;
      const py = cy + uy * along + vy * offset;
      const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
      if (inside && start === null) start = [px, py, z];
      if (inside) previous = [px, py, z];
      if ((!inside || sample === samples) && start && previous) {
        addSegment(lines, nodes, start, previous);
        start = null;
        previous = null;
      }
    }
  }
}

function sliceBenchy(next: ModelParams) {
  applyLensParameters(next);
  params = next;
  stage = "slicing";
  pathLength = 0;
  const lines: number[] = [];
  const nodes: number[] = [];
  const layerCount = Math.max(
    8,
    Math.min(72, Math.floor(12.7 / params.layerHeight) + 1),
  );

  for (let layer = 0; layer < layerCount; layer += 1) {
    const z = layer * params.layerHeight + 0.18;
    const hatchAngle = params.hatchAngle + (layer % 2) * 90;

    if (z < 4.7) {
      const normalized = clamp(z / 4.7);
      const rx = 9.2 + 1.6 * normalized;
      const ry = 2.4 + 2.0 * normalized;
      const cx = -0.65 + normalized * 0.45;
      for (let contour = 0; contour < params.contourCount; contour += 1) {
        const inset = contour * 0.2;
        addEllipse(lines, nodes, cx, 0, rx - inset, ry - inset, z);
      }
      hatchEllipse(
        lines,
        nodes,
        cx,
        0,
        rx - params.contourCount * 0.22,
        ry - params.contourCount * 0.22,
        z,
        params.hatchSpacing,
        hatchAngle,
      );
    } else if (z < 5.35) {
      addEllipse(lines, nodes, -0.2, 0, 10.6, 4.35, z);
      hatchEllipse(
        lines,
        nodes,
        -0.2,
        0,
        10.1,
        3.9,
        z,
        params.hatchSpacing,
        hatchAngle,
      );
    } else if (z < 8.9) {
      addRectangle(lines, nodes, -2.5, 6.7, -3.25, 3.25, z);
      const wall = Math.max(0.45, params.hatchSpacing);
      hatchRectangle(
        lines,
        nodes,
        -2.5,
        6.7,
        -3.25,
        -3.25 + wall,
        z,
        params.hatchSpacing,
        hatchAngle,
      );
      hatchRectangle(
        lines,
        nodes,
        -2.5,
        6.7,
        3.25 - wall,
        3.25,
        z,
        params.hatchSpacing,
        hatchAngle,
      );
      hatchRectangle(
        lines,
        nodes,
        -2.5,
        -2.5 + wall,
        -3.25,
        3.25,
        z,
        params.hatchSpacing,
        hatchAngle + 90,
      );
    } else if (z < 9.6) {
      addRectangle(lines, nodes, -3.25, 7.5, -3.8, 3.8, z);
      hatchRectangle(
        lines,
        nodes,
        -3.25,
        7.5,
        -3.8,
        3.8,
        z,
        params.hatchSpacing,
        hatchAngle,
      );
    } else if (z < 12.7) {
      addEllipse(lines, nodes, 4.1, 0, 1.35, 1.35, z, 30);
      addEllipse(lines, nodes, 4.1, 0, 0.72, 0.72, z, 24);
    }
  }

  linePositions = new Float32Array(lines);
  const rawNodeCount = Math.floor(nodes.length / 3);
  const maximumMacroNodes = 6000;
  if (rawNodeCount > maximumMacroNodes) {
    const sampled = new Float32Array(maximumMacroNodes * 3);
    for (let index = 0; index < maximumMacroNodes; index += 1) {
      const sourceIndex = Math.floor(
        (index / (maximumMacroNodes - 1)) * (rawNodeCount - 1),
      );
      sampled[index * 3] = nodes[sourceIndex * 3];
      sampled[index * 3 + 1] = nodes[sourceIndex * 3 + 1];
      sampled[index * 3 + 2] = nodes[sourceIndex * 3 + 2];
    }
    macroPositions = sampled;
  } else {
    macroPositions = new Float32Array(nodes);
  }
  resetFields();
  stage = "ready";
  sequence += 1;

  const lineExport = linePositions.slice();
  const nodeExport = macroPositions.slice();
  post(
    {
      type: "sliceResult",
      sequence,
      lines: lineExport.buffer,
      nodes: nodeExport.buffer,
      layerCount,
      pathLength,
      estimatedSeconds:
        (pathLength * Math.max(1, params.passes)) / Math.max(1, params.speed),
    },
    [lineExport.buffer, nodeExport.buffer],
  );
  emitSnapshot();
}

function resetFields() {
  const count = Math.floor(macroPositions.length / 3);
  macroP = new Float32Array(count).fill(params?.initiator ?? 1);
  macroO = new Float32Array(count).fill(params?.oxygen ?? 1);
  macroR = new Float32Array(count);
  macroX = new Float32Array(count);
  macroMass = new Float32Array(count).fill(1);
  macroDeveloper = new Float32Array(count);
  macroScratchP = new Float32Array(count);
  macroScratchO = new Float32Array(count);
  macroScratchR = new Float32Array(count);
  macroScratchX = new Float32Array(count);
  macroScratchDeveloper = new Float32Array(count);
  macroScratchMass = new Float32Array(count).fill(1);

  exposureStep = 0;
  developmentStep = 0;
  exposureStepsTotal = Math.max(
    420,
    Math.min(
      7200,
      Math.floor(count * Math.max(1, params?.passes ?? 1) * 0.72),
    ),
  );
  developmentStepsTotal = 210;
  const simulation = requireLensSimulation();
  simulation.set_exposure_steps_total(exposureStepsTotal);
  simulation.reset(SEED);
  resetUpdateRate();
}

function stepMacro(progress: number) {
  const count = macroX.length;
  if (count === 0) return;
  const focusFloat = progress * Math.max(0, count * params.passes - 1);
  const focusIndex = Math.floor(focusFloat % count);
  const fx = macroPositions[focusIndex * 3];
  const fy = macroPositions[focusIndex * 3 + 1];
  const fz = macroPositions[focusIndex * 3 + 2];
  const pathSamplingStride = Math.max(
    1,
    (count * params.passes) / Math.max(1, exposureStepsTotal),
  );
  const sourceScale =
    3.6 *
    Math.pow(params.power / 16, 2) *
    (80 / params.repetitionRate) *
    (100 / params.pulseDuration) *
    (45 / params.speed) *
    pathSamplingStride;
  const activeIndexRadius = Math.min(
    Math.floor(count / 2),
    Math.ceil(28 * pathSamplingStride),
  );

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const directIndexDistance = Math.abs(index - focusIndex);
    const wrappedIndexDistance = Math.min(
      directIndexDistance,
      count - directIndexDistance,
    );
    let source = 0;
    if (wrappedIndexDistance <= activeIndexRadius) {
      const dx = macroPositions[offset] - fx;
      const dy = macroPositions[offset + 1] - fy;
      const dz = macroPositions[offset + 2] - fz;
      const distanceSquared = dx * dx + dy * dy + dz * dz * 0.18;
      source = sourceScale * Math.exp(-distanceSquared / 0.19);
    }
    const previous = Math.max(0, index - 1);
    const next = Math.min(count - 1, index + 1);
    const previousDistance = distance3(
      macroPositions[offset],
      macroPositions[offset + 1],
      macroPositions[offset + 2],
      macroPositions[previous * 3],
      macroPositions[previous * 3 + 1],
      macroPositions[previous * 3 + 2],
    );
    const nextDistance = distance3(
      macroPositions[offset],
      macroPositions[offset + 1],
      macroPositions[offset + 2],
      macroPositions[next * 3],
      macroPositions[next * 3 + 1],
      macroPositions[next * 3 + 2],
    );
    const connectedPrevious = previousDistance < 0.9 ? previous : index;
    const connectedNext = nextDistance < 0.9 ? next : index;
    const lapP =
      macroP[connectedPrevious] + macroP[connectedNext] - 2 * macroP[index];
    const lapO =
      macroO[connectedPrevious] + macroO[connectedNext] - 2 * macroO[index];
    const lapR =
      macroR[connectedPrevious] + macroR[connectedNext] - 2 * macroR[index];
    const radicalLoss =
      (params.darkLoss + params.oxygenQuench * macroO[index]) * macroR[index] +
      params.termination * macroR[index] * macroR[index];

    macroScratchP[index] = clamp(
      macroP[index] +
        DT_MODEL *
          (params.piDiffusion * lapP -
            params.piDepletion * source * macroP[index]),
      0,
      params.initiator,
    );
    macroScratchR[index] = clamp(
      macroR[index] +
        DT_MODEL *
          (params.radicalDiffusion * lapR +
            params.radicalYield * source * macroP[index] -
            radicalLoss),
      0,
      8,
    );
    macroScratchO[index] = clamp(
      macroO[index] +
        DT_MODEL *
          (params.oxygenDiffusion * lapO +
            params.oxygenDiffusion * 0.012 * (params.oxygen - macroO[index]) -
            0.2 * params.oxygenQuench * macroO[index] * macroR[index]),
      0,
      params.oxygen,
    );
    macroScratchX[index] = clamp(
      macroX[index] +
        DT_MODEL * params.propagation * macroR[index] * (1 - macroX[index]),
    );
  }

  [macroP, macroScratchP] = [macroScratchP, macroP];
  [macroO, macroScratchO] = [macroScratchO, macroO];
  [macroR, macroScratchR] = [macroScratchR, macroR];
  [macroX, macroScratchX] = [macroScratchX, macroX];
}

function runExposureBatch() {
  const batch = 34;
  const requestedSteps = Math.max(
    0,
    Math.min(batch, exposureStepsTotal - exposureStep),
  );
  const advancedSteps =
    requireLensSimulation().advance_exposure_steps(requestedSteps);
  for (let step = 0; step < advancedSteps; step += 1) {
    const progress =
      (exposureStep + step) / Math.max(1, exposureStepsTotal - 1);
    stepMacro(progress);
  }
  exposureStep += advancedSteps;
  recordSimulationUpdates(advancedSteps);

  if (exposureStep >= exposureStepsTotal) {
    stage = "paused";
    stopTimer();
  }
  emitSnapshot();
}

function runDevelopmentBatch() {
  const batch = 6;
  const dtDevelopment =
    params.developmentTime / Math.max(1, developmentStepsTotal);
  const requestedSteps = Math.min(
    batch,
    Math.max(0, developmentStepsTotal - developmentStep),
  );
  const advancedSteps =
    requireLensSimulation().advance_development_steps(requestedSteps);
  for (let step = 0; step < advancedSteps; step += 1) {
    for (let index = 0; index < macroMass.length; index += 1) {
      const offset = index * 3;
      const previous = Math.max(0, index - 1);
      const next = Math.min(macroMass.length - 1, index + 1);
      const previousDistance = distance3(
        macroPositions[offset],
        macroPositions[offset + 1],
        macroPositions[offset + 2],
        macroPositions[previous * 3],
        macroPositions[previous * 3 + 1],
        macroPositions[previous * 3 + 2],
      );
      const nextDistance = distance3(
        macroPositions[offset],
        macroPositions[offset + 1],
        macroPositions[offset + 2],
        macroPositions[next * 3],
        macroPositions[next * 3 + 1],
        macroPositions[next * 3 + 2],
      );
      const connectedPrevious = previousDistance < 0.9 ? previous : index;
      const connectedNext = nextDistance < 0.9 ? next : index;
      const lapDeveloper =
        (macroDeveloper[connectedPrevious] +
          macroDeveloper[connectedNext] -
          2 * macroDeveloper[index]) /
        (0.55 * 0.55);
      const gel = Math.pow(
        clamp((macroX[index] - params.gelPoint) / (1 - params.gelPoint)),
        0.7,
      );
      const diffusivity =
        0.014 + 0.08 * (1 - macroMass[index]) + 0.02 * Math.exp(-3 * gel);
      macroScratchDeveloper[index] = clamp(
        macroDeveloper[index] + dtDevelopment * diffusivity * lapDeveloper,
      );
      macroScratchMass[index] = clamp(
        macroMass[index] -
          dtDevelopment *
            params.developerRate *
            Math.exp(-params.developerResistance * gel) *
            macroDeveloper[index] *
            macroMass[index],
      );

      const px = macroPositions[offset];
      const py = macroPositions[offset + 1];
      const pz = macroPositions[offset + 2];
      const touchesBath =
        Math.abs(py) > 3.2 || px < -9.2 || px > 9.2 || pz < 0.6 || pz > 12;
      if (touchesBath) macroScratchDeveloper[index] = 1;
    }
    [macroDeveloper, macroScratchDeveloper] = [
      macroScratchDeveloper,
      macroDeveloper,
    ];
    [macroMass, macroScratchMass] = [macroScratchMass, macroMass];
    developmentStep += 1;
  }
  recordSimulationUpdates(advancedSteps);

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

function emitSnapshot() {
  const { lens, diagnostics, lensStatistics } = readLensSnapshot();
  const oxygenScale = Math.max(1e-6, params.oxygen);

  const conversion = new Uint8Array(macroX.length);
  const oxygen = new Uint8Array(macroO.length);
  const radicals = new Uint8Array(macroR.length);
  const remaining = new Uint8Array(macroMass.length);
  for (let index = 0; index < macroX.length; index += 1) {
    conversion[index] = Math.round(clamp(macroX[index]) * 255);
    oxygen[index] = Math.round(clamp(macroO[index] / oxygenScale) * 255);
    radicals[index] = Math.round(
      clamp(Math.log1p(macroR[index]) / Math.log(5)) * 255,
    );
    remaining[index] = Math.round(clamp(macroMass[index]) * 255);
  }

  const exposureProgress = clamp(exposureStep / exposureStepsTotal);
  const developmentProgress = clamp(developmentStep / developmentStepsTotal);
  const focusIndex =
    macroX.length > 0
      ? Math.min(
          macroX.length - 1,
          Math.floor(
            ((exposureProgress * macroX.length * params.passes) % macroX.length) ||
              0,
          ),
        )
      : 0;
  const focus = macroX.length
    ? [
        macroPositions[focusIndex * 3],
        macroPositions[focusIndex * 3 + 1],
        macroPositions[focusIndex * 3 + 2],
      ]
    : [0, 0, 7];

  const pulseEnergyPj =
    (params.power * 1e-3) / (params.repetitionRate * 1e6) / 1e-12;
  const physicalExposureSeconds =
    (pathLength * params.passes) / Math.max(1, params.speed);

  post(
    {
      type: "snapshot",
      sequence,
      stage,
      exposureProgress,
      developmentProgress,
      simulatedSeconds: exposureProgress * physicalExposureSeconds,
      focus,
      lens: lens.buffer,
      lensWidth: GRID_W,
      lensHeight: GRID_H,
      conversion: conversion.buffer,
      oxygen: oxygen.buffer,
      radicals: radicals.buffer,
      remaining: remaining.buffer,
      diagnostics,
      metrics: {
        ...lensStatistics,
        pulseEnergyPj,
        peakPowerW:
          pulseEnergyPj * 1e-12 / Math.max(1e-15, params.pulseDuration * 1e-15),
        checksum: diagnostics.checksum,
        cellSizeNm: Math.round((LENS_W_UM / (GRID_W - 1)) * 1000),
        timestepModel: diagnostics.timestepModel,
      },
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
