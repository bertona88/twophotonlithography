import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

const GRID_WIDTH = 112;
const GRID_HEIGHT = 68;
const FIELD_COUNT = 6;

function initializeInWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./helpers/wasm-init.worker.cjs", import.meta.url),
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Timed out while initializing Rust/Wasm in a worker"));
    }, 15_000);

    worker.once("message", (message) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(message);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test("Rust/Wasm initializes and replays deterministically off the main thread", async () => {
  const result = await initializeInWorker();

  assert.equal(result.error, undefined);
  assert.equal(result.isMainThread, false);
  assert.equal(result.initial.solver, "Rust/Wasm");
  assert.equal(result.initial.gridWidth, GRID_WIDTH);
  assert.equal(result.initial.gridHeight, GRID_HEIGHT);
  assert.equal(result.initial.fieldCount, FIELD_COUNT);
  assert.deepEqual(result.initial.fieldOrder, [
    "photoinitiator",
    "oxygen",
    "radicalActivity",
    "conversion",
    "developer",
    "remainingMass",
  ]);
  assert.equal(result.initial.timestepModelTime, 0.016);
  assert.equal(
    result.snapshotLength,
    GRID_WIDTH * GRID_HEIGHT * FIELD_COUNT,
  );
  assert.equal(result.advanced, 34);
  assert.equal(result.replayChecksum, result.replayChecksumAfterReset);
  assert.equal(result.rejectedInvalidParameters, true);
});
