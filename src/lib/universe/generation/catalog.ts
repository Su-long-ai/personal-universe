import snapshot from "../../../data/exoplanet-hosts.json" with { type: "json" };
import type {
  GalaxyMarker,
  PlanetArchetype,
  PlanetDefinition,
  SystemDefinition,
} from "../types";
import { surfaceModeForArchetype } from "../surface";
import {
  observedPopulationMetadata,
  populationCapabilityForArchetype,
} from "./population";
import { hashSeed } from "./seededRng";

type CatalogPlanet = {
  name: string;
  orbitAU: number | null;
  radiusEarth: number | null;
  massEarth: number | null;
  equilibriumTempK: number | null;
};

type CatalogSystem = {
  hostname: string;
  hip: number | null;
  hipName: string | null;
  hdName: string | null;
  gaiaDr3Id: string | null;
  raDeg: number;
  decDeg: number;
  distancePc: number;
  spectralType: string | null;
  temperatureK: number | null;
  massSolar: number | null;
  radiusSolar: number | null;
  planets: CatalogPlanet[];
};

type CatalogSnapshot = {
  generatedAt: string | null;
  source: string;
  sourceUrl?: string;
  systems: CatalogSystem[];
};

const catalog = snapshot as CatalogSnapshot;
const catalogByHostname = new Map<string, CatalogSystem>();
for (const system of catalog.systems) {
  if (catalogByHostname.has(system.hostname)) {
    throw new Error(`Duplicate observed catalog hostname: ${system.hostname}`);
  }
  catalogByHostname.set(system.hostname, system);
}

const SUN_GALAXY_POSITION: [number, number, number] = [18, 0.05, -4];
const LOCAL_PC_SCALE = 0.075;
const J2000_OBLIQUITY_RAD = (23.439291 * Math.PI) / 180;
const ECLIPTIC_COS = Math.cos(J2000_OBLIQUITY_RAD);
const ECLIPTIC_SIN = Math.sin(J2000_OBLIQUITY_RAD);

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function icrsToGalacticUnit(
  raDeg: number,
  decDeg: number,
): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);

  return [
    -0.0548755604 * x - 0.8734370902 * y - 0.4838350155 * z,
     0.4941094279 * x - 0.44482963 * y + 0.7469822445 * z,
    -0.8676661490 * x - 0.1980763734 * y + 0.4559837762 * z,
  ];
}

function visualPosition(system: CatalogSystem): [number, number, number] {
  const [towardCenter, alongPlane, vertical] = icrsToGalacticUnit(
    system.raDeg,
    system.decDeg,
  );
  const distance = Math.min(system.distancePc, 70) * LOCAL_PC_SCALE;
  return [
    SUN_GALAXY_POSITION[0] - towardCenter * distance,
    SUN_GALAXY_POSITION[1] + vertical * distance,
    SUN_GALAXY_POSITION[2] + alongPlane * distance,
  ];
}

function physicalScenePosition(system: CatalogSystem): [number, number, number] {
  const ra = (system.raDeg * Math.PI) / 180;
  const dec = (system.decDeg * Math.PI) / 180;
  const distance = system.distancePc;
  const xEq = distance * Math.cos(dec) * Math.cos(ra);
  const yEq = distance * Math.cos(dec) * Math.sin(ra);
  const zEq = distance * Math.sin(dec);

  // Match pinned YEIS build-stars.mjs exactly:
  // equatorial pc -> ecliptic J2000 -> scene (x, z_ecl, -y_ecl).
  const yEcl = yEq * ECLIPTIC_COS + zEq * ECLIPTIC_SIN;
  const zEcl = -yEq * ECLIPTIC_SIN + zEq * ECLIPTIC_COS;
  return [xEq, zEcl, -yEcl];
}

function inferSpectralType(system: CatalogSystem): string {
  const explicit = system.spectralType?.trim().charAt(0).toUpperCase();
  if (explicit && "OBAFGKM".includes(explicit)) return explicit;
  const temperature = system.temperatureK ?? 5600;
  if (temperature >= 30000) return "O";
  if (temperature >= 10000) return "B";
  if (temperature >= 7500) return "A";
  if (temperature >= 6000) return "F";
  if (temperature >= 5200) return "G";
  if (temperature >= 3700) return "K";
  return "M";
}

function luminosityFromStar(system: CatalogSystem): number {
  const radius = system.radiusSolar ?? 1;
  const temperature = system.temperatureK ?? 5772;
  return radius * radius * Math.pow(temperature / 5772, 4);
}

function inferArchetype(
  temperature: number,
  massEarth: number,
): PlanetArchetype {
  if (massEarth >= 55) return "gas_giant";
  if (massEarth >= 12) return temperature < 190 ? "ice_giant" : "gas_giant";
  if (temperature > 700) return "lava";
  if (temperature > 450) return "desert";
  if (temperature < 145) return "ice";
  if (temperature < 215) return "frozen";
  if (temperature >= 255 && temperature <= 330) return "temperate";
  return "rocky";
}

function observedPlanet(
  system: CatalogSystem,
  planet: CatalogPlanet,
  index: number,
  parentSystemId: string,
): PlanetDefinition {
  const orbitAU = planet.orbitAU ?? 0.35 + index * 0.55;
  const luminosity = luminosityFromStar(system);
  const equilibriumTempK =
    planet.equilibriumTempK ??
    (278 * Math.pow(Math.max(luminosity, 0.001), 0.25)) /
      Math.sqrt(Math.max(orbitAU, 0.04));
  const massEarth =
    planet.massEarth ??
    Math.max(0.12, Math.pow(Math.max(planet.radiusEarth ?? 1, 0.2), 3.1));
  const radiusEarth =
    planet.radiusEarth ?? Math.max(0.25, Math.pow(massEarth, 0.27));
  const seed = `catalog:${system.hostname}:${planet.name}`;
  const archetype = inferArchetype(equilibriumTempK, massEarth);
  const observedFields = ["name"];
  const inferredFields = ["archetype", "orbitalPeriodYears", "hasRings"];
  for (const [field, value] of [
    ["orbitAU", planet.orbitAU],
    ["radiusEarth", planet.radiusEarth],
    ["massEarth", planet.massEarth],
    ["equilibriumTempK", planet.equilibriumTempK],
  ] as const) {
    (value === null ? inferredFields : observedFields).push(field);
  }

  return {
    id: seed,
    name: planet.name,
    seed,
    archetype,
    radiusEarth,
    massEarth,
    equilibriumTempK,
    orbitAU,
    orbitalPeriodYears: Math.sqrt(
      Math.pow(orbitAU, 3) / Math.max(system.massSolar ?? 1, 0.08),
    ),
    moons: [],
    hasRings: false,
    surfaceMode: surfaceModeForArchetype(archetype),
    observed: true,
    population: observedPopulationMetadata({
      kind: "world",
      stableSeed: seed,
      parentId: parentSystemId,
      capability: populationCapabilityForArchetype(archetype),
      tags: [
        "catalog",
        "exoplanet",
        `archetype:${archetype}`,
        `capability:${populationCapabilityForArchetype(archetype)}`,
      ],
      observedFields,
      inferredFields,
    }),
  };
}

export function catalogMarkers(limit = 18): GalaxyMarker[] {
  return catalog.systems.slice(0, limit).map((system) => {
    const seed = `catalog:${system.hostname}`;
    const spectralType = inferSpectralType(system);
    return {
    id: `catalog:${slug(system.hostname)}`,
    name: system.hostname,
    seed,
    source: "catalog",
    position: visualPosition(system),
    physicalPositionPc: physicalScenePosition(system),
    spectralType,
    catalogId: system.hostname,
    population: observedPopulationMetadata({
      kind: "marker",
      stableSeed: seed,
      capability: "system-only",
      tags: ["catalog", "observed-host", `spectral:${spectralType}`],
      observedFields: ["hostname", "raDeg", "decDeg", "distancePc"],
      inferredFields: system.spectralType ? [] : ["spectralType"],
    }),
    catalogIdentity: {
      ...(system.hip ? { hip: system.hip } : {}),
      ...(system.hipName ? { hipName: system.hipName } : {}),
      ...(system.hdName ? { hdName: system.hdName } : {}),
      ...(system.gaiaDr3Id ? { gaiaDr3Id: system.gaiaDr3Id } : {}),
    },
  };
  });
}

export function catalogSystem(marker: GalaxyMarker): SystemDefinition | null {
  if (!marker.catalogId) return null;
  const system = catalogByHostname.get(marker.catalogId);
  if (!system) return null;

  const luminositySolar = luminosityFromStar(system);
  const starObservedFields = ["name"];
  const starInferredFields = ["luminositySolar"];
  for (const [field, value] of [
    ["spectralType", system.spectralType],
    ["temperatureK", system.temperatureK],
    ["massSolar", system.massSolar],
    ["radiusSolar", system.radiusSolar],
  ] as const) {
    (value === null ? starInferredFields : starObservedFields).push(field);
  }

  return {
    id: marker.id,
    name: `${system.hostname} System`,
    seed: marker.seed,
    source: "catalog",
    galaxyPosition: marker.position,
    catalogId: system.hostname,
    population: observedPopulationMetadata({
      kind: "system",
      stableSeed: marker.seed,
      capability: "system-only",
      tags: ["catalog", "observed-system"],
      observedFields: ["hostname", "raDeg", "decDeg", "distancePc"],
    }),
    star: {
      id: `${marker.id}:star`,
      name: system.hostname,
      seed: `${marker.seed}:star`,
      source: "catalog",
      spectralType: inferSpectralType(system),
      temperatureK: Math.round(system.temperatureK ?? 5600),
      massSolar: system.massSolar ?? 1,
      radiusSolar: system.radiusSolar ?? 1,
      luminositySolar,
      population: observedPopulationMetadata({
        kind: "star",
        stableSeed: `${marker.seed}:star`,
        parentId: marker.id,
        capability: "system-only",
        tags: ["catalog", "observed-star", `spectral:${inferSpectralType(system)}`],
        observedFields: starObservedFields,
        inferredFields: starInferredFields,
      }),
    },
    planets: system.planets.map((planet, index) =>
      observedPlanet(system, planet, index, marker.id),
    ),
  };
}

export function catalogMetadata() {
  return {
    generatedAt: catalog.generatedAt,
    count: catalog.systems.length,
    indexedCount: catalogByHostname.size,
    checksum: hashSeed(JSON.stringify(catalog.systems.map((item) => item.hostname))),
  };
}
