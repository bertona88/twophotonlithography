export function nearestLayerIndex(layerPositions, zUm) {
  if (!layerPositions?.length || !Number.isFinite(zUm)) return 0;

  let nearestIndex = 0;
  let nearestDistance = Math.abs(layerPositions[0] - zUm);
  for (let index = 1; index < layerPositions.length; index += 1) {
    const distance = Math.abs(layerPositions[index] - zUm);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

export function isLayerInspectionLocked(stage) {
  return stage === "exposing" || stage === "compare";
}
