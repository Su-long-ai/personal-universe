import type { GalaxyMarker, GalaxyPointCloud } from "../types";
import { generatedMarkerPopulation } from "./population";
import { SeededRng } from "./seededRng";

const TAU = Math.PI * 2;
const GALAXY_RADIUS = 32;
const ARM_COUNT = 4;
const ARM_TIGHTNESS = 1.08;

function spiralPosition(
  rng: SeededRng,
  radius = GALAXY_RADIUS,
): [number, number, number] {
  const radial = Math.pow(rng.next(), 0.66);
  const arm = rng.int(0, ARM_COUNT - 1);
  const baseAngle = arm * (TAU / ARM_COUNT) + radial * ARM_TIGHTNESS * TAU;
  const angle = baseAngle + rng.gaussian(0, 0.12 + radial * 0.12);
  const r = Math.max(0.25, radial * radius + rng.gaussian(0, 0.7 + radial * 0.75));
  const thickness = 0.18 + (1 - radial) * 0.62;
  return [
    Math.cos(angle) * r,
    rng.gaussian(0, thickness),
    Math.sin(angle) * r,
  ];
}

export function generateGalaxyPointCloud(seed: string, count: number): GalaxyPointCloud {
  const rng = new SeededRng(`${seed}:galaxy-points`);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  const warm: [number, number, number] = [1.0, 0.72, 0.42];
  const cool: [number, number, number] = [0.56, 0.72, 1.0];

  for (let index = 0; index < count; index += 1) {
    const pointRng = rng.fork(`p:${index}`);
    const [x, y, z] = spiralPosition(pointRng);
    const i3 = index * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    const radial = Math.min(1, Math.sqrt(x * x + z * z) / GALAXY_RADIUS);
    const hot = pointRng.chance(0.085);
    const gain = 0.42 + Math.pow(pointRng.next(), 3.2) * 1.22;
    const t = Math.min(1, Math.max(0, radial * 0.9 + (hot ? 0.18 : 0)));
    colors[i3] = (warm[0] * (1 - t) + cool[0] * t) * gain;
    colors[i3 + 1] = (warm[1] * (1 - t) + cool[1] * t) * gain;
    colors[i3 + 2] = (warm[2] * (1 - t) + cool[2] * t) * gain;
    scales[index] = 0.42 + Math.pow(pointRng.next(), 7) * 3.6;
  }

  return { positions, colors, scales };
}

function proceduralName(rng: SeededRng, index: number): string {
  const a = ["AL", "CY", "ER", "KA", "LY", "NO", "OR", "SA", "TA", "VE"] as const;
  const b = ["DRA", "LON", "MIR", "NEX", "RIA", "TIS", "VAR", "XEN"] as const;
  return `${rng.pick(a)}-${rng.pick(b)} ${String(100 + index)}`;
}

function markerSpectral(rng: SeededRng): string {
  const roll = rng.next();
  if (roll < 0.53) return "M";
  if (roll < 0.73) return "K";
  if (roll < 0.85) return "G";
  if (roll < 0.93) return "F";
  if (roll < 0.985) return "A";
  return roll < 0.998 ? "B" : "O";
}

export function generateProceduralMarkers(seed: string, count = 28): GalaxyMarker[] {
  const rng = new SeededRng(`${seed}:system-markers`);
  return Array.from({ length: count }, (_, index) => {
    const markerRng = rng.fork(`marker:${index}`);
    let position = spiralPosition(markerRng);
    if (Math.hypot(position[0], position[2]) < 5.5) {
      position = spiralPosition(markerRng.fork("reroll"));
    }
    const markerSeed = `${seed}:system:${index}`;
    const name = proceduralName(markerRng, index);
    const spectralType = markerSpectral(markerRng);
    return {
      id: `proc:${index}`,
      name,
      seed: markerSeed,
      source: "procedural",
      position,
      spectralType,
      population: generatedMarkerPopulation({ seed: markerSeed, spectralType }),
    };
  });
}
