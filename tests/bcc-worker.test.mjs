import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/client/", import.meta.url));

async function harness(wasmFailure) {
  const files = await readdir(path.join(root, "assets"));
  const filename = files.find(name => /^bcc\.worker-[\w-]+\.js$/.test(name));
  assert.ok(filename, "production build must include the authoritative BCC worker");
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
      if (Date.now() - started > 60_000) throw new Error(`BCC worker timeout; inbox ${inbox.map(m => `${m.type}:${m.status ?? m.message ?? ""}`).join(", ")}`);
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

function shortConfig(defaults, support = "free") {
  const config = structuredClone(defaults);
  config.cellsPerAxis = 1;
  config.voxelsPerCell = 10;
  config.support = support;
  config.maxStepS = 0.5;
  config.schedule = [{ timeS: 0, temperatureK: 900 }, { timeS: 2, temperatureK: 900 }];
  config.material.reactionAPerS = 0.02;
  config.material.reactionEJMol = 0;
  config.material.networkAPerS = 0.01;
  config.material.networkEJMol = 0;
  return config;
}

test("BCC production worker owns 3D state and preserves replay, cancellation, and invalid-replacement isolation", { timeout: 180_000 }, async () => {
  const h = await harness();
  try {
    const { defaults } = await h.wait(m => m.type === "ready");
    const config = shortConfig(defaults);
    const initial = await h.send({ type: "configure", runId: 1, config }, h.snapshot(1, "ready"));
    assert.ok(initial.snapshot.diagnostics.elements > 100);
    assert.equal(initial.snapshot.positionsUm.length, initial.snapshot.diagnostics.nodes * 3);
    assert.equal(initial.snapshot.triangles.length, initial.snapshot.diagnostics.surfaceTriangles * 3);
    const first = await h.send({ type: "step", runId: 1 }, h.snapshot(1, "paused"));
    assert.ok(first.snapshot.diagnostics.timeS > 0);
    assert.equal(first.snapshot.diagnostics.acceptedSteps, 1);
    const immutable = structuredClone(first.snapshot);
    const saved = await h.send({ type: "export", runId: 1 }, m => m.type === "checkpoint" && m.runId === 1);
    const checkpoint = JSON.parse(JSON.stringify(saved.checkpoint));
    const restored = await h.send({ type: "restore", runId: 2, checkpoint }, h.snapshot(2, "ready"));
    assert.equal(restored.snapshot.diagnostics.checksum, first.snapshot.diagnostics.checksum);
    h.worker.postMessage({ type: "cancel", runId: 1 });
    const second = await h.send({ type: "step", runId: 2 }, h.snapshot(2, "paused"));
    await h.send({ type: "restore", runId: 3, checkpoint }, h.snapshot(3, "ready"));
    const replay = await h.send({ type: "step", runId: 3 }, h.snapshot(3, "paused"));
    assert.equal(replay.snapshot.diagnostics.checksum, second.snapshot.diagnostics.checksum);
    assert.deepEqual(first.snapshot, immutable, "snapshots cannot alias mutable numerical state");
    await h.send({ type: "resume", runId: 3 }, h.snapshot(3, "running"));
    await h.send({ type: "pause", runId: 3 }, h.snapshot(3, "paused"));
    await h.send({ type: "resume", runId: 3 }, h.snapshot(3, "running"));
    const end = await h.wait(h.snapshot(3, "complete"));
    const d = end.snapshot.diagnostics;
    assert.equal(d.timeS, 2);
    assert.ok(Math.abs(d.relativeMassError) < 1e-9);
    assert.ok(d.minJacobian > 0);
    const precursor = Math.exp(-0.04);
    for (const value of end.snapshot.cellFields.precursor) assert.ok(Math.abs(value - precursor) < 1e-8);
    assert.ok(d.dimensionsUm[2] < d.referenceDimensionsUm[2], "free specimen physically contracts");
    await h.send({ type: "restore", runId: 4, checkpoint }, h.snapshot(4, "ready"));
    const cancelled = await h.send({ type: "cancel", runId: 4 }, h.snapshot(4, "cancelled"));
    assert.equal(cancelled.snapshot.diagnostics.checksum, restored.snapshot.diagnostics.checksum);
    const invalid = structuredClone(config);
    invalid.pitchM = -1;
    await h.send({ type: "configure", runId: 5, config: invalid }, m => m.type === "error" && m.runId === 5);
    await h.send({ type: "restore", runId: 6, checkpoint: { invalid: true } }, m => m.type === "error" && m.runId === 6);
    const kept = await h.send({ type: "export", runId: 4 }, m => m.type === "checkpoint" && m.runId === 4);
    assert.deepEqual(kept.checkpoint, checkpoint);
  } finally { await h.worker.terminate(); }
});

test("BCC bonded footprint stays attached while the authoritative upper mesh deforms", { timeout: 180_000 }, async () => {
  const h = await harness();
  try {
    const { defaults } = await h.wait(m => m.type === "ready");
    const config = shortConfig(defaults, "bonded");
    await h.send({ type: "configure", runId: 1, config }, h.snapshot(1, "ready"));
    await h.send({ type: "start", runId: 1 }, h.snapshot(1, "running"));
    const { snapshot: s } = await h.wait(h.snapshot(1, "complete"));
    let fixed = 0;
    let displaced = 0;
    for (let i = 0; i < s.positionsUm.length; i += 3) {
      if (Math.abs(s.referencePositionsUm[i + 2]) < 1e-10) {
        assert.deepEqual(s.positionsUm.slice(i, i + 3), s.referencePositionsUm.slice(i, i + 3));
        fixed++;
      } else if (Math.hypot(...s.positionsUm.slice(i, i + 3).map((v, j) => v - s.referencePositionsUm[i + j])) > 1e-5) displaced++;
    }
    assert.ok(fixed > 3, "bond must cover finite contact patches");
    assert.ok(displaced > 0, "non-contact geometry must deform");
    assert.ok(s.diagnostics.maxStressMPa > 0);
    assert.ok(Math.abs(s.diagnostics.relativeMassError) < 1e-9);
    assert.ok(s.diagnostics.minJacobian > 0);
  } finally { await h.worker.terminate(); }
});

test("BCC startup failure is surfaced for queued commands", async () => {
  const h = await harness("invalid");
  try {
    h.worker.postMessage({ type: "step", runId: 99 });
    const error = await h.wait(m => m.type === "error" && m.runId === 99);
    assert.ok(error.message.length > 0);
  } finally { await h.worker.terminate(); }
});

test("the BCC benchmark is the canonical carbonization route and exposes its model limits", async () => {
  const { default: app } = await import(new URL("../dist/server/index.js", import.meta.url));
  const response = await app.fetch(new Request("http://localhost/carbonization"), {
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /BCC foam on a substrate/);
  assert.match(html, /https:\/\/twophotonlithography\.com\/carbonization/);
  assert.match(html, /rigid, nonshrinking substrate/);
  assert.match(html, /material is uncalibrated/);
  assert.match(html, /\/carbonization\/strut/);
});
