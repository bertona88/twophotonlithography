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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
