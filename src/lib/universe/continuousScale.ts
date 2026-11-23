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
