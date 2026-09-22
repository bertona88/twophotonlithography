import init, { pyrolysis_defaults, PyrolysisSimulation } from "./wasm/reaction_lens/reaction_lens.js";
import wasmUrl from "./wasm/reaction_lens/reaction_lens_bg.wasm?url";
import { PYROLYSIS_FIELDS, type PyrolysisCommand, type PyrolysisConfig, type PyrolysisDiagnostics, type PyrolysisMessage, type PyrolysisStatus } from "./pyrolysis-types";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PyrolysisCommand>) => void) | null;
  postMessage(message: PyrolysisMessage, transfer?: Transferable[]): void;
};
let memory: WebAssembly.Memory;
let core: PyrolysisSimulation | null = null;
let config: PyrolysisConfig;
let runId = 0;
let sequence = 0;
let status: PyrolysisStatus = "ready";
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPublished = 0;
let ready = false;
let initializationError: string | null = null;
const pending: PyrolysisCommand[] = [];

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function stop() { if (timer !== null) clearTimeout(timer); timer = null; }
function post(message: PyrolysisMessage, transfer: Transferable[] = []) { scope.postMessage(message, transfer); }

function publish() {
  if (!core) return;
  const diagnostics = core.get_diagnostics() as PyrolysisDiagnostics;
  if (diagnostics.failure) { status = "error"; stop(); }
  else if (diagnostics.complete) { status = "complete"; stop(); }
  const ptr = core.get_snapshot();
  const length = core.snapshot_len();
  if (diagnostics.schemaVersion !== 2 || diagnostics.fieldOrder !== PYROLYSIS_FIELDS.join(",") ||
      length !== diagnostics.radialCells * PYROLYSIS_FIELDS.length ||
      !Number.isSafeInteger(ptr) || ptr < 0 || ptr % 8 !== 0 || ptr + length * 8 > memory.buffer.byteLength) {
    throw new Error("Invalid Rust radial snapshot contract");
  }
  const fields = new Float64Array(memory.buffer, ptr, length).slice();
  if (!fields.every(Number.isFinite)) throw new Error("Nonfinite Rust radial snapshot");
  post({ type: "snapshot", runId, sequence: ++sequence, status, fields: fields.buffer, diagnostics, config }, [fields.buffer]);
  lastPublished = performance.now();
}

function tick() {
  timer = null;
  if (status !== "running" || !core) return;
  try {
    const started = performance.now();
    for (let i = 0; i < 8 && performance.now() - started < 12; i++) {
      if (!core.advance()) { publish(); return; }
    }
    if (performance.now() - lastPublished >= 100) publish();
    if (status === "running") timer = setTimeout(tick, 0);
  } catch (error) {
    stop(); status = "error";
    post({ type: "error", runId, message: errorText(error) });
  }
}

function process(message: PyrolysisCommand) {
  try {
    if (!Number.isSafeInteger(message.runId) || message.runId < 1) throw new Error("Invalid run ID");
    if (message.type === "configure" || message.type === "restore") {
      if (message.runId <= runId) return;
      // Validate a replacement before discarding the previous accepted run.
      const replacement = message.type === "configure" ? new PyrolysisSimulation(message.config) : PyrolysisSimulation.restore(message.checkpoint);
      const checkpoint = replacement.export_checkpoint() as { config: PyrolysisConfig };
      stop(); core?.free(); core = replacement;
      config = checkpoint.config; runId = message.runId; sequence = 0; status = "ready";
      publish();
      return;
    }
    if (message.runId !== runId) return; // Late commands cannot affect a new run.
    if (!core) throw new Error("Configure a run first");
    if (message.type === "export") {
      post({ type: "checkpoint", runId, checkpoint: core.export_checkpoint() }); return;
    }
    if (message.type === "pause") { stop(); if (status === "running") status = "paused"; publish(); return; }
    if (message.type === "cancel") { stop(); status = "cancelled"; publish(); return; }
    if (message.type === "start" || message.type === "resume") {
      if (status !== "ready" && status !== "paused") return;
      status = "running"; publish(); if (status === "running" && timer === null) timer = setTimeout(tick, 0); return;
    }
    if (message.type === "step") {
      if (status !== "ready" && status !== "paused") return;
      core.advance(); status = "paused"; publish(); return;
    }
    throw new Error("Unsupported carbonization command");
  } catch (error) { post({ type: "error", runId: message.runId, message: errorText(error) }); }
}

scope.onmessage = ({ data }) => {
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    post({ type: "error", runId, message: "Invalid carbonization command" }); return;
  }
  if (initializationError) { post({ type: "error", runId: data.runId, message: initializationError }); return; }
  if (ready) process(data);
  else if (pending.length < 16) pending.push(data);
  else post({ type: "error", runId: data.runId, message: "Carbonization initialization queue is full" });
};

void init({ module_or_path: wasmUrl }).then((wasm) => {
  memory = wasm.memory;
  ready = true;
  post({ type: "ready", defaults: pyrolysis_defaults() as PyrolysisConfig });
  pending.splice(0).forEach(process);
}).catch((error: unknown) => {
  initializationError = errorText(error);
  post({ type: "error", runId: 0, message: initializationError });
  for (const message of pending.splice(0)) post({ type: "error", runId: message.runId, message: initializationError });
});
