import type { GalaxyIndex, GalaxyMarker, SystemDefinition } from "../types";
import { catalogMarkers, catalogSystem } from "./catalog";
import { generateProceduralMarkers } from "./galaxyGenerator";
import { createHeroSystem, HERO_MARKER } from "./heroOverrides";
import { generateSystem } from "./systemGenerator";

export { generateGalaxyPointCloud } from "./galaxyGenerator";
export { catalogMetadata } from "./catalog";
export { hashSeed, SeededRng } from "./seededRng";

export function buildGalaxyIndex(seed: string): GalaxyIndex {
  const real = catalogMarkers(32);
  const procedural = generateProceduralMarkers(seed, 220);

  return {
    seed,
    markers: [HERO_MARKER, ...real, ...procedural],
  };
}

export function resolveSystem(marker: GalaxyMarker): SystemDefinition {
  if (marker.source === "hero") return createHeroSystem();
  if (marker.source === "catalog") {
    const observed = catalogSystem(marker);
    if (observed) return observed;
  }
  return generateSystem(marker.seed, marker.position, marker.name);
}
