import { PLANET_ANCHOR } from "../types";

export const SURFACE_STELLAR_SOURCE_POSITION = [
  -12.5,
  5.5,
  -18,
] as const satisfies readonly [number, number, number];

function normalizeDirection(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export const SURFACE_STELLAR_LIGHT_DIRECTION = normalizeDirection(
  SURFACE_STELLAR_SOURCE_POSITION[0] - PLANET_ANCHOR[0],
  SURFACE_STELLAR_SOURCE_POSITION[1] - PLANET_ANCHOR[1],
  SURFACE_STELLAR_SOURCE_POSITION[2] - PLANET_ANCHOR[2],
);

export function surfaceStellarLightAngles(): {
  azimuth: number;
  elevation: number;
} {
  const [x, y, z] = SURFACE_STELLAR_LIGHT_DIRECTION;
  const azimuth = ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360;
  const elevation = (Math.asin(y) * 180) / Math.PI;
  return { azimuth, elevation };
}
