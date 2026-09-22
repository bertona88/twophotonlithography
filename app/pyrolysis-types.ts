export const PYROLYSIS_FIELDS = [
  "radius_m", "precursor_fraction", "char_fraction", "mobile_fraction",
  "network_order", "micro_porosity", "free_density_kg_m3", "natural_jacobian",
  "natural_isotropic_stretch", "current_radius_m", "current_jacobian",
  "actual_density_kg_m3", "radial_stretch", "hoop_stretch", "axial_stretch",
  "radial_stress_pa", "hoop_stress_pa", "axial_stress_pa", "current_outer_radius_m",
] as const;

export type PyrolysisConfig = {
  modelVersion: "radial-mechanics-v2";
  radialCells: number;
  radiusM: number;
  lengthM: number;
  schedule: { timeS: number; temperatureK: number }[];
  mechanics: {
    enabled: boolean; shearModulusPa: number; poissonRatio: number;
    axialBoundary: "free" | "prescribed" | "compliant";
    axialStiffnessNM: number; finalAnchorStretch: number;
    thermalExpansionPerK: number; axialAnisotropy: number;
  };
  material: {
    version: "inert-demo-v1";
    reactionAPerS: number;
    reactionEJMol: number;
    charYield: number;
    networkAPerS: number;
    networkEJMol: number;
    polymerDensityKgM3: number;
    charDensityKgM3: number;
    networkDensityGainKgM3: number;
    initialPorosity: number;
    transientPorosity: number;
    diffusivityM2S: number;
    networkDiffusivityGain: number;
    surfaceTransferMS: number;
    minSolidFraction: number;
    minDensityKgM3: number;
    minJacobian: number;
    maxPorosity: number;
  };
  maxStepS: number;
  minStepS: number;
  relativeTolerance: number;
  absoluteTolerance: number;
  memoryBudgetBytes: number;
};

export type PyrolysisDiagnostic = {
  code: string; message: string; quantity: string; value: number; bound: number;
  cell?: number; trialTimeS: number;
};
export type PyrolysisDiagnostics = {
  modelVersion: string; calibration: string; geometry: string;
  temperatureConvention: string; volatileFeedback: string; atmosphere: string;
  schemaVersion: number; fieldOrder: string; radialCells: number;
  timeS: number; durationS: number; specimenTemperatureK: number;
  initialMassKg: number; precursorMassKg: number; charMassKg: number;
  mobileMassKg: number; escapedMassKg: number; relativeMassError: number;
  currentRadiusM: number; currentLengthM: number; volumeRatio: number;
  axialForceN: number; anchorStretch: number; mechanicalResidual: number;
  meanNetworkOrder: number; minNaturalJacobian: number;
  acceptedSteps: number; rejectedSteps: number; nextStepS: number;
  estimatedPeakBytes: number; complete: boolean; checksum: string;
  failure?: PyrolysisDiagnostic;
};
export type PyrolysisStatus = "ready" | "running" | "paused" | "cancelled" | "complete" | "error";
export type PyrolysisCommand =
  | { type: "configure"; runId: number; config: PyrolysisConfig }
  | { type: "restore"; runId: number; checkpoint: unknown }
  | { type: "start" | "pause" | "resume" | "cancel" | "step" | "export"; runId: number };
export type PyrolysisMessage =
  | { type: "ready"; defaults: PyrolysisConfig }
  | { type: "error"; runId: number; message: string }
  | { type: "checkpoint"; runId: number; checkpoint: unknown }
  | { type: "snapshot"; runId: number; sequence: number; status: PyrolysisStatus;
      fields: ArrayBuffer; diagnostics: PyrolysisDiagnostics; config: PyrolysisConfig };
