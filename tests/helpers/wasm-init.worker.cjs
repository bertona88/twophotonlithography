/* eslint-disable @typescript-eslint/no-require-imports */

const { isMainThread, parentPort } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  preview_volume_psf,
  WholeVolumeSimulation,
} = require("../../.wasm-test/reaction_lens/reaction_lens.js");

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

try {
  const occupancy = readFileSync(
    path.join(__dirname, "../../public/benchy/3dbenchy-occupancy.bin"),
  );
  const simulation = new WholeVolumeSimulation(
    { memoryBudgetBytes: 8 * 1024 * 1024, parameters },
    occupancy,
  );
  const initial = simulation.get_diagnostics();
  const advanced = simulation.advance_exposure_steps(34);
  const firstReplay = simulation.get_diagnostics();

  simulation.reset();
  simulation.advance_exposure_steps(34);
  const secondReplay = simulation.get_diagnostics();
  const psfPreview = preview_volume_psf(1.4, 780, 64 * 1024 * 1024);

  let rejectedInvalidParameters = false;
  try {
    simulation.set_parameters({ ...parameters, oxygen: -1 });
  } catch {
    rejectedInvalidParameters = true;
  }

  parentPort.postMessage({
    isMainThread,
    initial,
    advanced,
    replayChecksum: firstReplay.checksum,
    replayChecksumAfterReset: secondReplay.checksum,
    snapshotLength: simulation.snapshot_len(),
    sliceLength: simulation.xy_slice_len(),
    sliceWidth: simulation.xy_slice_width(),
    sliceHeight: simulation.xy_slice_height(),
    psfPreview,
    rejectedInvalidParameters,
  });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
}
