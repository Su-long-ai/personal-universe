import type { GalaxyMarker, SystemDefinition } from "../types";
import { generateSystem } from "./systemGenerator";

export const HERO_MARKER: GalaxyMarker = {
  id: "hero:aurora",
  name: "AURORA",
  seed: "hero:aurora:system",
  source: "hero",
  position: [21.4, 0.18, -2.4],
  spectralType: "G",
  heroKey: "home",
};

export function createHeroSystem(): SystemDefinition {
  const base = generateSystem(
    HERO_MARKER.seed,
    HERO_MARKER.position,
    "HELION",
  );
  const targetIndex = Math.min(2, base.planets.length - 1);
  const target = base.planets[targetIndex]!;

  const planets = base.planets.map((planet, index) =>
    index === targetIndex
      ? {
          ...target,
          id: "aurora-01",
          name: "AURORA-01",
          seed: "hero:aurora:planet",
          archetype: "ocean" as const,
          radiusEarth: 1.72,
          massEarth: 4.1,
          equilibriumTempK: 286,
          orbitAU: 1.08,
          hasRings: false,
          surfaceMode: "surface-terrain" as const,
          heroKey: "home",
        }
      : planet,
  );

  return {
    ...base,
    id: HERO_MARKER.id,
    name: "AURORA SYSTEM",
    source: "hero",
    heroKey: "home",
    galaxyPosition: HERO_MARKER.position,
    star: {
      ...base.star,
      id: "hero:helion",
      name: "HELION",
      source: "hero",
      spectralType: "G",
      temperatureK: 5820,
      massSolar: 1.03,
      radiusSolar: 1.01,
      luminositySolar: 1.08,
    },
    planets,
  };
}
