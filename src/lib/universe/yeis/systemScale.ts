import type { StarSystem } from "../../../vendor/yeis/core/StarSystem";
import { SYSTEM_OVERVIEW_RADIUS } from "../types";

export const SYSTEM_OVERVIEW_FRAME_SCALE = 1.15;

/**
 * Physical radius of the current stellar-system overview volume.
 *
 * Keep this definition shared with the product similarity adapter so the
 * native Galaxy renderer and the product System renderer agree on what
 * "the whole system" means at their handoff.
 */
export function nativeSystemSpan(system: StarSystem): number {
  const star = system.star;
  let span = star.radius * 120;
  for (const body of system.bodies) {
    if (body.data.type !== "planet" && body.data.type !== "dwarf") continue;
    span = Math.max(span, body.position.distanceTo(star.position));
  }
  return Math.max(span, 1);
}

export function productSystemScale(system: StarSystem): number {
  return SYSTEM_OVERVIEW_RADIUS / nativeSystemSpan(system);
}

/**
 * Same perspective-sphere fit used by camera-controls#getDistanceToFitSphere.
 * Keeping the formula here lets the native YEIS CameraController stop at the
 * same apparent system size before ownership crosses to camera-controls.
 */
export function perspectiveDistanceToFitSphere(
  radius: number,
  effectiveFovDeg: number,
  aspect: number,
): number {
  const verticalFov = effectiveFovDeg * (Math.PI / 180);
  const horizontalFov =
    Math.atan(Math.tan(verticalFov * 0.5) * Math.max(aspect, 1e-6)) * 2;
  const limitingFov = aspect > 1 ? verticalFov : horizontalFov;
  return Math.max(radius, 1e-9) / Math.sin(limitingFov * 0.5);
}

export function nativeSystemOverviewDistance(
  system: StarSystem,
  effectiveFovDeg: number,
  aspect: number,
): number {
  return (
    perspectiveDistanceToFitSphere(
      nativeSystemSpan(system),
      effectiveFovDeg,
      aspect,
    ) * SYSTEM_OVERVIEW_FRAME_SCALE
  );
}
