const MAX_BEAM_LENGTH_UM = 8;
const MAX_BEAM_RADIUS_UM = 7.4;
export const BEAM_ROTATION_X = -Math.PI / 2;

/**
 * Size a near-focus cone from an authoritative angular aperture. The cone is
 * clipped to the viewport's resin width without changing its physical angle.
 *
 * @param {number} halfAngleRad
 * @returns {{length: number, radius: number, centerOffsetZ: number}}
 */
export function beamConeDimensions(halfAngleRad) {
  const angle = Math.min(
    Math.PI / 2 - 1e-4,
    Math.max(1e-4, halfAngleRad),
  );
  const tangent = Math.tan(angle);
  const length = Math.min(MAX_BEAM_LENGTH_UM, MAX_BEAM_RADIUS_UM / tangent);
  return {
    length,
    radius: length * tangent,
    centerOffsetZ: length / 2,
  };
}
