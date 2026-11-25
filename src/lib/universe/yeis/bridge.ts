import type {
  GalaxyIndex,
  GalaxyMarker,
  MoonDefinition,
  PlanetArchetype,
  PlanetDefinition,
  SystemDefinition,
} from "../types";
import type { Universe } from "../../../vendor/yeis/core/Universe";
import type { StarCatalog } from "../../../vendor/yeis/data/StarCatalog";
import type { BodyData, OrbitElements } from "../../../vendor/yeis/data/types";
import type { StarSystem } from "../../../vendor/yeis/core/StarSystem";
import { AU_KM } from "../../../vendor/yeis/core/constants";
import { _ } from "../../../vendor/yeis/i18n";
import {
  assertSystemPopulation,
  authoredMarkerPopulation,
  decorateNativeSystemPopulation,
  generatedMarkerPopulation,
  observedPopulationMetadata,
  POPULATION_GENERATOR_VERSION,
  POPULATION_SCHEMA_VERSION,
} from "../generation/population";
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
    population: observedPopulationMetadata({
      kind: "marker",
      stableSeed: "yeis:c0",
      capability: "system-only",
      tags: ["native", "solar-system", "observed-host"],
      observedFields: ["name", "nativeId", "position", "spectralType"],
    }),
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

    const seed = `yeis:c${index}`;
    const spectralType = spectralClass(info.spectral);
    markers.push({
      id: `yeis:c${index}`,
      name: info.name,
      seed,
      source: "catalog",
      engine: "yeis",
      nativeId,
      position: visualPosition(info.position.x, info.position.y, info.position.z),
      spectralType,
      population: observedPopulationMetadata({
        kind: "marker",
        stableSeed: seed,
        capability: "system-only",
        tags: [
          "native",
          "catalog-star",
          "generated-system",
          `spectral:${spectralType}`,
        ],
        observedFields: ["name", "nativeId", "position", "spectralType"],
      }),
    });
    added += 1;
  }

  return {
    seed: "yeis-observation-first-v1",
    markers,
    population: {
      schemaVersion: POPULATION_SCHEMA_VERSION,
      generatorVersion: POPULATION_GENERATOR_VERSION,
    },
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

  const seed = `yeis:${starId}`;
  const source =
    starId === HERO_SYSTEM_ID
      ? "hero"
      : starId.startsWith("c")
        ? "catalog"
        : "procedural";
  const spectralType = spectralClass(
    info.spectral || info.catalogSpectral || "G",
  );
  const marker: GalaxyMarker = {
    id: `yeis:${starId}`,
    name: runtime.universe.starName(starId),
    seed,
    source,
    engine: "yeis",
    nativeId: starId,
    position: visualPosition(position.x, position.y, position.z),
    spectralType,
    ...(starId === HERO_SYSTEM_ID ? { heroKey: "home" } : {}),
  };

  marker.population =
    source === "hero"
      ? authoredMarkerPopulation(marker)
      : source === "catalog"
        ? observedPopulationMetadata({
            kind: "marker",
            stableSeed: seed,
            capability: "system-only",
            tags: [
              "native",
              starId === "c0" ? "solar-system" : "catalog-star",
              `spectral:${spectralType}`,
            ],
            observedFields: ["name", "nativeId", "position", "spectralType"],
          })
        : generatedMarkerPopulation(marker);

  return marker;
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

  const definition: SystemDefinition = {
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

  const mode =
    marker.source === "hero"
      ? "authored"
      : starId === "c0"
        ? "observed"
        : marker.source === "catalog"
          ? "catalog-generated"
          : "generated";
  const populated = decorateNativeSystemPopulation(definition, mode);
  assertSystemPopulation(populated);
  return populated;
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

  return {
    id: hero ? HERO_PLANET_ID : `yeis-planet:${data.id}`,
    name: _(data.name),
    seed: `yeis-planet:${data.id}:${appearanceSeed(data)}`,
    archetype: archetypeFor(data, temperature),
    radiusEarth: Math.max(0.01, data.radius / EARTH_RADIUS_KM),
    massEarth: Math.max(0.001, data.mass / EARTH_MASS_KG),
    equilibriumTempK: temperature,
    orbitAU,
    orbitalPeriodYears: periodYears,
    moons,
    hasRings: Boolean(data.rings),
    surfaceMode: hero ? "surface-terrain" : "none",
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

  const marker: GalaxyMarker = {
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
  marker.population = authoredMarkerPopulation(marker);
  return marker;
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
