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

// Product scale is a real coordinate rather than a phase counter.
// Galaxy still uses native focus/travel. Once a stellar system is open, wheel
// delta moves continuously from System (1) through Approach (2) to Surface (5).
export const SYSTEM_SCALE_MIN = 1;
export const WORLD_SCALE_MIN = 2;
export const WORLD_SCALE_MAX = 5;
export const WORLD_SCALE_WHEEL_SPAN = 192;
export const WORLD_SCALE_EPSILON = 1e-3;

export function continuousScaleDirection(
  deltaY: number,
): ContinuousScaleDirection | null {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return null;
  // Browser wheel convention: negative delta = wheel forward/up = zoom in.
  return deltaY < 0 ? "in" : "out";
}

export function continuousScaleDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  return Math.min(96, Math.max(-96, deltaY));
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
  if (phase === "system") return SYSTEM_SCALE_MIN;
  return worldScalePositionForPhase(phase);
}

export function applySystemScaleWheel(
  position: number,
  deltaY: number,
): number {
  const delta = -continuousScaleDelta(deltaY) / WORLD_SCALE_WHEEL_SPAN;
  return Math.min(
    WORLD_SCALE_MIN,
    Math.max(SYSTEM_SCALE_MIN, position + delta),
  );
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
  const delta = -continuousScaleDelta(deltaY) / WORLD_SCALE_WHEEL_SPAN;
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
