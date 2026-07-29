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
const LENS_W_UM = 15;
const LENS_H_UM = 9;
const DX = LENS_W_UM / (GRID_W - 1);
const DZ = LENS_H_UM / (GRID_H - 1);
const DT = 0.016;

let params: ModelParams;
let stage: LabStage = "model";
let timer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let exposureStep = 0;
let exposureStepsTotal = 1;
let developmentStep = 0;
let developmentStepsTotal = 1;
let pathLength = 0;

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

let p = new Float32Array(GRID_N);
let o = new Float32Array(GRID_N);
let r = new Float32Array(GRID_N);
let x = new Float32Array(GRID_N);
let developer = new Float32Array(GRID_N);
let mass = new Float32Array(GRID_N);
let p2 = new Float32Array(GRID_N);
let o2 = new Float32Array(GRID_N);
let r2 = new Float32Array(GRID_N);
let x2 = new Float32Array(GRID_N);
let developer2 = new Float32Array(GRID_N);
let mass2 = new Float32Array(GRID_N);

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function post(message: unknown, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
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

  for (let offset = -radius; offset <= radius; offset += spacing) {
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

  for (let offset = -radius; offset <= radius; offset += spacing) {
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
  p.fill(params?.initiator ?? 1);
  o.fill(params?.oxygen ?? 1);
  r.fill(0);
  x.fill(0);
  developer.fill(0);
  mass.fill(1);
  p2.fill(0);
  o2.fill(0);
  r2.fill(0);
  x2.fill(0);
  developer2.fill(0);
  mass2.fill(1);

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
}

function swapLensBuffers() {
  [p, p2] = [p2, p];
  [o, o2] = [o2, o];
  [r, r2] = [r2, r];
  [x, x2] = [x2, x];
}

function laplacian(field: Float32Array, index: number, ix: number, iz: number) {
  const left = field[index - (ix > 0 ? 1 : 0)];
  const right = field[index + (ix < GRID_W - 1 ? 1 : 0)];
  const down = field[index - (iz > 0 ? GRID_W : 0)];
  const up = field[index + (iz < GRID_H - 1 ? GRID_W : 0)];
  return (
    (left + right - field[index] * 2) / (DX * DX) +
    (down + up - field[index] * 2) / (DZ * DZ)
  );
}

function stepLens(progress: number) {
  const phase = (progress * Math.max(1, params.passes) * 8.2) % 1;
  const focusX = (phase - 0.5) * LENS_W_UM * 0.78;
  const focusZ = Math.sin(progress * Math.PI * 7) * 0.72;
  const waist = Math.max(0.2, (0.36 * params.wavelength) / 780 / params.na);
  const axial = waist * 3.1;
  const sourceScale =
    4 *
    Math.pow(params.power / 16, 2) *
    (80 / params.repetitionRate) *
    (100 / params.pulseDuration) *
    (45 / params.speed);

  for (let iz = 0; iz < GRID_H; iz += 1) {
    const zPos = (iz / (GRID_H - 1) - 0.5) * LENS_H_UM;
    for (let ix = 0; ix < GRID_W; ix += 1) {
      const index = iz * GRID_W + ix;
      const xPos = (ix / (GRID_W - 1) - 0.5) * LENS_W_UM;
      const radial = (xPos - focusX) / waist;
      const axialDistance = (zPos - focusZ) / axial;
      const psi = Math.exp(-2 * (radial * radial + axialDistance * axialDistance));
      const source = sourceScale * psi * psi;
      const lp = laplacian(p, index, ix, iz);
      const lo = laplacian(o, index, ix, iz);
      const lr = laplacian(r, index, ix, iz);
      const radicalLoss =
        (params.darkLoss + params.oxygenQuench * o[index]) * r[index] +
        params.termination * r[index] * r[index];
      p2[index] = clamp(
        p[index] +
          DT * (params.piDiffusion * lp - params.piDepletion * source * p[index]),
        0,
        params.initiator,
      );
      r2[index] = clamp(
        r[index] +
          DT *
            (params.radicalDiffusion * lr +
              params.radicalYield * source * p[index] -
              radicalLoss),
        0,
        8,
      );
      o2[index] = clamp(
        o[index] +
          DT *
            (params.oxygenDiffusion * lo -
              0.2 * params.oxygenQuench * o[index] * r[index]),
        0,
        params.oxygen,
      );
      x2[index] = clamp(
        x[index] + DT * params.propagation * r[index] * (1 - x[index]),
      );

      if (ix === 0 || iz === 0 || ix === GRID_W - 1 || iz === GRID_H - 1) {
        p2[index] = params.initiator;
        o2[index] = params.oxygen;
      }
    }
  }
  swapLensBuffers();
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
        DT *
          (params.piDiffusion * lapP -
            params.piDepletion * source * macroP[index]),
      0,
      params.initiator,
    );
    macroScratchR[index] = clamp(
      macroR[index] +
        DT *
          (params.radicalDiffusion * lapR +
            params.radicalYield * source * macroP[index] -
            radicalLoss),
      0,
      8,
    );
    macroScratchO[index] = clamp(
      macroO[index] +
        DT *
          (params.oxygenDiffusion * lapO +
            params.oxygenDiffusion * 0.012 * (params.oxygen - macroO[index]) -
            0.2 * params.oxygenQuench * macroO[index] * macroR[index]),
      0,
      params.oxygen,
    );
    macroScratchX[index] = clamp(
      macroX[index] +
        DT * params.propagation * macroR[index] * (1 - macroX[index]),
    );
  }

  [macroP, macroScratchP] = [macroScratchP, macroP];
  [macroO, macroScratchO] = [macroScratchO, macroO];
  [macroR, macroScratchR] = [macroScratchR, macroR];
  [macroX, macroScratchX] = [macroScratchX, macroX];
}

function runExposureBatch() {
  const batch = 34;
  for (let step = 0; step < batch && exposureStep < exposureStepsTotal; step += 1) {
    const progress = exposureStep / Math.max(1, exposureStepsTotal - 1);
    stepLens(progress);
    stepMacro(progress);
    exposureStep += 1;
  }

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
  const maxDeveloperDiffusivity = 0.114;
  const stableDt =
    0.45 /
    (maxDeveloperDiffusivity *
      (1 / (DX * DX) + 1 / (DZ * DZ)));
  const substeps = Math.max(1, Math.ceil(dtDevelopment / stableDt));
  const subDt = dtDevelopment / substeps;

  for (
    let step = 0;
    step < batch && developmentStep < developmentStepsTotal;
    step += 1
  ) {
    for (let substep = 0; substep < substeps; substep += 1) {
      for (let iz = 0; iz < GRID_H; iz += 1) {
        for (let ix = 0; ix < GRID_W; ix += 1) {
          const index = iz * GRID_W + ix;
          const gel = Math.pow(
            clamp((x[index] - params.gelPoint) / (1 - params.gelPoint)),
            0.7,
          );
          const diffusivity =
            0.014 + 0.08 * (1 - mass[index]) + 0.02 * Math.exp(-3 * gel);
          const lapDeveloper = laplacian(developer, index, ix, iz);
          developer2[index] = clamp(
            developer[index] + subDt * diffusivity * lapDeveloper,
          );
          mass2[index] = clamp(
            mass[index] -
              subDt *
                params.developerRate *
                Math.exp(-params.developerResistance * gel) *
                developer[index] *
                mass[index],
          );

          if (ix === 0 || iz === 0 || ix === GRID_W - 1 || iz === GRID_H - 1) {
            developer2[index] = 1;
          }
        }
      }
      [developer, developer2] = [developer2, developer];
      [mass, mass2] = [mass2, mass];
    }

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
  timer = setInterval(runExposureBatch, 46);
  emitSnapshot();
}

function startDevelopment() {
  if (macroPositions.length === 0) return;
  stage = "developing";
  stopTimer();
  timer = setInterval(runDevelopmentBatch, 48);
  emitSnapshot();
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function hashState() {
  let hash = 2166136261;
  const parameterValues = Object.values(params);
  for (const value of parameterValues) {
    hash ^= Math.round(value * 1_000_000);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= Math.round(pathLength * 1000);
  hash = Math.imul(hash, 16777619);
  hash ^= linePositions.length;
  hash = Math.imul(hash, 16777619);
  for (let index = 0; index < macroX.length; index += 1) {
    hash ^= Math.round(macroX[index] * 65535);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(macroO[index] * 65535);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(macroMass[index] * 65535);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function emitSnapshot() {
  const lens = new Uint8Array(GRID_N * 4);
  const oxygenScale = Math.max(1e-6, params.oxygen);
  let oxygenMean = 0;
  let conversionMean = 0;
  let radicalMax = 0;
  let gelled = 0;
  let surviving = 0;

  for (let index = 0; index < GRID_N; index += 1) {
    lens[index * 4] = Math.round(clamp(o[index] / oxygenScale) * 255);
    lens[index * 4 + 1] = Math.round(clamp(Math.log1p(r[index]) / Math.log(5)) * 255);
    lens[index * 4 + 2] = Math.round(clamp(x[index]) * 255);
    lens[index * 4 + 3] = Math.round(clamp(mass[index]) * 255);
  }

  const conversion = new Uint8Array(macroX.length);
  const oxygen = new Uint8Array(macroO.length);
  const remaining = new Uint8Array(macroMass.length);
  for (let index = 0; index < macroX.length; index += 1) {
    conversion[index] = Math.round(clamp(macroX[index]) * 255);
    oxygen[index] = Math.round(clamp(macroO[index] / oxygenScale) * 255);
    remaining[index] = Math.round(clamp(macroMass[index]) * 255);
    oxygenMean += macroO[index] / oxygenScale;
    conversionMean += macroX[index];
    radicalMax = Math.max(radicalMax, macroR[index]);
    if (macroX[index] >= params.gelPoint) gelled += 1;
    if (macroMass[index] >= 0.5) surviving += 1;
  }

  const count = Math.max(1, macroX.length);
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
      remaining: remaining.buffer,
      metrics: {
        oxygenMean: oxygenMean / count,
        conversionMean: conversionMean / count,
        radicalMax,
        gelledFraction: gelled / count,
        survivingFraction: surviving / count,
        pulseEnergyPj,
        peakPowerW:
          pulseEnergyPj * 1e-12 / Math.max(1e-15, params.pulseDuration * 1e-15),
        checksum: hashState(),
        cellSizeNm: Math.round(DX * 1000),
        timestepUs: Math.round(DT * 1000),
      },
    },
    [lens.buffer, conversion.buffer, oxygen.buffer, remaining.buffer],
  );
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "slice") {
    stopTimer();
    sliceBenchy(message.params);
    return;
  }
  if (message.type === "configure") {
    stopTimer();
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
  }
};
