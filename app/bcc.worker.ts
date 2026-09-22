import init, { bcc_defaults, BccSimulation } from "./wasm/reaction_lens/reaction_lens.js";
import wasmUrl from "./wasm/reaction_lens/reaction_lens_bg.wasm?url";
import { BCC_FIELDS, type BccCommand, type BccConfig, type BccMessage, type BccSnapshot, type BccStatus } from "./bcc-types";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BccCommand>) => void) | null;
  postMessage(message: BccMessage): void;
};
let core: BccSimulation | null = null;
let config: BccConfig;
let runId = 0;
let sequence = 0;
let status: BccStatus = "ready";
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPublished = 0;
let lastPublishedAcceptedSteps = -1;
let singleStepTarget: number | null = null;
let ready = false;
let initializationError: string | null = null;
const pending: BccCommand[] = [];
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const post = (message: BccMessage) => scope.postMessage(message);
function stop() { if (timer !== null) clearTimeout(timer); timer = null; }

function checkedSnapshot(simulation: BccSimulation): BccSnapshot {
  const snapshot = simulation.get_snapshot() as BccSnapshot;
  const d = snapshot.diagnostics;
  if (!d || d.modelVersion !== "bcc-tet-v1" || !Number.isSafeInteger(d.nodes) ||
      d.nodes < 1 || d.nodes > 100_000 || !Number.isSafeInteger(d.elements) ||
      d.elements < 1 || d.elements > 500_000 || !Number.isSafeInteger(d.surfaceTriangles) ||
      d.surfaceTriangles < 1 || d.surfaceTriangles > 1_000_000) {
    throw new Error("Invalid Rust BCC snapshot dimensions");
  }
  const finite = (values: unknown, length: number): values is number[] =>
    Array.isArray(values) && values.length === length && values.every(v => typeof v === "number" && Number.isFinite(v));
  if (!finite(snapshot.positionsUm, d.nodes * 3) || !finite(snapshot.referencePositionsUm, d.nodes * 3) ||
      !finite(snapshot.cellCentersUm, d.elements * 3) ||
      !finite(snapshot.tetrahedra, d.elements * 4) ||
      !finite(snapshot.triangles, d.surfaceTriangles * 3) || !finite(snapshot.triangleCells, d.surfaceTriangles) ||
      !snapshot.triangles.every(i => Number.isSafeInteger(i) && i >= 0 && i < d.nodes) ||
      !snapshot.tetrahedra.every(i => Number.isSafeInteger(i) && i >= 0 && i < d.nodes) ||
      !snapshot.triangleCells.every(i => Number.isSafeInteger(i) && i >= 0 && i < d.elements) ||
      BCC_FIELDS.some(field => !finite(snapshot.cellFields?.[field], d.elements))) {
    throw new Error("Invalid Rust BCC geometry or material fields");
  }
  if (![d.timeS, d.durationS, d.initialMassKg, d.relativeMassError, d.minJacobian,
        d.mechanicalResidual, ...d.dimensionsUm].every(Number.isFinite) || d.minJacobian <= 0) {
    throw new Error("Invalid Rust BCC diagnostics");
  }
  return snapshot;
}

function publish(snapshot = core ? checkedSnapshot(core) : null) {
  if (!snapshot) return;
  if (snapshot.diagnostics.failure) { status = "error"; stop(); }
  else if (snapshot.diagnostics.complete) { status = "complete"; stop(); }
  // serde owns these arrays independently of Rust; postMessage copies them once
  // more, so later accepted steps cannot modify a displayed or pinned snapshot.
  post({ type: "snapshot", runId, sequence: ++sequence, status, snapshot, config });
  lastPublished = performance.now();
  lastPublishedAcceptedSteps = snapshot.diagnostics.acceptedSteps;
}

function tick() {
  timer = null;
  if (status !== "running" || !core) return;
  try {
    // Yield to pause/cancel between every bounded Rust call. Rendering is on the
    // main thread and never changes the numerical integration cadence.
    const advanced = core.advance();
    const acceptedSteps = core.accepted_steps();
    const stepped = singleStepTarget !== null && acceptedSteps >= singleStepTarget;
    if (stepped) { status = "paused"; singleStepTarget = null; }
    if (!advanced || stepped || (acceptedSteps !== lastPublishedAcceptedSteps && performance.now() - lastPublished >= 100)) publish();
    if (status === "running") timer = setTimeout(tick, 0);
  } catch (error) {
    stop(); status = "error";
    post({ type: "error", runId, message: text(error) });
  }
}

function process(message: BccCommand) {
  try {
    if (!Number.isSafeInteger(message.runId) || message.runId < 1) throw new Error("Invalid BCC run ID");
    if (message.type === "configure" || message.type === "restore") {
      if (message.runId <= runId) return;
      const replacement = message.type === "configure" ? new BccSimulation(message.config) : BccSimulation.restore(message.checkpoint);
      let snapshot: BccSnapshot;
      let replacementConfig: BccConfig;
      try {
        snapshot = checkedSnapshot(replacement);
        replacementConfig = (replacement.export_checkpoint() as { config: BccConfig }).config;
      } catch (error) { replacement.free(); throw error; }
      // Replace only after all validation succeeded; a malformed restore must
      // leave the previous simulation, schedule and accepted owner intact.
      stop(); core?.free(); core = replacement;
      singleStepTarget = null;
      config = replacementConfig; runId = message.runId; sequence = 0; status = "ready";
      publish(snapshot);
      return;
    }
    if (message.runId !== runId) return;
    if (!core) throw new Error("Configure a BCC specimen first");
    if (message.type === "export") { post({ type: "checkpoint", runId, checkpoint: core.export_checkpoint() }); return; }
    if (message.type === "pause") { stop(); singleStepTarget = null; if (status === "running") status = "paused"; publish(); return; }
    if (message.type === "cancel") { stop(); singleStepTarget = null; status = "cancelled"; publish(); return; }
    if (message.type === "start" || message.type === "resume") {
      if (status !== "ready" && status !== "paused") return;
      singleStepTarget = null;
      status = "running"; publish();
      if (status === "running" && timer === null) timer = setTimeout(tick, 0);
      return;
    }
    if (message.type === "step") {
      if (status !== "ready" && status !== "paused") return;
      singleStepTarget = core.accepted_steps() + 1;
      status = "running"; publish();
      if (status === "running" && timer === null) timer = setTimeout(tick, 0);
      return;
    }
    throw new Error("Unsupported BCC command");
  } catch (error) { post({ type: "error", runId: message.runId, message: text(error) }); }
}

scope.onmessage = ({ data }) => {
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    post({ type: "error", runId, message: "Invalid BCC command" }); return;
  }
  if (initializationError) { post({ type: "error", runId: data.runId, message: initializationError }); return; }
  if (ready) process(data);
  else if (pending.length < 16) pending.push(data);
  else post({ type: "error", runId: data.runId, message: "BCC initialization queue is full" });
};

void init({ module_or_path: wasmUrl }).then(() => {
  ready = true;
  post({ type: "ready", defaults: bcc_defaults() as BccConfig });
  pending.splice(0).forEach(process);
}).catch((error: unknown) => {
  initializationError = text(error);
  post({ type: "error", runId: 0, message: initializationError });
  for (const message of pending.splice(0)) post({ type: "error", runId: message.runId, message: initializationError });
});
