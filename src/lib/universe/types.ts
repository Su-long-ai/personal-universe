import type { UniverseContentEntry } from "./content";

export type UniversePhase =
  | "galaxy"
  | "system"
  | "approach"
  | "orbit"
  | "atmosphere"
  | "surface"
  | "returning";

export type QualityMode = "auto" | "high" | "low";
export type StarSource = "procedural" | "catalog" | "hero";
export type UniverseEngine = "v2" | "yeis";
export type PlanetSurfaceMode = "none" | "surface-terrain" | "custom";
export type PlanetArchetype =
  | "rocky"
  | "temperate"
  | "ocean"
  | "desert"
  | "ice"
  | "frozen"
  | "lava"
  | "volcanic"
  | "gas_giant"
  | "ice_giant"
  | "alien";

export interface MoonDefinition {
  id: string;
  name: string;
  seed: string;
  radiusEarth: number;
  orbitRadius: number;
}

export interface PlanetDefinition {
  id: string;
  name: string;
  seed: string;
  archetype: PlanetArchetype;
  radiusEarth: number;
  massEarth: number;
  equilibriumTempK: number;
  orbitAU: number;
  orbitalPeriodYears: number;
  moons: MoonDefinition[];
  hasRings: boolean;
  surfaceMode: PlanetSurfaceMode;
  heroKey?: string;
  observed?: boolean;
  content?: UniverseContentEntry[];
}

export interface StarDefinition {
  id: string;
  name: string;
  seed: string;
  source: StarSource;
  spectralType: string;
  temperatureK: number;
  massSolar: number;
  radiusSolar: number;
  luminositySolar: number;
}

export interface SystemDefinition {
  id: string;
  name: string;
  seed: string;
  source: StarSource;
  galaxyPosition: [number, number, number];
  star: StarDefinition;
  planets: PlanetDefinition[];
  heroKey?: string;
  catalogId?: string;
  content?: UniverseContentEntry[];
}

export interface CatalogIdentity {
  hip?: number;
  hipName?: string;
  hdName?: string;
  gaiaDr3Id?: string;
}

export interface GalaxyMarker {
  id: string;
  name: string;
  seed: string;
  source: StarSource;
  engine?: UniverseEngine;
  nativeId?: string;
  position: [number, number, number];
  /** Physical position in YEIS scene frame: ecliptic J2000, parsecs from the Sun. */
  physicalPositionPc?: [number, number, number];
  spectralType: string;
  heroKey?: string;
  catalogId?: string;
  catalogIdentity?: CatalogIdentity;
}

export interface GalaxyIndex {
  seed: string;
  markers: GalaxyMarker[];
}

export interface GalaxyPointCloud {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
}

export interface WorldDefinition {
  id: string;
  name: string;
  subtitle: string;
  position: [number, number, number];
  radius: number;
}

export const PLANET_ANCHOR: [number, number, number] = [6.7, 0.2, 0];

export const TEST_WORLD: WorldDefinition = {
  id: "aurora-01",
  name: "AURORA-01",
  subtitle: "Hero ocean world",
  position: PLANET_ANCHOR,
  radius: 1.72,
};
