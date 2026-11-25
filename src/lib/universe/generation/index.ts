import type { GalaxyIndex, GalaxyMarker, SystemDefinition } from "../types";
import { catalogMarkers, catalogSystem } from "./catalog";
import { generateProceduralMarkers } from "./galaxyGenerator";
import { createHeroSystem, HERO_MARKER } from "./heroOverrides";
import {
  assertSystemPopulation,
  authoredMarkerPopulation,
  decorateAuthoredSystem,
  decorateGeneratedSystem,
  PopulationSystemCache,
  POPULATION_GENERATOR_VERSION,
  POPULATION_SCHEMA_VERSION,
  populationSystemCacheKey,
} from "./population";
import { generateSystem } from "./systemGenerator";

const systemCache = new PopulationSystemCache<SystemDefinition>();

export { generateGalaxyPointCloud } from "./galaxyGenerator";
export { catalogMetadata } from "./catalog";
export { hashSeed, SeededRng } from "./seededRng";
export {
  assertSystemPopulation,
  populationCapabilityForArchetype,
  populationRarityForSeed,
  POPULATION_GENERATOR_VERSION,
  POPULATION_SCHEMA_VERSION,
  POPULATION_SYSTEM_CACHE_CAPACITY,
  systemPopulationFingerprint,
  validateSystemPopulation,
} from "./population";

export function buildGalaxyIndex(seed: string): GalaxyIndex {
  const real = catalogMarkers(32);
  const procedural = generateProceduralMarkers(seed, 220);

  const hero: GalaxyMarker = {
    ...HERO_MARKER,
    population: authoredMarkerPopulation(HERO_MARKER),
  };

  return {
    seed,
    markers: [hero, ...real, ...procedural],
    population: {
      schemaVersion: POPULATION_SCHEMA_VERSION,
      generatorVersion: POPULATION_GENERATOR_VERSION,
    },
  };
}

export function resolveSystem(marker: GalaxyMarker): SystemDefinition {
  const cacheKey = populationSystemCacheKey(marker);
  const cached = systemCache.get(cacheKey);
  if (cached) return cached;

  let system: SystemDefinition;
  if (marker.source === "hero") {
    system = decorateAuthoredSystem(createHeroSystem());
  } else if (marker.source === "catalog") {
    system =
      catalogSystem(marker) ??
      decorateGeneratedSystem(
        generateSystem(marker.seed, marker.position, marker.name),
      );
  } else {
    system = decorateGeneratedSystem(
      generateSystem(marker.seed, marker.position, marker.name),
    );
  }

  assertSystemPopulation(system);
  return systemCache.set(cacheKey, system);
}

export function populationRuntimeStats() {
  return systemCache.stats();
}

export function clearPopulationMaterializationCache(): void {
  systemCache.clear();
}
