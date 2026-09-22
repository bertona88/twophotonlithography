import type { PyrolysisConfig, PyrolysisDiagnostic, PyrolysisStatus } from "./pyrolysis-types";

export type BccConfig = {
  modelVersion: "bcc-tet-v1";
  cellsPerAxis: number;
  voxelsPerCell: number;
  pitchM: number;
  strutRadiusRatio: number;
  support: "bonded" | "free";
  shearModulusPa: number;
  poissonRatio: number;
  equilibriumFraction: number;
  relaxationTimeS: number;
  maxStepS: number;
  relativeTolerance: number;
  schedule: PyrolysisConfig["schedule"];
  material: PyrolysisConfig["material"];
};

export type BccDiagnostics = {
  modelVersion: string;
  calibration: string;
  geometry: string;
  support: "bonded" | "free";
  timeS: number;
  durationS: number;
  specimenTemperatureK: number;
  initialMassKg: number;
  precursorMassKg: number;
  charMassKg: number;
  mobileMassKg: number;
  escapedMassKg: number;
  relativeMassError: number;
  meanNetworkOrder: number;
  minNaturalJacobian: number;
  minJacobian: number;
  volumeRatio: number;
  dimensionsUm: [number, number, number];
  referenceDimensionsUm: [number, number, number];
  maxStressMPa: number;
  mechanicalResidual: number;
  mechanicalIterations: number;
  relaxationDissipationJ: number;
  transportLimiterMinAlpha: number;
  transportLimitedSteps: number;
  acceptedSteps: number;
  rejectedSteps: number;
  nextStepS: number;
  nodes: number;
  elements: number;
  surfaceTriangles: number;
  voxelSizeUm: number;
  strutDiameterVoxels: number;
  estimatedPeakBytes: number;
  complete: boolean;
  checksum: string;
  failure: PyrolysisDiagnostic | null;
};

export const BCC_FIELDS = [
  "precursor", "char", "mobile", "order", "porosity", "density",
  "stressMPa", "naturalJacobian", "jacobian",
] as const;
export type BccField = typeof BCC_FIELDS[number];
export type BccSnapshot = {
  positionsUm: number[];
  referencePositionsUm: number[];
  cellCentersUm: number[];
  triangles: number[];
  tetrahedra: number[];
  triangleCells: number[];
  cellFields: Record<BccField, number[]>;
  diagnostics: BccDiagnostics;
};
export type BccStatus = PyrolysisStatus;
export type BccCommand =
  | { type: "configure"; runId: number; config: BccConfig }
  | { type: "restore"; runId: number; checkpoint: unknown }
  | { type: "start" | "pause" | "resume" | "cancel" | "step" | "export"; runId: number };
export type BccMessage =
  | { type: "ready"; defaults: BccConfig }
  | { type: "error"; runId: number; message: string }
  | { type: "checkpoint"; runId: number; checkpoint: unknown }
  | { type: "snapshot"; runId: number; sequence: number; status: BccStatus;
      snapshot: BccSnapshot; config: BccConfig };
