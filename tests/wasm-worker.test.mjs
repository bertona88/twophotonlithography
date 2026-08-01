import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

const VOLUME_FIELD_COUNT = 7;
const SLICE_FIELD_COUNT = 5;

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
  assert.equal(result.initial.solver, "Rust/Wasm 3D volume");
  assert.ok(result.initial.gridWidth > 0);
  assert.ok(result.initial.gridHeight > 0);
  assert.ok(result.initial.gridDepth > 0);
  assert.equal(
    result.snapshotLength,
    result.initial.renderVoxels * VOLUME_FIELD_COUNT,
  );
  assert.equal(result.sliceWidth, result.initial.gridWidth);
  assert.equal(result.sliceHeight, result.initial.gridHeight);
  assert.equal(
    result.sliceLength,
    result.sliceWidth * result.sliceHeight * SLICE_FIELD_COUNT,
  );
  assert.equal(result.advanced, 34);
  assert.equal(result.replayChecksum, result.replayChecksumAfterReset);
  assert.equal(result.psfPreview.na, 1.4);
  assert.equal(result.psfPreview.wavelengthNm, 780);
  assert.ok(result.psfPreview.coneHalfAngleRad > 1);
  assert.ok(result.psfPreview.fwhmRadiiUm.every((radius) => radius > 0));
  assert.equal(result.rejectedInvalidParameters, true);
});
