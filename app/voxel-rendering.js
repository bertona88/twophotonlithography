/**
 * Build the instanced voxel mesh with instance colors initialized before the
 * first render. Enabling material vertex colors without a geometry color
 * attribute multiplies the intended instance colors by black in Three.js.
 *
 * @param {typeof import("three")} THREE
 * @param {number} maximum
 */
export function createVoxelMesh(THREE, maximum) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const colors = new Float32Array(maximum * 3);
  colors.fill(1);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.94,
      depthWrite: true,
      blending: THREE.NormalBlending,
    }),
    maximum,
  );
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/**
 * Keep the intended scan path useful during slicing and exposure, then let the
 * calculated material become the dominant result.
 *
 * @param {string} stage
 * @param {number} progress
 */
export function voxelPathOpacity(stage, progress) {
  if (stage === "ready") return 0.16;
  if (stage === "exposing" || (stage === "paused" && progress < 1)) return 0.09;
  if (stage === "model" || stage === "slicing") return 0;
  return 0.035;
}
