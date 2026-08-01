import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const SLICE_FIELD_COUNT = 5;
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

function postAndWait(worker, message, predicate, description) {
  const response = waitForMessage(worker, predicate, description);
  worker.postMessage(message);
  return response;
}

test("production worker initializes browser Wasm and honors its message contract", async (t) => {
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
    assert.ok(ready.wasmMemoryBytes > 0);

    const sliceResult = await waitForMessage(
      worker,
      (message) => message.type === "sliceResult",
      "a queued slice result",
    );
    assert.ok(sliceResult.pathPositions instanceof ArrayBuffer);
    assert.ok(sliceResult.renderPositions instanceof ArrayBuffer);
    assert.ok(sliceResult.layerPositions instanceof ArrayBuffer);
    const pathPositions = new Float32Array(sliceResult.pathPositions);
    const renderPositions = new Float32Array(sliceResult.renderPositions);
    const layerPositions = new Float32Array(sliceResult.layerPositions);
    assert.ok(pathPositions.length > 0);
    assert.equal(pathPositions.length % 6, 0);
    assert.ok(renderPositions.length > 0);
    assert.equal(renderPositions.length % 3, 0);
    const renderedZ = [];
    for (let index = 2; index < renderPositions.length; index += 3) {
      renderedZ.push(renderPositions[index]);
    }
    assert.ok(Math.max(...renderedZ) > 17);
    assert.ok(
      renderedZ.filter((value) => value > 14).length > 100,
      "render sampling must preserve sparse cabin and chimney voxels",
    );
    assert.equal(sliceResult.layerCount, layerPositions.length);
    assert.equal(sliceResult.passes, parameters.passes);
    assert.ok(layerPositions.length > 0);
    assert.ok(layerPositions.at(-1) > 17);
    assert.ok(sliceResult.pathLengthUm > 0);
    assert.ok(sliceResult.estimatedExposureSeconds > 0);

    const snapshot = await waitForMessage(
      worker,
      (message) => message.type === "snapshot",
      "a Rust-backed snapshot",
    );
    assert.equal(snapshot.sliceWidth, snapshot.volumeDiagnostics.gridWidth);
    assert.equal(snapshot.sliceHeight, snapshot.volumeDiagnostics.gridHeight);
    assert.equal(
      snapshot.slicePixels.byteLength,
      snapshot.sliceWidth * snapshot.sliceHeight * SLICE_FIELD_COUNT,
    );
    assert.ok(snapshot.volumeDiagnostics.gridDepth > 0);
    assert.equal(
      snapshot.volumeDiagnostics.layerCount,
      sliceResult.layerCount,
    );
    assert.equal(
      snapshot.volumeDiagnostics.pathLengthUm,
      sliceResult.pathLengthUm,
    );
    assert.deepEqual(snapshot.volumeMetrics, snapshot.metrics);
    for (const field of [
      "oxygenMean",
      "radicalMax",
      "conversionMean",
      "gelledFraction",
      "survivingFraction",
    ]) {
      assert.equal(snapshot.metrics[field], snapshot.volumeDiagnostics[field]);
    }
    assert.deepEqual(snapshot.sliceMetrics.voxelPitchNm, [
      Math.round(snapshot.volumeDiagnostics.voxelPitchUm[0] * 1000),
      Math.round(snapshot.volumeDiagnostics.voxelPitchUm[1] * 1000),
    ]);
    assert.ok(Math.abs(snapshot.metrics.pulseEnergyPj - 200) < 1e-9);
    assert.ok(Math.abs(snapshot.metrics.peakPowerW - 2000) < 1e-9);
    assert.ok(snapshot.volumeDiagnostics.ownedMemoryBytes > 0);
    assert.ok(snapshot.wasmMemoryBytes > snapshot.volumeDiagnostics.ownedMemoryBytes);

    const inspected = await postAndWait(
      worker,
      { type: "inspectSlice", zUm: layerPositions.at(-1) },
      (message) => message.type === "sliceInspection",
      "an authoritative layer inspection",
    );
    assert.equal(inspected.sliceWidth, snapshot.volumeDiagnostics.gridWidth);
    assert.equal(inspected.sliceHeight, snapshot.volumeDiagnostics.gridHeight);
    assert.ok(inspected.sliceZUm > 17);
    assert.equal(inspected.volumeChecksum, snapshot.volumeDiagnostics.checksum);

    const lowerNaPreview = await postAndWait(
      worker,
      {
        type: "previewOptics",
        requestId: 1,
        na: 0.7,
        wavelength: parameters.wavelength,
      },
      (message) =>
        message.type === "opticsPreview" && message.requestId === 1,
      "a lower-NA live optics preview",
    );
    const higherNaPreview = await postAndWait(
      worker,
      {
        type: "previewOptics",
        requestId: 2,
        na: 1.4,
        wavelength: parameters.wavelength,
      },
      (message) =>
        message.type === "opticsPreview" && message.requestId === 2,
      "a higher-NA live optics preview",
    );
    assert.ok(
      higherNaPreview.preview.coneHalfAngleRad >
        lowerNaPreview.preview.coneHalfAngleRad,
    );
    assert.ok(
      higherNaPreview.preview.fwhmRadiiUm[0] <
        lowerNaPreview.preview.fwhmRadiiUm[0],
    );
    assert.ok(
      higherNaPreview.preview.fwhmRadiiUm[2] <
        lowerNaPreview.preview.fwhmRadiiUm[2],
    );
    assert.deepEqual(
      higherNaPreview.preview,
      snapshot.volumeDiagnostics.psfPreview,
    );

    for (const [patch, pattern] of [
      [{ hatchSpacing: Number.MIN_VALUE }, /hatchSpacing/i],
      [{ layerHeight: 0.24 }, /layerHeight/i],
      [{ contourCount: 1.5 }, /contourCount/i],
    ]) {
      const commandError = await postAndWait(
        worker,
        { type: "slice", params: { ...parameters, ...patch } },
        (message) =>
          message.type === "commandError" && message.command === "slice",
        `a validation error matching ${pattern}`,
      );
      assert.match(commandError.message, pattern);
      assert.equal(commandError.stage, "ready");
    }

    const configuredSlicePromise = waitForMessage(
      worker,
      (message) =>
        message.type === "sliceResult" &&
        message.sequence > sliceResult.sequence,
      "a configure-triggered toolpath refresh",
    );
    const configuredSnapshotPromise = waitForMessage(
      worker,
      (message) =>
        message.type === "snapshot" && message.sequence > snapshot.sequence,
      "the snapshot following a configure-triggered refresh",
    );
    worker.postMessage({
      type: "configure",
      params: { ...parameters, layerHeight: 0.8, speed: 60 },
    });
    const [configuredSlice, configuredSnapshot] = await Promise.all([
      configuredSlicePromise,
      configuredSnapshotPromise,
    ]);
    assert.ok(new Float32Array(configuredSlice.pathPositions).length > 0);
    assert.equal(
      configuredSlice.layerCount,
      new Float32Array(configuredSlice.layerPositions).length,
    );
    assert.notEqual(
      configuredSlice.layerCount,
      sliceResult.layerCount,
      "a changed layer height must refresh the authoritative layers",
    );
    assert.notEqual(
      configuredSlice.estimatedExposureSeconds,
      sliceResult.estimatedExposureSeconds,
      "a changed speed must refresh the authoritative exposure estimate",
    );

    let exposureActiveMilliseconds = 0;
    let exposureSegmentStartedAt = performance.now();
    const exposing = await postAndWait(
      worker,
      { type: "start" },
      (message) => message.type === "snapshot" && message.stage === "exposing",
      "the exposure start snapshot",
    );
    assert.equal(exposing.exposureProgress, 0);

    const advanced = await waitForMessage(
      worker,
      (message) =>
        message.type === "snapshot" &&
        message.stage === "exposing" &&
        message.exposureProgress > 0,
      "an advanced exposure snapshot",
    );
    assert.ok(advanced.volumeDiagnostics.exposureStep > 0);

    const paused = await postAndWait(
      worker,
      { type: "pause" },
      (message) => message.type === "snapshot" && message.stage === "paused",
      "the paused exposure snapshot",
    );
    exposureActiveMilliseconds += performance.now() - exposureSegmentStartedAt;
    assert.ok(paused.exposureProgress > 0 && paused.exposureProgress < 1);

    exposureSegmentStartedAt = performance.now();
    const resumed = await postAndWait(
      worker,
      { type: "resume" },
      (message) => message.type === "snapshot" && message.stage === "exposing",
      "the resumed exposure snapshot",
    );
    assert.equal(resumed.exposureProgress, paused.exposureProgress);

    const exposureComplete = await waitForMessage(
      worker,
      (message) =>
        message.type === "snapshot" &&
        message.stage === "paused" &&
        message.exposureProgress === 1,
      "exposure completion",
    );
    exposureActiveMilliseconds += performance.now() - exposureSegmentStartedAt;
    t.diagnostic(
      `full-volume exposure active wall time ${exposureActiveMilliseconds.toFixed(0)} ms`,
    );
    assert.ok(
      exposureActiveMilliseconds < 10_000,
      "the time-sliced production exposure must complete within its worker budget",
    );
    assert.equal(
      exposureComplete.volumeDiagnostics.exposureStep,
      exposureComplete.volumeDiagnostics.exposureStepsTotal,
    );
    assert.ok(exposureComplete.volumeDiagnostics.offTargetActiveVoxels > 0);
    assert.ok(exposureComplete.volumeDiagnostics.offTargetConversionMean > 0);
    assert.equal(
      exposureComplete.metrics.offTargetGelledFraction,
      exposureComplete.volumeDiagnostics.offTargetGelledFraction,
    );
    const completedSlice = new Uint8Array(exposureComplete.slicePixels);
    let encodedSliceOxygenMean = 0;
    let encodedSliceConversionMean = 0;
    let targetCells = 0;
    for (
      let index = 0;
      index < exposureComplete.sliceWidth * exposureComplete.sliceHeight;
      index += 1
    ) {
      const source = index * SLICE_FIELD_COUNT;
      if (completedSlice[source + 4] === 0) continue;
      targetCells += 1;
      encodedSliceOxygenMean += completedSlice[source] / 255;
      encodedSliceConversionMean += completedSlice[source + 2] / 255;
    }
    encodedSliceOxygenMean /= Math.max(1, targetCells);
    encodedSliceConversionMean /= Math.max(1, targetCells);
    assert.equal(exposureComplete.sliceMetrics.targetCells, targetCells);
    assert.ok(
      Math.abs(
        exposureComplete.sliceMetrics.oxygenMean - encodedSliceOxygenMean,
      ) <= 1 / 255,
    );
    assert.ok(
      Math.abs(
        exposureComplete.sliceMetrics.conversionMean -
          encodedSliceConversionMean,
      ) <= 1 / 255,
    );

    await postAndWait(
      worker,
      { type: "develop" },
      (message) => message.type === "snapshot" && message.stage === "developing",
      "the development start snapshot",
    );
    const developed = await waitForMessage(
      worker,
      (message) =>
        message.type === "snapshot" &&
        message.stage === "complete" &&
        message.developmentProgress === 1,
      "development completion",
    );
    assert.equal(
      developed.volumeDiagnostics.developmentStep,
      developed.volumeDiagnostics.developmentStepsTotal,
    );
    assert.equal(
      developed.metrics.survivingFraction,
      developed.volumeDiagnostics.survivingFraction,
    );
    assert.ok(developed.metrics.survivingFraction < 1);
    assert.equal(
      developed.metrics.offTargetSurvivingFraction,
      developed.volumeDiagnostics.offTargetSurvivingFraction,
    );

    const reset = await postAndWait(
      worker,
      { type: "reset" },
      (message) =>
        message.type === "snapshot" &&
        message.stage === "ready" &&
        message.exposureProgress === 0 &&
        message.developmentProgress === 0,
      "a reset snapshot",
    );
    assert.equal(reset.metrics.checksum, configuredSnapshot.metrics.checksum);
  } finally {
    await worker.terminate();
  }
});

test("production worker reports a persistent Wasm initialization failure", async () => {
  const workerPath = await productionWorkerPath();
  const worker = new Worker(
    new URL("./helpers/production-worker-shim.mjs", import.meta.url),
    {
      type: "module",
      workerData: {
        clientRoot: CLIENT_ROOT,
        workerPath,
        wasmFailure: "invalid",
      },
    },
  );

  try {
    const initializing = waitForMessage(
      worker,
      (message) =>
        message.type === "solverStatus" && message.status === "initializing",
      "the initializing status before a Wasm failure",
    );
    const failed = waitForMessage(
      worker,
      (message) =>
        message.type === "solverStatus" && message.status === "error",
      "the Wasm initialization error",
    );
    const rejected = waitForMessage(
      worker,
      (message) =>
        message.type === "commandError" && message.command === "slice",
      "the queued command rejection",
    );

    worker.postMessage({ type: "slice", params: parameters });
    await initializing;
    const [failure, commandError] = await Promise.all([failed, rejected]);
    assert.equal(failure.solver, "Rust/Wasm");
    assert.ok(failure.message);
    assert.equal(commandError.solver, "Rust/Wasm");
    assert.equal(commandError.stage, "model");
    assert.equal(commandError.message, failure.message);
  } finally {
    await worker.terminate();
  }
});
