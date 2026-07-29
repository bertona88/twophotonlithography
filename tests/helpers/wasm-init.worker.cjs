/* eslint-disable @typescript-eslint/no-require-imports */

const { isMainThread, parentPort } = require("node:worker_threads");
const {
  ReactionLensSimulation,
} = require("../../.wasm-test/reaction_lens/reaction_lens.js");

const parameters = {
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
  const simulation = new ReactionLensSimulation(
    { exposureStepsTotal: 720, parameters },
    0x07a1,
  );
  const initial = simulation.get_diagnostics();
  const advanced = simulation.advance_exposure_steps(34);
  const firstReplay = simulation.get_diagnostics();

  simulation.reset(0x07a1);
  simulation.advance_exposure_steps(34);
  const secondReplay = simulation.get_diagnostics();

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
    rejectedInvalidParameters,
  });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
}
