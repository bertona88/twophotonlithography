export function shouldRunComparison(dirty, stage, isMobileLayout) {
  return Boolean(
    !isMobileLayout &&
      dirty &&
      (stage === "complete" || stage === "compare"),
  );
}
