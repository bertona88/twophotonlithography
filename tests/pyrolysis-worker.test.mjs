import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/client/", import.meta.url));

async function harness(wasmFailure) {
  const files = await readdir(path.join(root, "assets"));
  const filename = files.find(name => /^pyrolysis\.worker-[\w-]+\.js$/.test(name));
  assert.ok(filename, "production build must contain the Rust-backed carbonization worker");
  const worker = new Worker(new URL("./helpers/production-worker-shim.mjs", import.meta.url), {
    type: "module", workerData: { clientRoot: root, workerPath: path.join(root, "assets", filename), wasmFailure },
  });
  const inbox = [];
  let notify = () => {};
  let failure;
  worker.on("message", message => { inbox.push(message); notify(); });
  worker.on("error", error => { failure = error; notify(); });
  async function wait(predicate) {
    const started = Date.now();
    while (true) {
      if (failure) throw failure;
      const index = inbox.findIndex(predicate);
      if (index >= 0) return inbox.splice(index, 1)[0];
      if (Date.now() - started > 15_000) throw new Error(`Worker timeout: ${JSON.stringify(inbox)}`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 100);
        notify = () => { clearTimeout(timer); resolve(); };
      });
    }
  }
  const send = (message, predicate) => { worker.postMessage(message); return wait(predicate); };
  const snapshot = (id, status) => message => message.type === "snapshot" && message.runId === id && (!status || message.status === status);
  return { worker, wait, send, snapshot };
}

test("carbonization production worker preserves accepted state through pause, replay, cancel and stale commands", async () => {
  const h = await harness();
  try {
    // Exercise a queued command while the actual browser Wasm initializes.
    h.worker.postMessage({ type: "pause", runId: 1 });
    const ready = await h.wait(m => m.type === "ready");
    const config = ready.defaults;
    config.radialCells = 32;
    config.maxStepS = 1;
    config.schedule = [{ timeS: 0, temperatureK: 900 }, { timeS: 100, temperatureK: 900 }];
    config.material.reactionAPerS = 0.02;
    config.material.reactionEJMol = 0;
    config.material.networkAPerS = 0.01;
    config.material.networkEJMol = 0;
    const initial = await h.send({ type: "configure", runId: 1, config }, h.snapshot(1, "ready"));
    assert.equal(initial.diagnostics.volatileFeedback, "none (one-way chemistry to mobile products)");
    const first = await h.send({ type: "step", runId: 1 }, h.snapshot(1, "paused"));
    assert.equal(first.diagnostics.acceptedSteps, 1);
    assert.ok(first.diagnostics.timeS > 0);
    assert.equal(first.fields.byteLength, 32 * 9 * 8);
    const copied = new Float64Array(first.fields).slice();
    const saved = await h.send({ type: "export", runId: 1 }, m => m.type === "checkpoint" && m.runId === 1);
    // JSON round trip exercises the exact user download/import contract.
    const checkpoint = JSON.parse(JSON.stringify(saved.checkpoint));
    const restored = await h.send({ type: "restore", runId: 2, checkpoint }, h.snapshot(2, "ready"));
    assert.equal(restored.diagnostics.checksum, first.diagnostics.checksum);
    h.worker.postMessage({ type: "cancel", runId: 1 });
    const second = await h.send({ type: "step", runId: 2 }, h.snapshot(2, "paused"));
    assert.equal(second.diagnostics.acceptedSteps, 2, "stale cancel must not affect run 2");
    assert.deepEqual(new Float64Array(first.fields), copied, "transferred snapshots must not alias Rust memory");
    await h.send({ type: "restore", runId: 3, checkpoint }, h.snapshot(3, "ready"));
    const replay = await h.send({ type: "step", runId: 3 }, h.snapshot(3, "paused"));
    assert.equal(replay.diagnostics.checksum, second.diagnostics.checksum);
    await h.send({ type: "resume", runId: 3 }, h.snapshot(3, "running"));
    await h.send({ type: "pause", runId: 3 }, h.snapshot(3, "paused"));
    await h.send({ type: "resume", runId: 3 }, h.snapshot(3, "running"));
    const end = await h.wait(h.snapshot(3, "complete"));
    assert.equal(end.diagnostics.timeS, 100);
    assert.ok(Math.abs(end.diagnostics.relativeMassError) < 1e-10);
    const state = new Float64Array(end.fields);
    for (let i = 0; i < 32; i++) {
      assert.ok(Math.abs(state[i * 9 + 1] - Math.exp(-2)) < 1e-12, "Wasm must agree with the native analytic reaction limit");
      assert.ok(Math.abs(state[i * 9 + 2] - 0.25 * (1 - Math.exp(-2))) < 1e-12);
    }
    assert.ok(state[3] > state[31 * 9 + 3]);
    await h.send({ type: "restore", runId: 4, checkpoint }, h.snapshot(4, "ready"));
    const cancelled = await h.send({ type: "cancel", runId: 4 }, h.snapshot(4, "cancelled"));
    assert.equal(cancelled.diagnostics.checksum, restored.diagnostics.checksum);
    const invalid = structuredClone(checkpoint);
    invalid.state.cells[0].precursor = -1;
    const error = await h.send({ type: "restore", runId: 5, checkpoint: invalid }, m => m.type === "error" && m.runId === 5);
    assert.match(error.message, /negative|invalid/);
    const kept = await h.send({ type: "export", runId: 4 }, m => m.type === "checkpoint" && m.runId === 4);
    assert.deepEqual(kept.checkpoint, checkpoint, "invalid restore must retain the prior owner");
  } finally { await h.worker.terminate(); }
});

test("carbonization Wasm reports a domain failure without accepting a singular state", async () => {
  const h = await harness();
  try {
    const { defaults: config } = await h.wait(m => m.type === "ready");
    config.material.charYield = 0;
    config.material.minSolidFraction = 0.9;
    config.material.reactionAPerS = 1;
    config.material.reactionEJMol = 0;
    config.maxStepS = 1; config.minStepS = 1;
    const initial = await h.send({ type: "configure", runId: 1, config }, h.snapshot(1));
    const failed = await h.send({ type: "step", runId: 1 }, h.snapshot(1, "error"));
    assert.equal(failed.diagnostics.checksum, initial.diagnostics.checksum);
    assert.equal(failed.diagnostics.timeS, 0);
    assert.equal(failed.diagnostics.failure.code, "material-state-out-of-domain");
    assert.equal(failed.diagnostics.failure.quantity, "retained-solid-fraction");
  } finally { await h.worker.terminate(); }
});

test("carbonization initialization failure is visible and rejects queued work", async () => {
  const h = await harness("invalid");
  try {
    h.worker.postMessage({ type: "step", runId: 99 });
    const error = await h.wait(m => m.type === "error" && m.runId === 99);
    assert.ok(error.message.length > 0);
  } finally { await h.worker.terminate(); }
});

test("the benchmark route declares its physical limits in rendered HTML", async () => {
  // Inspect the actual server-rendered route, not source-text patterns.
  const { default: app } = await import(new URL("../dist/server/index.js", import.meta.url));
  const response = await app.fetch(new Request("http://localhost/carbonization"), { ASSETS: { fetch: async () => new Response("", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Inside the transforming strut/);
  assert.match(html, /not an sp² percentage/);
  assert.match(html, /deformation, stress and furnace pressure are not solved/);
  assert.match(html, /radial-reference|carbonization-lab/);
  // Check that both the application bundle and the Wasm asset are emitted.
  const files = await readdir(path.join(root, "assets"));
  const wasm = files.find(name => /^reaction_lens_bg-.*\.wasm$/.test(name));
  assert.ok(wasm);
  const bytes = await readFile(path.join(root, "assets", wasm));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 97, 115, 109]);
});
