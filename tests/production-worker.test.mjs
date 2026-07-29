import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const GRID_WIDTH = 112;
const GRID_HEIGHT = 68;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIR, "..");
const CLIENT_ROOT = path.join(REPOSITORY_ROOT, "dist", "client");

const parameters = {
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

async function productionWorkerPath() {
  const manifest = JSON.parse(
    await readFile(path.join(CLIENT_ROOT, ".vite", "manifest.json"), "utf8"),
  );
  const pageChunk = await readFile(
    path.join(CLIENT_ROOT, manifest["app/page.tsx"].file),
    "utf8",
  );
  const match = pageChunk.match(/simulation\.worker-[\w-]+\.js/);

  assert.ok(match, "the production page must reference a worker bundle");
  return path.join(CLIENT_ROOT, "assets", match[0]);
}

function waitForMessage(worker, predicate, description) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description}`));
    }, 15_000);

    function cleanup() {
      clearTimeout(timeout);
      worker.off("message", onMessage);
      worker.off("error", onError);
    }

    function onMessage(message) {
      if (predicate(message)) {
        cleanup();
        resolve(message);
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

test("production worker initializes browser Wasm and honors its message contract", async () => {
  const workerPath = await productionWorkerPath();
  const worker = new Worker(
    new URL("./helpers/production-worker-shim.mjs", import.meta.url),
    {
      type: "module",
      workerData: { clientRoot: CLIENT_ROOT, workerPath },
    },
  );

  try {
    const initializing = await waitForMessage(
      worker,
      (message) =>
        message.type === "solverStatus" && message.status === "initializing",
      "the initializing solver status",
    );
    assert.equal(initializing.solver, "Rust/Wasm");

    // Submit work before Wasm is ready to exercise the production queue.
    worker.postMessage({ type: "slice", params: parameters });

    const ready = await waitForMessage(
      worker,
      (message) =>
        message.type === "solverStatus" && message.status === "ready",
      "the ready solver status",
    );
    assert.equal(ready.solver, "Rust/Wasm");
    assert.equal(ready.diagnostics.gridWidth, GRID_WIDTH);
    assert.equal(ready.diagnostics.gridHeight, GRID_HEIGHT);
    assert.equal(ready.diagnostics.timestepModel, 0.016);
    assert.ok(ready.diagnostics.wasmMemoryBytes > 0);

    const sliceResult = await waitForMessage(
      worker,
      (message) => message.type === "sliceResult",
      "a queued slice result",
    );
    assert.ok(sliceResult.lines instanceof ArrayBuffer);
    assert.ok(sliceResult.nodes instanceof ArrayBuffer);
    assert.ok(sliceResult.layerCount > 0);

    const snapshot = await waitForMessage(
      worker,
      (message) => message.type === "snapshot",
      "a Rust-backed snapshot",
    );
    assert.equal(snapshot.lensWidth, GRID_WIDTH);
    assert.equal(snapshot.lensHeight, GRID_HEIGHT);
    assert.equal(snapshot.lens.byteLength, CELL_COUNT * 4);
    assert.equal(snapshot.diagnostics.solver, "Rust/Wasm");
    assert.equal(snapshot.diagnostics.fieldCount, 6);
    assert.deepEqual(snapshot.diagnostics.fieldOrder, [
      "photoinitiator",
      "oxygen",
      "radicalActivity",
      "conversion",
      "developer",
      "remainingMass",
    ]);

    worker.postMessage({
      type: "slice",
      params: { ...parameters, hatchSpacing: Number.MIN_VALUE },
    });
    const commandError = await waitForMessage(
      worker,
      (message) =>
        message.type === "commandError" && message.command === "slice",
      "a validation error for unsafe hatch spacing",
    );
    assert.match(commandError.message, /hatchSpacing/i);
  } finally {
    await worker.terminate();
  }
});
