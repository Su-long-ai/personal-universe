import type {
  MoonDefinition,
  PlanetArchetype,
  PlanetDefinition,
  StarDefinition,
  SystemDefinition,
} from "../types";
import { hashSeed, SeededRng } from "./seededRng";

type SpectralTemplate = {
  type: string;
  weight: number;
  temp: [number, number];
  mass: [number, number];
  radius: [number, number];
};

const SPECTRAL: readonly SpectralTemplate[] = [
  { type: "O", weight: 0.003, temp: [30000, 50000], mass: [16, 45], radius: [6.6, 12] },
  { type: "B", weight: 0.013, temp: [10000, 30000], mass: [2.1, 16], radius: [1.8, 6.6] },
  { type: "A", weight: 0.06, temp: [7500, 10000], mass: [1.4, 2.1], radius: [1.4, 1.8] },
  { type: "F", weight: 0.076, temp: [6000, 7500], mass: [1.04, 1.4], radius: [1.15, 1.4] },
  { type: "G", weight: 0.121, temp: [5200, 6000], mass: [0.8, 1.04], radius: [0.96, 1.15] },
  { type: "K", weight: 0.2, temp: [3700, 5200], mass: [0.45, 0.8], radius: [0.7, 0.96] },
  { type: "M", weight: 0.527, temp: [2400, 3700], mass: [0.08, 0.45], radius: [0.12, 0.7] },
];

const STAR_ROOTS = [
  "Aster", "Caelum", "Draco", "Eridani", "Lyra", "Orion", "Pavo", "Serpens",
  "Tauri", "Vela", "Cygnus", "Persei", "Aquila", "Indus", "Carina", "Hydra",
] as const;

function weightedSpectral(rng: SeededRng): SpectralTemplate {
  let roll = rng.next();
  for (const template of SPECTRAL) {
    roll -= template.weight;
    if (roll <= 0) return template;
  }
  return SPECTRAL[SPECTRAL.length - 1]!;
}

function luminosityFromMass(massSolar: number): number {
  if (massSolar > 2) return Math.min(100000, 1.4 * Math.pow(massSolar, 3.5));
  if (massSolar > 0.43) return Math.pow(massSolar, 4);
  if (massSolar > 0.2) return 0.23 * Math.pow(massSolar, 2.3);
  return 0.1 * Math.pow(massSolar, 2.5);
}

function planetRadiusFromMass(massEarth: number): number {
  if (massEarth < 1) return Math.max(0.22, Math.pow(massEarth, 0.27));
  if (massEarth < 10) return Math.pow(massEarth, 0.28);
  if (massEarth < 50) return 2.1 + Math.log10(massEarth) * 1.45;
  return Math.min(13.5, 8.6 + Math.log10(massEarth / 50) * 2.6);
}

function classifyPlanet(
  temperature: number,
  massEarth: number,
  rng: SeededRng,
): PlanetArchetype {
  if (massEarth >= 55) return "gas_giant";
  if (massEarth >= 12) return temperature < 170 ? "ice_giant" : "gas_giant";
  if (temperature > 700) return "lava";
  if (temperature > 470) return rng.chance(0.22) ? "volcanic" : "desert";
  if (temperature < 135) return "ice";
  if (temperature < 210) return "frozen";
  if (temperature >= 250 && temperature <= 335) {
    const wet = rng.next();
    if (wet > 0.78) return "ocean";
    if (wet > 0.35) return "temperate";
  }
  if (rng.chance(0.06)) return "alien";
  return temperature > 330 ? "desert" : "rocky";
}

function buildMoons(
  planetSeed: string,
  massEarth: number,
  rng: SeededRng,
): MoonDefinition[] {
  const maxMoons = massEarth > 50 ? 4 : massEarth > 8 ? 3 : massEarth > 1 ? 2 : 1;
  const count = rng.int(0, maxMoons);
  return Array.from({ length: count }, (_, index) => {
    const moonRng = rng.fork(`moon:${index}`);
    return {
      id: `${planetSeed}:moon:${index}`,
      name: `M-${index + 1}`,
      seed: `${planetSeed}:moon:${index}`,
      radiusEarth: moonRng.range(0.03, Math.min(0.42, 0.08 + massEarth * 0.015)),
      orbitRadius: moonRng.range(1.8, 4.8 + index * 1.3),
    };
  });
}

export function generateStar(seed: string, nameHint?: string): StarDefinition {
  const rng = new SeededRng(`${seed}:star`);
  const template = weightedSpectral(rng);
  const massSolar = rng.range(...template.mass);
  const radiusSolar = rng.range(...template.radius);
  const luminositySolar = luminosityFromMass(massSolar) * rng.range(0.84, 1.16);
  const temperatureK = Math.round(rng.range(...template.temp));
  const suffix = hashSeed(seed).toString(36).toUpperCase().slice(0, 4);

  return {
    id: `${seed}:star`,
    name: nameHint ?? `${rng.pick(STAR_ROOTS)} ${suffix}`,
    seed: `${seed}:star`,
    source: "procedural",
    spectralType: template.type,
    temperatureK,
    massSolar,
    radiusSolar,
    luminositySolar,
  };
}

export function generateSystem(
  seed: string,
  galaxyPosition: [number, number, number],
  nameHint?: string,
): SystemDefinition {
  const rng = new SeededRng(seed);
  const star = generateStar(seed, nameHint);
  const planetCount = rng.int(2, 7);
  const planets: PlanetDefinition[] = [];

  let orbitAU = rng.range(0.2, 0.48);
  for (let index = 0; index < planetCount; index += 1) {
    const planetSeed = `${seed}:planet:${index}`;
    const planetRng = rng.fork(`planet:${index}`);
    if (index > 0) orbitAU *= planetRng.range(1.42, 1.92);

    const outerBias = Math.min(1, index / Math.max(1, planetCount - 1));
    const massEarth = Math.exp(
      planetRng.range(
        Math.log(0.12),
        Math.log(outerBias > 0.48 ? 420 : 18),
      ),
    );
    const radiusEarth = planetRadiusFromMass(massEarth) * planetRng.range(0.9, 1.1);
    const equilibriumTempK =
      278 *
      Math.pow(Math.max(0.0001, star.luminositySolar), 0.25) /
      Math.sqrt(Math.max(0.05, orbitAU));
    const archetype = classifyPlanet(equilibriumTempK, massEarth, planetRng);
    const orbitalPeriodYears = Math.sqrt(
      Math.pow(orbitAU, 3) / Math.max(0.08, star.massSolar),
    );
    const hasRings =
      archetype === "gas_giant"
        ? planetRng.chance(0.55)
        : archetype === "ice_giant"
          ? planetRng.chance(0.18)
          : planetRng.chance(0.035);

    planets.push({
      id: planetSeed,
      name: `${star.name} ${String.fromCharCode(98 + index)}`,
      seed: planetSeed,
      archetype,
      radiusEarth,
      massEarth,
      equilibriumTempK,
      orbitAU,
      orbitalPeriodYears,
      moons: buildMoons(planetSeed, massEarth, planetRng.fork("moons")),
      hasRings,
      surfaceMode: "none",
    });
  }

  return {
    id: `system:${hashSeed(seed).toString(36)}`,
    name: `${star.name} System`,
    seed,
    source: "procedural",
    galaxyPosition,
    star,
    planets,
  };
}
