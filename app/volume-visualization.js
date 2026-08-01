/**
 * Return the visible activity of one rendered resin voxel. Unaffected voxels
 * must collapse to zero: drawing every occupied voxel with additive blending
 * turns the dense hull into a bright slab and hides the actual exposure front.
 *
 * @param {"conversion" | "oxygen" | "radicals" | "development"} mode
 * @param {number} conversion
 * @param {number} oxygen
 * @param {number} radicals
 * @param {number} remaining
 * @returns {number}
 */
export function voxelActivity(
  mode,
  conversion,
  oxygen,
  radicals,
  remaining,
) {
  if (mode === "oxygen") {
    return clamp01(((1 - oxygen) - 0.004) / 0.28);
  }
  if (mode === "radicals") {
    return clamp01((radicals - 0.012) / 0.22);
  }
  if (mode === "development") {
    return clamp01((conversion - 0.012) / 0.32) * clamp01(remaining);
  }
  return clamp01((conversion - 0.012) / 0.32);
}

/**
 * Return an even vertex count so THREE.LineSegments never draws half of the
 * next authoritative scan segment while exposure progress advances.
 *
 * @param {number} vertexCount
 * @param {number} progress
 * @returns {number}
 */
export function lineSegmentDrawCount(vertexCount, progress) {
  const boundedVertexCount = Math.max(0, Math.floor(vertexCount));
  const completeVertexCount = boundedVertexCount - (boundedVertexCount % 2);
  return (
    Math.floor((completeVertexCount * clamp01(progress)) / 2) * 2
  );
}

/**
 * Convert total scheduled exposure progress into progress along the one-pass
 * path shown in the viewport.
 *
 * @param {number} exposureProgress
 * @param {number} passes
 * @returns {number}
 */
export function multipassPathProgress(exposureProgress, passes) {
  return clamp01(exposureProgress * Math.max(1, passes));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
