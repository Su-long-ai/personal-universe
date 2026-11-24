import type {
  GalaxyMarker,
  PlanetArchetype,
  PopulationCapability,
  PopulationMetadata,
  PopulationObjectKind,
  PopulationProvenance,
  PopulationRarity,
  SystemDefinition,
} from "../types";
import { hashSeed } from "./seededRng";

export const POPULATION_SCHEMA_VERSION = 1;
export const POPULATION_GENERATOR_VERSION = "pu-population-v1";
export const POPULATION_SYSTEM_CACHE_CAPACITY = 64;

const RARE_THRESHOLD = 0.025;
const UNCOMMON_THRESHOLD = 0.12;

type PopulationMetadataInput = {
  kind: PopulationObjectKind;
  provenance: PopulationProvenance;
  stableSeed: string;
  parentId?: string;
  capability: PopulationCapability;
  tags?: readonly string[];
  generatedName?: boolean;
  reservedForAuthored?: boolean;
  observedFields?: readonly string[];
  inferredFields?: readonly string[];
  rarity?: PopulationRarity;
  rarityScore?: number;
};

function sortedUnique(values: readonly string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.filter(Boolean))].sort();
}

function metadata(input: PopulationMetadataInput): PopulationMetadata {
  const tags = sortedUnique(input.tags) ?? [];
  const observedFields = sortedUnique(input.observedFields);
  const inferredFields = sortedUnique(input.inferredFields);
  return {
    schemaVersion: POPULATION_SCHEMA_VERSION,
    generatorVersion: POPULATION_GENERATOR_VERSION,
    kind: input.kind,
    provenance: input.provenance,
    stableSeed: input.stableSeed,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    capability: input.capability,
    ...(input.rarity ? { rarity: input.rarity } : {}),
    ...(input.rarityScore !== undefined ? { rarityScore: input.rarityScore } : {}),
    tags,
    ...(input.generatedName !== undefined
      ? { generatedName: input.generatedName }
      : {}),
    ...(input.reservedForAuthored !== undefined
      ? { reservedForAuthored: input.reservedForAuthored }
      : {}),
    ...(observedFields ? { observedFields } : {}),
    ...(inferredFields ? { inferredFields } : {}),
  };
}

export function populationRarityForSeed(seed: string): {
  rarity: PopulationRarity;
  score: number;
} {
  const score =
    hashSeed(`${POPULATION_GENERATOR_VERSION}:${seed}:rarity`) / 0x100000000;
  return {
    rarity:
      score < RARE_THRESHOLD
        ? "rare"
        : score < UNCOMMON_THRESHOLD
          ? "uncommon"
          : "common",
    score,
  };
}

export function populationCapabilityForArchetype(
  archetype: PlanetArchetype,
  authoredSurface = false,
): PopulationCapability {
  if (authoredSurface) return "authored-surface";
  if (archetype === "gas_giant" || archetype === "ice_giant") {
    return "orbit-only";
  }
  return "surface-capable";
}

export function generatedMarkerPopulation(
  marker: Pick<GalaxyMarker, "seed" | "spectralType">,
): PopulationMetadata {
  const { rarity, score } = populationRarityForSeed(marker.seed);
  return metadata({
    kind: "marker",
    provenance: "generated",
    stableSeed: marker.seed,
    capability: "system-only",
    rarity,
    rarityScore: score,
    tags: ["generated", "system", `spectral:${marker.spectralType}`],
    generatedName: true,
  });
}

export function authoredMarkerPopulation(
  marker: Pick<GalaxyMarker, "seed" | "spectralType">,
): PopulationMetadata {
  return metadata({
    kind: "marker",
    provenance: "authored",
    stableSeed: marker.seed,
    capability: "system-only",
    rarity: "rare",
    rarityScore: 0,
    tags: ["authored", "featured", "system", `spectral:${marker.spectralType}`],
    generatedName: false,
    reservedForAuthored: true,
  });
}

export function observedPopulationMetadata(input: {
  kind: PopulationObjectKind;
  stableSeed: string;
  parentId?: string;
  capability: PopulationCapability;
  tags?: readonly string[];
  observedFields?: readonly string[];
  inferredFields?: readonly string[];
}): PopulationMetadata {
  const observedFields = sortedUnique(input.observedFields) ?? [];
  const inferredFields = sortedUnique(input.inferredFields) ?? [];
  const provenance: PopulationProvenance =
    inferredFields.length > 0
      ? observedFields.length > 0
        ? "hybrid"
        : "inferred"
      : "observed";
  return metadata({
    ...input,
    provenance,
    tags: ["observed", ...(input.tags ?? [])],
    observedFields,
    inferredFields,
    generatedName: false,
  });
}

export function decorateGeneratedSystem(
  system: SystemDefinition,
): SystemDefinition {
  const systemRarity = populationRarityForSeed(system.seed);
  return {
    ...system,
    population: metadata({
      kind: "system",
      provenance: "generated",
      stableSeed: system.seed,
      capability: "system-only",
      rarity: systemRarity.rarity,
      rarityScore: systemRarity.score,
      tags: ["generated", "system", `spectral:${system.star.spectralType}`],
      generatedName: true,
    }),
    star: {
      ...system.star,
      population: metadata({
        kind: "star",
        provenance: "generated",
        stableSeed: system.star.seed,
        parentId: system.id,
        capability: "system-only",
        tags: ["generated", "star", `spectral:${system.star.spectralType}`],
        generatedName: true,
      }),
    },
    planets: system.planets.map((planet) => {
      const rarity = populationRarityForSeed(planet.seed);
      const capability = populationCapabilityForArchetype(planet.archetype);
      return {
        ...planet,
        population: metadata({
          kind: "world",
          provenance: "generated",
          stableSeed: planet.seed,
          parentId: system.id,
          capability,
          rarity: rarity.rarity,
          rarityScore: rarity.score,
          tags: [
            "generated",
            "world",
            `archetype:${planet.archetype}`,
            `capability:${capability}`,
            ...(planet.hasRings ? ["ringed"] : []),
          ],
          generatedName: true,
        }),
        moons: planet.moons.map((moon) => ({
          ...moon,
          population: metadata({
            kind: "moon",
            provenance: "generated",
            stableSeed: moon.seed,
            parentId: planet.id,
            capability: "orbit-only",
            tags: ["generated", "moon"],
            generatedName: true,
          }),
        })),
      };
    }),
  };
}

export function decorateAuthoredSystem(
  system: SystemDefinition,
): SystemDefinition {
  return {
    ...system,
    population: metadata({
      kind: "system",
      provenance: "authored",
      stableSeed: system.seed,
      capability: "system-only",
      rarity: "rare",
      rarityScore: 0,
      tags: ["authored", "featured", "system"],
      generatedName: false,
      reservedForAuthored: true,
    }),
    star: {
      ...system.star,
      population: metadata({
        kind: "star",
        provenance: "authored",
        stableSeed: system.star.seed,
        parentId: system.id,
        capability: "system-only",
        tags: ["authored", "featured", "star"],
        generatedName: false,
        reservedForAuthored: true,
      }),
    },
    planets: system.planets.map((planet) => {
      const authored = Boolean(planet.heroKey);
      const rarity = populationRarityForSeed(planet.seed);
      const capability = populationCapabilityForArchetype(
        planet.archetype,
        authored,
      );
      return {
        ...planet,
        population: metadata({
          kind: "world",
          provenance: authored ? "authored" : "generated",
          stableSeed: planet.seed,
          parentId: system.id,
          capability,
          rarity: authored ? "rare" : rarity.rarity,
          rarityScore: authored ? 0 : rarity.score,
          tags: [
            authored ? "authored" : "generated",
            "world",
            `archetype:${planet.archetype}`,
            `capability:${capability}`,
            "authored-reservation",
          ],
          generatedName: !authored,
          reservedForAuthored: true,
        }),
        moons: planet.moons.map((moon) => ({
          ...moon,
          population: metadata({
            kind: "moon",
            provenance: "generated",
            stableSeed: moon.seed,
            parentId: planet.id,
            capability: "orbit-only",
            tags: ["generated", "moon", "authored-reservation"],
            generatedName: true,
            reservedForAuthored: true,
          }),
        })),
      };
    }),
  };
}

export type NativeSystemPopulationMode =
  | "authored"
  | "observed"
  | "catalog-generated"
  | "generated";

/**
 * Attach the shared population contract to the lightweight product definition
 * mapped from pinned YEIS. This deliberately does not cache the mapped object:
 * Universe.system() already owns a bounded native cache, while display names
 * are localized at mapping time and must remain locale-safe.
 */
export function decorateNativeSystemPopulation(
  system: SystemDefinition,
  mode: NativeSystemPopulationMode,
): SystemDefinition {
  if (mode === "authored") return decorateAuthoredSystem(system);
  if (mode === "generated") return decorateGeneratedSystem(system);

  const catalogGenerated = mode === "catalog-generated";
  const systemPopulation = observedPopulationMetadata({
    kind: "system",
    stableSeed: system.seed,
    capability: "system-only",
    tags: [
      "native",
      catalogGenerated ? "catalog-star-generated-worlds" : "solar-system",
    ],
    observedFields: catalogGenerated
      ? ["id", "name", "star"]
      : ["id", "name", "star", "planets"],
    inferredFields: catalogGenerated ? ["planets"] : [],
  });

  return {
    ...system,
    population: systemPopulation,
    star: {
      ...system.star,
      population: observedPopulationMetadata({
        kind: "star",
        stableSeed: system.star.seed,
        parentId: system.id,
        capability: "system-only",
        tags: [
          "native",
          "observed-star",
          `spectral:${system.star.spectralType}`,
        ],
        observedFields: [
          "name",
          "spectralType",
          "temperatureK",
          "massSolar",
          "radiusSolar",
          "luminositySolar",
        ],
      }),
    },
    planets: system.planets.map((planet) => {
      const capability = populationCapabilityForArchetype(planet.archetype);
      const rarity = populationRarityForSeed(planet.seed);

      if (catalogGenerated) {
        return {
          ...planet,
          population: metadata({
            kind: "world",
            provenance: "generated",
            stableSeed: planet.seed,
            parentId: system.id,
            capability,
            rarity: rarity.rarity,
            rarityScore: rarity.score,
            tags: [
              "native",
              "generated",
              "world",
              `archetype:${planet.archetype}`,
              `capability:${capability}`,
              ...(planet.hasRings ? ["ringed"] : []),
            ],
            generatedName: true,
          }),
          moons: planet.moons.map((moon) => ({
            ...moon,
            population: metadata({
              kind: "moon",
              provenance: "generated",
              stableSeed: moon.seed,
              parentId: planet.id,
              capability: "orbit-only",
              tags: ["native", "generated", "moon"],
              generatedName: true,
            }),
          })),
        };
      }

      return {
        ...planet,
        population: observedPopulationMetadata({
          kind: "world",
          stableSeed: planet.seed,
          parentId: system.id,
          capability,
          tags: [
            "native",
            "solar-system",
            "world",
            `archetype:${planet.archetype}`,
            `capability:${capability}`,
          ],
          // Keep native Solar physical/orbital values observed; product
          // archetype/capability and equilibrium temperature are derived.
          observedFields: [
            "name",
            "radiusEarth",
            "massEarth",
            "orbitAU",
            "orbitalPeriodYears",
          ],
          inferredFields: [
            "archetype",
            "capability",
            "equilibriumTempK",
          ],
        }),
        moons: planet.moons.map((moon) => ({
          ...moon,
          population: observedPopulationMetadata({
            kind: "moon",
            stableSeed: moon.seed,
            parentId: planet.id,
            capability: "orbit-only",
            tags: ["native", "solar-system", "moon"],
            observedFields: ["name", "radiusEarth", "orbitRadius"],
          }),
        })),
      };
    }),
  };
}

function validateMetadata(
  errors: string[],
  id: string,
  seed: string,
  expectedKind: PopulationObjectKind,
  expectedParent: string | undefined,
  population: PopulationMetadata | undefined,
) {
  if (!population) {
    errors.push(`${id}: missing population metadata`);
    return;
  }
  if (population.schemaVersion !== POPULATION_SCHEMA_VERSION) {
    errors.push(`${id}: population schema version mismatch`);
  }
  if (population.generatorVersion !== POPULATION_GENERATOR_VERSION) {
    errors.push(`${id}: population generator version mismatch`);
  }
  if (population.kind !== expectedKind) {
    errors.push(`${id}: expected kind ${expectedKind}, got ${population.kind}`);
  }
  if (population.stableSeed !== seed) {
    errors.push(`${id}: population stableSeed differs from entity seed`);
  }
  if (population.parentId !== expectedParent) {
    errors.push(
      `${id}: expected parent ${expectedParent ?? "<root>"}, got ${population.parentId ?? "<root>"}`,
    );
  }
}

export function validateSystemPopulation(
  system: SystemDefinition,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const addId = (id: string) => {
    if (ids.has(id)) errors.push(`duplicate canonical id: ${id}`);
    ids.add(id);
  };

  addId(system.id);
  validateMetadata(
    errors,
    system.id,
    system.seed,
    "system",
    undefined,
    system.population,
  );

  addId(system.star.id);
  validateMetadata(
    errors,
    system.star.id,
    system.star.seed,
    "star",
    system.id,
    system.star.population,
  );

  for (const planet of system.planets) {
    addId(planet.id);
    validateMetadata(
      errors,
      planet.id,
      planet.seed,
      "world",
      system.id,
      planet.population,
    );
    const giant =
      planet.archetype === "gas_giant" || planet.archetype === "ice_giant";
    if (
      giant &&
      planet.population &&
      planet.population.capability !== "orbit-only"
    ) {
      errors.push(`${planet.id}: giant world must be orbit-only`);
    }
    if (giant && planet.surfaceMode !== "none") {
      errors.push(`${planet.id}: giant world cannot expose Surface`);
    }

    for (const moon of planet.moons) {
      addId(moon.id);
      validateMetadata(
        errors,
        moon.id,
        moon.seed,
        "moon",
        planet.id,
        moon.population,
      );
    }
  }

  if (
    system.source === "procedural" &&
    system.population?.provenance !== "generated"
  ) {
    errors.push(`${system.id}: procedural system must have generated provenance`);
  }
  if (
    system.source === "catalog" &&
    system.population &&
    !["observed", "hybrid"].includes(system.population.provenance)
  ) {
    errors.push(`${system.id}: catalog system must preserve observed provenance`);
  }
  if (
    system.source === "hero" &&
    system.population?.provenance !== "authored"
  ) {
    errors.push(`${system.id}: hero system must have authored provenance`);
  }

  return errors;
}

export function assertSystemPopulation(system: SystemDefinition): void {
  const errors = validateSystemPopulation(system);
  if (errors.length > 0) {
    throw new Error(
      `Invalid population for ${system.id}:\n- ${errors.join("\n- ")}`,
    );
  }
}

export function systemPopulationFingerprint(system: SystemDefinition): number {
  const payload = {
    schemaVersion: POPULATION_SCHEMA_VERSION,
    generatorVersion: POPULATION_GENERATOR_VERSION,
    system: [system.id, system.seed, system.population?.provenance],
    star: [
      system.star.id,
      system.star.seed,
      system.star.spectralType,
      system.star.population?.provenance,
    ],
    planets: system.planets.map((planet) => ({
      id: planet.id,
      seed: planet.seed,
      archetype: planet.archetype,
      capability: planet.population?.capability,
      provenance: planet.population?.provenance,
      rarity: planet.population?.rarity,
      rings: planet.hasRings,
      moons: planet.moons.map((moon) => [
        moon.id,
        moon.seed,
        moon.population?.provenance,
      ]),
    })),
  };
  return hashSeed(JSON.stringify(payload));
}

export type PopulationCacheStats = {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
};

export class PopulationSystemCache<T> {
  private readonly entries = new Map<string, T>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(readonly capacity = POPULATION_SYSTEM_CACHE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("PopulationSystemCache capacity must be a positive integer");
    }
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): T {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  stats(): PopulationCacheStats {
    return {
      size: this.entries.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

export function populationSystemCacheKey(
  marker: Pick<
    GalaxyMarker,
    "id" | "seed" | "source" | "catalogId" | "nativeId"
  >,
): string {
  return [
    POPULATION_GENERATOR_VERSION,
    marker.source,
    marker.id,
    marker.seed,
    marker.catalogId ?? "",
    marker.nativeId ?? "",
  ].join("|");
}
