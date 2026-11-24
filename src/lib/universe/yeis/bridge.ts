import type {
  GalaxyIndex,
  GalaxyMarker,
  MoonDefinition,
  PlanetArchetype,
  PlanetDefinition,
  SystemDefinition,
} from "../types";
import { surfaceModeForArchetype } from "../surface";
import type { Universe } from "../../../vendor/yeis/core/Universe";
import type { StarCatalog } from "../../../vendor/yeis/data/StarCatalog";
import type { BodyData, OrbitElements } from "../../../vendor/yeis/data/types";
import type { StarSystem } from "../../../vendor/yeis/core/StarSystem";
import { AU_KM } from "../../../vendor/yeis/core/constants";
import { _ } from "../../../vendor/yeis/i18n";
const HERO_SYSTEM_ID = "h-aurora";
const HERO_PLANET_ID = "aurora-01";

type YeisRuntimeLike = {
  catalog: StarCatalog;
  universe: Universe;
  heroSystem: StarSystem;
};

const SUN_VISUAL: [number, number, number] = [18, 0.05, -4];
const LOCAL_PC_SCALE = 0.075;
const EARTH_RADIUS_KM = 6371.0;
const EARTH_MASS_KG = 5.9722e24;
const YEAR_DAYS = 365.25;

export function buildYeisGalaxyIndex(
  runtime: YeisRuntimeLike,
  observedMarkers: GalaxyMarker[],
  maxNamedStars = 72,
): GalaxyIndex {
  const hipToIndex = buildHipIndex(runtime.catalog);
  const observed = observedMarkers.map((marker) => {
    const hip = marker.catalogIdentity?.hip;
    const nativeIndex = hip ? hipToIndex.get(hip) : undefined;
    return {
      ...marker,
      engine: "v2" as const,
      ...(nativeIndex !== undefined ? { nativeId: `c${nativeIndex}` } : {}),
    };
  });

  const observedNames = new Set<string>();
  const observedNativeIds = new Set<string>();
  for (const marker of observed) {
    observedNames.add(normalizeName(marker.name));
    if (marker.nativeId) observedNativeIds.add(marker.nativeId);
  }

  const markers: GalaxyMarker[] = [
    heroMarker(runtime.universe),
    ...observed,
  ];

  markers.push({
    id: "yeis:c0",
    name: "SUN",
    seed: "yeis:c0",
    source: "catalog",
    engine: "yeis",
    nativeId: "c0",
    position: SUN_VISUAL,
    spectralType: "G",
  });

  let added = 0;
  for (const index of runtime.catalog.namedIndices) {
    if (added >= maxNamedStars) break;
    const info = runtime.catalog.info(index);
    if (info.distancePc > 80) continue;

    const aliases = [
      info.name,
      info.names?.proper,
      info.names?.bayer,
      info.names?.gliese,
    ].filter((value): value is string => Boolean(value));

    const nativeId = `c${index}`;
    if (observedNativeIds.has(nativeId)) continue;
    if (aliases.some((name) => observedNames.has(normalizeName(name)))) continue;

    markers.push({
      id: `yeis:c${index}`,
      name: info.name,
      seed: `yeis:c${index}`,
      source: "catalog",
      engine: "yeis",
      nativeId,
      position: visualPosition(info.position.x, info.position.y, info.position.z),
      spectralType: spectralClass(info.spectral),
    });
    added += 1;
  }

  return {
    seed: "yeis-observation-first-v1",
    markers,
  };
}

export function markerForYeisStarId(
  runtime: YeisRuntimeLike,
  markers: GalaxyMarker[],
  starId: string,
): GalaxyMarker {
  const existing = markers.find((marker) => marker.nativeId === starId);
  if (existing) return existing;

  const info = runtime.universe.starInfo(starId);
  const position = runtime.universe.starPositionPc(starId);

  return {
    id: `yeis:${starId}`,
    name: runtime.universe.starName(starId),
    seed: `yeis:${starId}`,
    source: starId.startsWith("c") ? "catalog" : "procedural",
    engine: "yeis",
    nativeId: starId,
    position: visualPosition(position.x, position.y, position.z),
    spectralType: spectralClass(info.spectral || info.catalogSpectral || "G"),
  };
}

export function resolveYeisSystem(
  runtime: YeisRuntimeLike,
  marker: GalaxyMarker,
): SystemDefinition {
  const starId = marker.nativeId;
  if (!starId) throw new Error(`YEIS marker has no nativeId: ${marker.id}`);

  const system = runtime.universe.system(starId);
  const starInfo = runtime.universe.starInfo(starId);
  system.update(2451545.0, 0);

  const planets = system.bodies
    .filter((body) => body.data.type === "planet" || body.data.type === "dwarf")
    .map((body, index) =>
      mapPlanet(body.data, system, starInfo.massSolar, starId === "c0", index),
    );

  return {
    id: `yeis-system:${starId}`,
    name:
      marker.source === "hero"
        ? "AURORA SYSTEM"
        : `${runtime.universe.starName(starId)} System`,
    seed: `yeis:${starId}`,
    source: marker.source,
    galaxyPosition: marker.position,
    heroKey: marker.heroKey,
    star: {
      id: `yeis-star:${starId}`,
      name: runtime.universe.starName(starId),
      seed: `yeis-star:${starId}`,
      source: marker.source,
      spectralType: starInfo.spectral || starInfo.catalogSpectral || "G",
      temperatureK: Math.round(starInfo.temperature),
      massSolar: starInfo.massSolar,
      radiusSolar: starInfo.radiusSolar,
      luminositySolar: starInfo.luminosity,
    },
    planets,
  };
}

function mapPlanet(
  data: BodyData,
  system: StarSystem,
  starMassSolar: number,
  observed: boolean,
  index: number,
): PlanetDefinition {
  const orbitAU = orbitSemiMajorAU(data.orbit, index);
  const periodYears = orbitPeriodYears(data.orbit, orbitAU, starMassSolar);
  const temperature =
    data.temperature ??
    estimateEquilibriumTemperature(system.star.data.appearance.kind === "star"
      ? system.star.data.appearance.temperature
      : 5772, orbitAU);

  const moons: MoonDefinition[] = system.bodies
    .filter((candidate) =>
      candidate.parent?.id === data.id && candidate.data.type === "moon",
    )
    .map((moon) => ({
      id: `yeis-moon:${moon.id}`,
      name: _(moon.name),
      seed: `yeis-moon:${moon.id}`,
      radiusEarth: Math.max(0.001, moon.radius / EARTH_RADIUS_KM),
      orbitRadius: moonOrbitRadius(moon.data.orbit, data.radius),
    }));

  const hero = data.id === HERO_PLANET_ID;
  const archetype = archetypeFor(data, temperature);

  return {
    id: hero ? HERO_PLANET_ID : `yeis-planet:${data.id}`,
    name: _(data.name),
    seed: `yeis-planet:${data.id}:${appearanceSeed(data)}`,
    archetype,
    radiusEarth: Math.max(0.01, data.radius / EARTH_RADIUS_KM),
    massEarth: Math.max(0.001, data.mass / EARTH_MASS_KG),
    equilibriumTempK: temperature,
    orbitAU,
    orbitalPeriodYears: periodYears,
    moons,
    hasRings: Boolean(data.rings),
    surfaceMode: surfaceModeForArchetype(archetype),
    heroKey: hero ? "home" : undefined,
    observed,
  };
}

function visualPosition(x: number, y: number, z: number): [number, number, number] {
  return [
    SUN_VISUAL[0] + x * LOCAL_PC_SCALE,
    SUN_VISUAL[1] + y * LOCAL_PC_SCALE,
    SUN_VISUAL[2] + z * LOCAL_PC_SCALE,
  ];
}

function heroMarker(universe: Universe): GalaxyMarker {
  const p = universe.starPositionPc(HERO_SYSTEM_ID);
  const info = universe.starInfo(HERO_SYSTEM_ID);

  return {
    id: "hero:aurora:yeis",
    name: "AURORA",
    seed: HERO_SYSTEM_ID,
    source: "hero",
    engine: "yeis",
    nativeId: HERO_SYSTEM_ID,
    position: visualPosition(p.x, p.y, p.z),
    spectralType: spectralClass(info.spectral),
    heroKey: "home",
  };
}

function buildHipIndex(catalog: StarCatalog): Map<number, number> {
  const index = new Map<number, number>();
  for (let i = 0; i < catalog.count; i += 1) {
    const hip = catalog.hips[i];
    if (hip) index.set(hip, i);
  }
  return index;
}

function spectralClass(value: string): string {
  const first = value.trim().charAt(0).toUpperCase();
  return "OBAFGKM".includes(first) ? first : "G";
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function appearanceSeed(data: BodyData): number {
  return "seed" in data.appearance ? data.appearance.seed : 0;
}

function archetypeFor(data: BodyData, temperature: number): PlanetArchetype {
  if (data.appearance.kind === "gas") {
    return temperature < 170 ? "ice_giant" : "gas_giant";
  }

  if (data.appearance.kind === "terrestrial") {
    if (data.appearance.volcanic) return "volcanic";
    if (temperature > 700) return "lava";
    if (temperature > 430) return "desert";
    if (temperature < 145) return "ice";
    if (temperature < 215) return "frozen";

    if (data.appearance.seaLevel !== undefined) {
      if (data.appearance.seaLevel >= 0.58) return "ocean";
      if (temperature >= 245 && temperature <= 335) return "temperate";
    }
  }

  return temperature > 330 ? "desert" : "rocky";
}

function orbitSemiMajorAU(orbit: OrbitElements | undefined, index: number): number {
  if (!orbit) return 0.25 + index * 0.55;
  if (orbit.kind === "simple") return Math.max(0.001, orbit.a / AU_KM);
  if (orbit.kind === "jpl") return Math.max(0.001, orbit.a);
  return 0.25 + index * 0.55;
}

function orbitPeriodYears(
  orbit: OrbitElements | undefined,
  orbitAU: number,
  starMassSolar: number,
): number {
  if (orbit?.kind === "simple") {
    return Math.max(0.001, orbit.period / YEAR_DAYS);
  }

  return Math.sqrt(
    Math.pow(Math.max(orbitAU, 0.001), 3) /
      Math.max(starMassSolar, 0.08),
  );
}

function moonOrbitRadius(orbit: OrbitElements | undefined, parentRadiusKm: number): number {
  if (orbit?.kind === "simple") {
    return Math.max(1.2, orbit.a / Math.max(parentRadiusKm, 1));
  }
  if (orbit?.kind === "jpl") {
    return Math.max(1.2, (orbit.a * AU_KM) / Math.max(parentRadiusKm, 1));
  }
  return 2.5;
}

function estimateEquilibriumTemperature(
  starTemperatureK: number,
  orbitAU: number,
): number {
  const relative = Math.pow(Math.max(starTemperatureK, 1000) / 5772, 0.5);
  return 278 * relative / Math.sqrt(Math.max(orbitAU, 0.04));
}
