const DEVELOPED_STAGES = new Set(["developing", "complete", "compare"]);

export function integrityPresentation(stage, metrics) {
  if (DEVELOPED_STAGES.has(stage)) {
    return {
      targetLabel: "target survives",
      targetFraction: metrics.survivingFraction,
      spillLabel: "spill survives",
      spillFraction: metrics.offTargetSurvivingFraction,
    };
  }

  return {
    targetLabel: "target gel",
    targetFraction: metrics.gelledFraction,
    spillLabel: "spill gel",
    spillFraction: metrics.offTargetGelledFraction,
  };
}
