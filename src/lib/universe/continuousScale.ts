import type {
  PlanetSurfaceMode,
  UniversePhase,
} from "./types";

export type ContinuousScaleDirection = "in" | "out";

export const CONTINUOUS_SCALE_WHEEL_THRESHOLD = 72;
// A single tiny wheel sample is treated as noise if no follow-up arrives
// promptly. Once two same-direction samples establish a gesture, keep that
// partial intent alive across short main-thread/render stalls; hosted software
// WebGL can delay the next delivered input by around a second even when the
// physical/automation gesture itself is continuous.
export const CONTINUOUS_SCALE_RESET_MS = 260;
export const CONTINUOUS_SCALE_ACTIVE_RESET_MS = 2_000;

// Product scale is one real coordinate rather than a phase counter.
// Galaxy (0) -> System (1) -> Approach (2) -> Orbit (3) -> Atmosphere (4)
// -> Surface (5). Native YEIS owns 0->1; the existing product camera owns 1->5.
export const GALAXY_SCALE_MIN = 0;
export const SYSTEM_SCALE_MIN = 1;
export const WORLD_SCALE_MIN = 2;
export const WORLD_SCALE_MAX = 5;

// Normalized CSS-pixel budgets for each semantic scale interval. These are not
// timers or thresholds: they define a monotonic, stateless response-distance
// coordinate that is inverted back into the existing 0..5 product coordinate.
//
// 0->1 stays deliberate enough for the native Galaxy composition, 1->2 removes
// the old 384px -> 192px gain cliff, the middle world intervals remain direct,
// and 4->5 slows slightly to avoid overshooting the landing composition.
export const CONTINUOUS_SCALE_SEGMENT_PIXELS = [
  384, // Galaxy -> System: preserve native trajectory resolution
  288, // System -> Approach: remove the old 2x gain cliff
  192, // Approach -> Orbit: retain established direct close-world cadence
  192, // Orbit -> Atmosphere: retain established direct close-world cadence
  240, // Atmosphere -> Surface: reduce landing overshoot
] as const;

// Compatibility exports for diagnostics/tests that still refer to the old
// single-span names. Product movement uses the full response-distance map.
export const GALAXY_SCALE_WHEEL_SPAN =
  CONTINUOUS_SCALE_SEGMENT_PIXELS[0];
export const WORLD_SCALE_WHEEL_SPAN =
  CONTINUOUS_SCALE_SEGMENT_PIXELS[2];

const CONTINUOUS_SCALE_RESPONSE_DISTANCE = [
  0,
  384,
  672,
  864,
  1056,
  1296,
] as const;
export const CONTINUOUS_SCALE_RESPONSE_MAX =
  CONTINUOUS_SCALE_RESPONSE_DISTANCE[
    CONTINUOUS_SCALE_RESPONSE_DISTANCE.length - 1
  ];
export const WORLD_SCALE_EPSILON = 1e-3;
export const WHEEL_LINE_PIXELS = 16;
export const WHEEL_SAMPLE_LIMIT = 96;
export const CONTINUOUS_SCALE_JITTER_FLOOR = 0.05;

export type WheelDeltaMode = 0 | 1 | 2;

/**
 * Convert browser wheel units to a bounded CSS-pixel-equivalent distance.
 *
 * Pixel devices (including high-resolution trackpads) retain every delivered
 * sub-notch delta. Line wheels use the conventional 16px line height and page
 * wheels use the current viewport height. The per-event cap makes a coalesced
 * event after a main-thread stall no stronger than one ordinary mouse notch;
 * subsequent events are still applied, so there is no queue or inertia.
 */
export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  pagePixels = 800,
): number {
  if (!Number.isFinite(deltaY)) return 0;
  const unit =
    deltaMode === 1
      ? WHEEL_LINE_PIXELS
      : deltaMode === 2
        ? Math.max(WHEEL_LINE_PIXELS, pagePixels)
        : 1;
  const normalized = deltaY * unit;
  if (Math.abs(normalized) < CONTINUOUS_SCALE_JITTER_FLOOR) return 0;
  return Math.min(
    WHEEL_SAMPLE_LIMIT,
    Math.max(-WHEEL_SAMPLE_LIMIT, normalized),
  );
}

export function continuousScaleDirection(
  deltaY: number,
): ContinuousScaleDirection | null {
  const normalized = continuousScaleDelta(deltaY);
  if (normalized === 0) return null;
  // Browser wheel convention: negative delta = wheel forward/up = zoom in.
  return normalized < 0 ? "in" : "out";
}

export function continuousScaleDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  return Math.min(
    WHEEL_SAMPLE_LIMIT,
    Math.max(-WHEEL_SAMPLE_LIMIT, deltaY),
  );
}

function clampContinuousScalePosition(position: number): number {
  if (!Number.isFinite(position)) return GALAXY_SCALE_MIN;
  return Math.min(
    WORLD_SCALE_MAX,
    Math.max(GALAXY_SCALE_MIN, position),
  );
}

/**
 * Convert the product's 0..5 coordinate into cumulative normalized input
 * distance. The map is monotonic and piecewise linear, so it carries no hidden
 * gesture state and can be inverted exactly for immediate reversal.
 */
export function continuousScaleResponseDistance(position: number): number {
  const value = clampContinuousScalePosition(position);
  if (value >= WORLD_SCALE_MAX) return CONTINUOUS_SCALE_RESPONSE_MAX;

  const segment = Math.min(
    CONTINUOUS_SCALE_SEGMENT_PIXELS.length - 1,
    Math.floor(value),
  );
  const progress = value - segment;
  return (
    CONTINUOUS_SCALE_RESPONSE_DISTANCE[segment] +
    progress * CONTINUOUS_SCALE_SEGMENT_PIXELS[segment]
  );
}

export function continuousScalePositionForResponseDistance(
  distance: number,
): number {
  if (!Number.isFinite(distance)) return GALAXY_SCALE_MIN;
  const value = Math.min(
    CONTINUOUS_SCALE_RESPONSE_MAX,
    Math.max(0, distance),
  );
  if (value >= CONTINUOUS_SCALE_RESPONSE_MAX) return WORLD_SCALE_MAX;

  let segment = 0;
  while (
    segment < CONTINUOUS_SCALE_SEGMENT_PIXELS.length - 1 &&
    value >= CONTINUOUS_SCALE_RESPONSE_DISTANCE[segment + 1]
  ) {
    segment += 1;
  }

  const local =
    value - CONTINUOUS_SCALE_RESPONSE_DISTANCE[segment];
  return segment + local / CONTINUOUS_SCALE_SEGMENT_PIXELS[segment];
}

/**
 * Return the signed product-coordinate movement for one already-normalized
 * wheel sample. Negative browser delta moves inward (positive product scale).
 * No time, velocity, queue, damping or gesture history participates.
 */
export function continuousScaleInputResponseDelta(
  position: number,
  deltaY: number,
): number {
  const normalized = continuousScaleDelta(deltaY);
  if (normalized === 0) return 0;

  const currentPosition = clampContinuousScalePosition(position);
  const currentDistance = continuousScaleResponseDistance(currentPosition);
  const nextDistance = Math.min(
    CONTINUOUS_SCALE_RESPONSE_MAX,
    Math.max(0, currentDistance - normalized),
  );
  return (
    continuousScalePositionForResponseDistance(nextDistance) -
    currentPosition
  );
}

export function isWorldScalePhase(phase: UniversePhase): boolean {
  return (
    phase === "approach" ||
    phase === "orbit" ||
    phase === "atmosphere" ||
    phase === "surface"
  );
}

export function worldScalePositionForPhase(
  phase: UniversePhase,
): number | null {
  return isWorldScalePhase(phase) ? scalePhaseIndex(phase) : null;
}

export function scalePositionForPhase(
  phase: UniversePhase,
): number | null {
  if (phase === "galaxy") return GALAXY_SCALE_MIN;
  if (phase === "system") return SYSTEM_SCALE_MIN;
  return worldScalePositionForPhase(phase);
}

export function applyGalaxyScaleWheel(
  position: number,
  deltaY: number,
): number {
  const delta = continuousScaleInputResponseDelta(position, deltaY);
  return Math.min(
    SYSTEM_SCALE_MIN,
    Math.max(GALAXY_SCALE_MIN, position + delta),
  );
}

export function galaxyScaleSegmentProgress(position: number): number {
  return Math.min(1, Math.max(0, position - GALAXY_SCALE_MIN));
}

export function galaxyScaleVisualResponse(progress: number): number {
  const linear = Math.min(1, Math.max(0, progress));
  const easeOut = 1 - (1 - linear) * (1 - linear);
  // Native YEIS spans enormous physical distances. Give early delivered input
  // a modest visual lift while retaining a non-zero endpoint slope and exact
  // reversibility from the same product coordinate.
  return linear * 0.75 + easeOut * 0.25;
}

export function applySystemScaleWheel(
  position: number,
  deltaY: number,
): number {
  const delta = continuousScaleInputResponseDelta(position, deltaY);
  return Math.min(
    WORLD_SCALE_MIN,
    Math.max(SYSTEM_SCALE_MIN, position + delta),
  );
}

export function continuousScaleResponse(progress: number): number {
  const linear = Math.min(1, Math.max(0, progress));
  const smooth = linear * linear * (3 - 2 * linear);
  // Keep most of the mapping linear so authored anchors do not read as
  // stop/start cinematics. The small smooth component preserves composition
  // without creating a zero-velocity endpoint.
  return linear * 0.84 + smooth * 0.16;
}

export function systemScaleSegmentProgress(position: number): number {
  return Math.min(
    1,
    Math.max(0, position - SYSTEM_SCALE_MIN),
  );
}

export function worldScaleMax(surfaceMode: PlanetSurfaceMode): number {
  return surfaceMode === "none" ? 3 : WORLD_SCALE_MAX;
}

export function clampWorldScalePosition(
  position: number,
  surfaceMode: PlanetSurfaceMode,
): number {
  return Math.min(
    worldScaleMax(surfaceMode),
    Math.max(WORLD_SCALE_MIN, position),
  );
}

export function applyWorldScaleWheel(
  position: number,
  deltaY: number,
  surfaceMode: PlanetSurfaceMode,
): number {
  const delta = continuousScaleInputResponseDelta(position, deltaY);
  return clampWorldScalePosition(position + delta, surfaceMode);
}

export function worldScalePhaseForPosition(
  position: number,
  surfaceMode: PlanetSurfaceMode,
): UniversePhase {
  const value = clampWorldScalePosition(position, surfaceMode);
  if (surfaceMode !== "none" && value >= 5 - WORLD_SCALE_EPSILON) {
    return "surface";
  }
  if (surfaceMode !== "none" && value >= 4) return "atmosphere";
  if (value >= 3) return "orbit";
  return "approach";
}

export function worldScaleSegmentProgress(position: number): number {
  const value = Math.min(WORLD_SCALE_MAX, Math.max(WORLD_SCALE_MIN, position));
  if (value >= WORLD_SCALE_MAX) return 1;
  return value - Math.floor(value);
}

export function worldScalePositionMatchesPhase(
  position: number,
  phase: UniversePhase,
): boolean {
  const value = Math.min(WORLD_SCALE_MAX, Math.max(WORLD_SCALE_MIN, position));
  if (phase === "approach") return value >= 2 && value < 3;
  if (phase === "orbit") return value >= 3 && value < 4;
  if (phase === "atmosphere") return value >= 4 && value < 5;
  if (phase === "surface") return value >= 5 - WORLD_SCALE_EPSILON;
  return false;
}

export function nextWorldScalePhase(
  phase: UniversePhase,
  direction: ContinuousScaleDirection,
  surfaceMode: PlanetSurfaceMode,
): UniversePhase | null {
  if (direction === "out") {
    if (phase === "surface") return "atmosphere";
    if (phase === "atmosphere") return "orbit";
    if (phase === "orbit") return "approach";
    if (phase === "approach") return "system";
    return null;
  }

  if (phase === "approach") return "orbit";
  if (phase === "orbit") {
    return surfaceMode === "none" ? null : "atmosphere";
  }
  if (phase === "atmosphere") return "surface";
  return null;
}

export function scalePhaseIndex(phase: UniversePhase): number {
  switch (phase) {
    case "galaxy":
      return 0;
    case "system":
      return 1;
    case "approach":
      return 2;
    case "orbit":
      return 3;
    case "atmosphere":
      return 4;
    case "surface":
      return 5;
    case "returning":
      return 0;
  }
}
