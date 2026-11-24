import type {
  PlanetArchetype,
  PlanetDefinition,
  PlanetSurfaceMode,
} from "../types";
import { hashSeed, SeededRng } from "../generation/seededRng";

export type SurfaceRgb = [number, number, number];

export type SurfaceContentPriority = "primary" | "secondary" | "ambient";

export interface SurfaceTerrainPalette {
  sand: SurfaceRgb;
  dune: SurfaceRgb;
  dryGrass: SurfaceRgb;
  grass: SurfaceRgb;
  forest: SurfaceRgb;
  jungle: SurfaceRgb;
  swamp: SurfaceRgb;
  tundra: SurfaceRgb;
  redRock: SurfaceRgb;
  redRock2: SurfaceRgb;
  rock: SurfaceRgb;
  rockHi: SurfaceRgb;
  snow: SurfaceRgb;
}

export interface SurfaceWorldRegion {
  id: string;
  name: string;
  center: [number, number];
  radius: number;
  elevationBias: number;
}

export interface SurfaceWorldLandmark {
  id: string;
  kind: "spire" | "ridge" | "basin" | "crater" | "grove" | "archive";
  name: string;
  position: [number, number];
  scale: number;
  prominence: number;
}

export interface SurfaceWorldPath {
  id: string;
  from: [number, number];
  to: [number, number];
  width: number;
}

export interface SurfaceContentAnchor {
  id: string;
  entryId: string;
  title: string;
  position: [number, number];
  landmarkId?: string;
  regionId?: string;
  cluster: number;
  priority: SurfaceContentPriority;
}

export interface SurfaceContentCluster {
  id: string;
  index: number;
  label: string;
  center: [number, number];
  anchorIds: string[];
  regionId?: string;
  landmarkId?: string;
  priority: SurfaceContentPriority;
}

export interface SurfaceWorldProfile {
  id: string;
  planetId: string;
  seed: number;
  authored: boolean;
  archetype: PlanetArchetype;
  biome: string;
  atmosphere: {
    zenith: string;
    horizon: string;
    fog: string;
    fogDensity: number;
  };
  lighting: {
    sunColor: SurfaceRgb;
    sunIntensity: number;
    sunAzimuth: number;
    sunElevation: number;
    skyAmbient: SurfaceRgb;
    groundBounce: SurfaceRgb;
  };
  terrain: {
    noiseSeed: number;
    scale: number;
    ridge: number;
    warp: number;
    persistence: number;
    lacunarity: number;
    heightScale: number;
    seaLevel: number;
    saturation: number;
    contrast: number;
    tint: SurfaceRgb;
    palette: SurfaceTerrainPalette;
  };
  accent: string;
  densities: {
    landmarks: number;
    content: number;
  };
  landing: [number, number];
  regions: SurfaceWorldRegion[];
  landmarks: SurfaceWorldLandmark[];
  paths: SurfaceWorldPath[];
  contentAnchors: SurfaceContentAnchor[];
  contentClusters: SurfaceContentCluster[];
}

const LANDING: [number, number] = [0.4, -5.4];

const BIOME_NAMES: Record<PlanetArchetype, readonly string[]> = {
  rocky: ["Stone Reach", "Basalt Shelf", "Dust Highlands"],
  temperate: ["Verdant Reach", "Cloudstep", "Mosslight Basin"],
  ocean: ["Azure Shelf", "Tidal Reach", "Pelagic Rim"],
  desert: ["Amber Expanse", "Glass Dunes", "Sunscar Plateau"],
  ice: ["Polar Shelf", "Blue Ice Reach", "Frostglass"],
  frozen: ["Permafrost Reach", "White Basin", "Coldstep"],
  lava: ["Ember Reach", "Cinder Shelf", "Magma Verge"],
  volcanic: ["Ashen Reach", "Caldera Rim", "Blackglass"],
  gas_giant: ["Cloud Deck"],
  ice_giant: ["Methane Cloud Deck"],
  alien: ["Violet Reach", "Iridescent Shelf", "Otherlight"],
};

const REGION_SUFFIXES = [
  "Landing",
  "Ridge",
  "Basin",
  "Reach",
  "Shelf",
  "Hollow",
] as const;

const LANDMARK_KINDS: readonly SurfaceWorldLandmark["kind"][] = [
  "spire",
  "ridge",
  "basin",
  "crater",
  "grove",
  "archive",
];

const SURFACE_CONTENT_PRIORITY_WEIGHT: Record<SurfaceContentPriority, number> = {
  primary: 3,
  secondary: 2,
  ambient: 1,
};

function surfaceContentPriority(entry: {
  featured?: boolean;
  importance?: number;
}): SurfaceContentPriority {
  if (entry.featured || (entry.importance ?? 0) >= 4) return "primary";
  if ((entry.importance ?? 0) >= 3) return "secondary";
  return "ambient";
}

export function rankSurfaceContentAnchors(
  anchors: readonly SurfaceContentAnchor[],
  focusedEntryId: string | null = null,
): SurfaceContentAnchor[] {
  return [...anchors].sort(
    (a, b) =>
      Number(b.entryId === focusedEntryId) -
        Number(a.entryId === focusedEntryId) ||
      SURFACE_CONTENT_PRIORITY_WEIGHT[b.priority] -
        SURFACE_CONTENT_PRIORITY_WEIGHT[a.priority] ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

export function rankSurfaceContentClusters(
  clusters: readonly SurfaceContentCluster[],
  focusedClusterIndex: number | null = null,
): SurfaceContentCluster[] {
  return [...clusters].sort(
    (a, b) =>
      Number(b.index === focusedClusterIndex) -
        Number(a.index === focusedClusterIndex) ||
      SURFACE_CONTENT_PRIORITY_WEIGHT[b.priority] -
        SURFACE_CONTENT_PRIORITY_WEIGHT[a.priority] ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
}

export function rankSurfaceWorldRegions(
  regions: readonly SurfaceWorldRegion[],
  focusedRegionId: string | null = null,
): SurfaceWorldRegion[] {
  return [...regions].sort(
    (a, b) =>
      Number(b.id === focusedRegionId) -
        Number(a.id === focusedRegionId) ||
      b.radius - a.radius ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function rankSurfaceWorldLandmarks(
  landmarks: readonly SurfaceWorldLandmark[],
  focusedLandmarkId: string | null = null,
): SurfaceWorldLandmark[] {
  return [...landmarks].sort(
    (a, b) =>
      Number(b.id === focusedLandmarkId) -
        Number(a.id === focusedLandmarkId) ||
      b.prominence - a.prominence ||
      b.scale - a.scale ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

function rgb(hex: string): SurfaceRgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function paletteFor(archetype: PlanetArchetype): {
  accent: string;
  zenith: string;
  horizon: string;
  fog: string;
  tint: SurfaceRgb;
  terrain: SurfaceTerrainPalette;
} {
  const palettes: Record<PlanetArchetype, {
    accent: string;
    zenith: string;
    horizon: string;
    fog: string;
    tint: SurfaceRgb;
    terrain: SurfaceTerrainPalette;
  }> = {
    ocean: {
      accent: "#6bdcff",
      zenith: "#020913",
      horizon: "#315b68",
      fog: "#102d38",
      tint: [0.58, 0.82, 0.93],
      terrain: terrainPalette(
        "#29483f", "#38594b", "#5e7152", "#315f4b", "#1d493d",
        "#173c38", "#284844", "#66808a", "#6f6557", "#504d48",
        "#414c50", "#718087", "#c8d8d7",
      ),
    },
    temperate: {
      accent: "#8de6b1",
      zenith: "#040b0c",
      horizon: "#56695d",
      fog: "#23352e",
      tint: [0.67, 0.84, 0.7],
      terrain: terrainPalette(
        "#5c5a3d", "#6f6845", "#66704a", "#315c3d", "#1f472f",
        "#173c2d", "#29443a", "#66706c", "#6d5b48", "#51483f",
        "#444947", "#747d78", "#d1d3c2",
      ),
    },
    desert: {
      accent: "#ffc477",
      zenith: "#100805",
      horizon: "#8c5f3e",
      fog: "#5c3f2c",
      tint: [0.96, 0.72, 0.5],
      terrain: terrainPalette(
        "#a87a49", "#8f5f36", "#806246", "#685239", "#4c4033",
        "#49382f", "#574438", "#8a7865", "#8a4d35", "#673c31",
        "#5b5048", "#9b8470", "#e3c79c",
      ),
    },
    ice: {
      accent: "#bcecff",
      zenith: "#020811",
      horizon: "#55778a",
      fog: "#395664",
      tint: [0.74, 0.9, 1],
      terrain: terrainPalette(
        "#8eb5c4", "#779eae", "#7fabb8", "#6e9aa7", "#5d8695",
        "#527a8b", "#557d88", "#8eb2bf", "#6e8490", "#5f737d",
        "#70838e", "#a9c2ca", "#edf7fa",
      ),
    },
    frozen: {
      accent: "#d3f3ff",
      zenith: "#03070d",
      horizon: "#657886",
      fog: "#485862",
      tint: [0.82, 0.9, 0.95],
      terrain: terrainPalette(
        "#a1b7bf", "#8fa7af", "#92a9af", "#7f999e", "#71898f",
        "#657f86", "#697e83", "#a2b6ba", "#77858a", "#69777c",
        "#78868b", "#b2c0c3", "#f1f5f4",
      ),
    },
    lava: {
      accent: "#ff7950",
      zenith: "#0d0201",
      horizon: "#6f2216",
      fog: "#35140f",
      tint: [0.92, 0.37, 0.19],
      terrain: terrainPalette(
        "#4d2118", "#3d1b17", "#4a211b", "#3c1c18", "#2b1816",
        "#311514", "#3a1917", "#4b3832", "#7c281b", "#591e18",
        "#302523", "#55403b", "#9c6c55",
      ),
    },
    volcanic: {
      accent: "#ff9b69",
      zenith: "#080505",
      horizon: "#60413a",
      fog: "#312623",
      tint: [0.72, 0.52, 0.43],
      terrain: terrainPalette(
        "#57433b", "#4c3934", "#54423b", "#453831", "#35302d",
        "#382c29", "#42312e", "#655a55", "#704136", "#56352f",
        "#3c3835", "#6e625a", "#b39a89",
      ),
    },
    alien: {
      accent: "#d0a4ff",
      zenith: "#080411",
      horizon: "#61517b",
      fog: "#312744",
      tint: [0.76, 0.59, 0.9],
      terrain: terrainPalette(
        "#60516f", "#554762", "#5f5a72", "#3f5d5f", "#314d54",
        "#2e4652", "#3d4c59", "#756f82", "#735067", "#5d4559",
        "#4b4657", "#817990", "#d1c2dd",
      ),
    },
    rocky: {
      accent: "#9fd4e7",
      zenith: "#030609",
      horizon: "#59645e",
      fog: "#303936",
      tint: [0.72, 0.78, 0.78],
      terrain: terrainPalette(
        "#5b5a50", "#515149", "#5a5b50", "#4b534b", "#3c4741",
        "#39443f", "#404b47", "#676d6c", "#65534a", "#514641",
        "#464a4b", "#737879", "#c3c7c4",
      ),
    },
    gas_giant: {
      accent: "#f1c28c",
      zenith: "#100b08",
      horizon: "#8a6f57",
      fog: "#5f4d3d",
      tint: [0.86, 0.7, 0.56],
      terrain: terrainPalette(
        "#8c735c", "#80664f", "#8a735b", "#77634e", "#675746",
        "#695643", "#725d49", "#927f6d", "#94654a", "#805740",
        "#695b50", "#a08a74", "#d8c5ad",
      ),
    },
    ice_giant: {
      accent: "#8cdcff",
      zenith: "#03101a",
      horizon: "#4e829a",
      fog: "#315e73",
      tint: [0.54, 0.81, 0.94],
      terrain: terrainPalette(
        "#557c8e", "#4b7082", "#537c8b", "#456c78", "#3b5d68",
        "#345866", "#3d6070", "#638696", "#567286", "#485f72",
        "#455e6a", "#7294a3", "#bad6df",
      ),
    },
  };
  return palettes[archetype];
}

function terrainPalette(
  sand: string,
  dune: string,
  dryGrass: string,
  grass: string,
  forest: string,
  jungle: string,
  swamp: string,
  tundra: string,
  redRock: string,
  redRock2: string,
  rock: string,
  rockHi: string,
  snow: string,
): SurfaceTerrainPalette {
  return {
    sand: rgb(sand),
    dune: rgb(dune),
    dryGrass: rgb(dryGrass),
    grass: rgb(grass),
    forest: rgb(forest),
    jungle: rgb(jungle),
    swamp: rgb(swamp),
    tundra: rgb(tundra),
    redRock: rgb(redRock),
    redRock2: rgb(redRock2),
    rock: rgb(rock),
    rockHi: rgb(rockHi),
    snow: rgb(snow),
  };
}

export function supportsSurfaceArchetype(archetype: PlanetArchetype): boolean {
  return archetype !== "gas_giant" && archetype !== "ice_giant";
}

export function surfaceModeForArchetype(
  archetype: PlanetArchetype,
): PlanetSurfaceMode {
  return supportsSurfaceArchetype(archetype) ? "surface-terrain" : "none";
}

function ringPosition(
  rng: SeededRng,
  minRadius: number,
  maxRadius: number,
  angleOffset = 0,
): [number, number] {
  const angle = rng.range(0, Math.PI * 2) + angleOffset;
  const radius = rng.range(minRadius, maxRadius);
  return [
    LANDING[0] + Math.cos(angle) * radius,
    LANDING[1] + Math.sin(angle) * radius,
  ];
}

export function buildSurfaceWorldProfile(
  planet: PlanetDefinition,
): SurfaceWorldProfile {
  const rng = new SeededRng(`${planet.seed}:surface-world:v3`);
  const palette = paletteFor(planet.archetype);
  const authored = Boolean(planet.heroKey);
  const biome = rng.pick(BIOME_NAMES[planet.archetype]);
  const densityMultiplier = authored ? 1.35 : 1;
  const landmarkCount = Math.round(
    rng.range(4, 7) * densityMultiplier,
  );
  const regionCount = authored ? 5 : rng.int(3, 4);
  const contentEntries = [...(planet.content ?? [])].sort((a, b) =>
    (a.placementKey ?? a.id).localeCompare(b.placementKey ?? b.id),
  );

  const regions: SurfaceWorldRegion[] = Array.from(
    { length: regionCount },
    (_, index) => {
      const local = rng.fork(`region:${index}`);
      const center =
        index === 0 ? LANDING : ringPosition(local, 6 + index, 12 + index * 2);
      return {
        id: `${planet.id}:surface:region:${index}`,
        name: `${biome} ${REGION_SUFFIXES[index % REGION_SUFFIXES.length]}`,
        center,
        radius: local.range(3.8, 7.4),
        elevationBias: local.range(-0.28, 0.42),
      };
    },
  );

  const landmarks: SurfaceWorldLandmark[] = Array.from(
    { length: landmarkCount },
    (_, index) => {
      const local = rng.fork(`landmark:${index}`);
      const region = regions[index % regions.length]!;
      const angle = local.range(0, Math.PI * 2);
      const radius = local.range(1.4, Math.max(2.2, region.radius * 0.72));
      const position: [number, number] = [
        region.center[0] + Math.cos(angle) * radius,
        region.center[1] + Math.sin(angle) * radius,
      ];
      const kind = local.pick(LANDMARK_KINDS);
      return {
        id: `${planet.id}:surface:landmark:${index}`,
        kind,
        name: `${biome} ${kind[0]!.toUpperCase()}${kind.slice(1)} ${index + 1}`,
        position,
        scale: local.range(0.7, authored ? 1.65 : 1.35),
        prominence: local.range(0.35, 1),
      };
    },
  );

  const pathTargets = landmarks
    .slice()
    .sort((a, b) => b.prominence - a.prominence)
    .slice(0, authored ? 5 : 3);
  const paths: SurfaceWorldPath[] = pathTargets.map((landmark, index) => ({
    id: `${planet.id}:surface:path:${index}`,
    from: index === 0 ? LANDING : pathTargets[index - 1]!.position,
    to: landmark.position,
    width: authored ? 0.18 : 0.13,
  }));

  const contentAnchors: SurfaceContentAnchor[] = contentEntries.map(
    (entry) => {
      const key = entry.placementKey?.trim() || entry.id;
      const local = new SeededRng(`${planet.seed}:surface-content:${key}`);
      const landmark =
        landmarks[
          hashSeed(`${planet.seed}:${key}:landmark`) %
            Math.max(1, landmarks.length)
        ];
      const regionIndex =
        hashSeed(`${planet.seed}:${key}:region`) %
        Math.max(1, regions.length);
      const region = regions[regionIndex];
      const base = landmark?.position ?? region?.center ?? LANDING;
      const angle = local.range(0, Math.PI * 2);
      const distance = local.range(0.55, 1.75);
      return {
        id: `${planet.id}:surface:content:${key}`,
        entryId: entry.id,
        title: entry.title,
        position: [
          base[0] + Math.cos(angle) * distance,
          base[1] + Math.sin(angle) * distance,
        ],
        ...(landmark ? { landmarkId: landmark.id } : {}),
        ...(region ? { regionId: region.id } : {}),
        cluster: regionIndex,
        priority: surfaceContentPriority(entry),
      };
    },
  );

  const contentClusters: SurfaceContentCluster[] = Array.from(
    new Set(contentAnchors.map((anchor) => anchor.cluster)),
  )
    .sort((a, b) => a - b)
    .map((clusterIndex) => {
      const anchors = rankSurfaceContentAnchors(
        contentAnchors.filter((anchor) => anchor.cluster === clusterIndex),
      );
      const lead = anchors[0]!;
      const region = regions[clusterIndex];
      const clusterLandmark = landmarks
        .filter((_, index) => index % regions.length === clusterIndex)
        .sort(
          (a, b) =>
            b.prominence - a.prominence || a.id.localeCompare(b.id),
        )[0];

      return {
        id: `${planet.id}:surface:cluster:${clusterIndex}`,
        index: clusterIndex,
        label: region?.name ?? biome,
        center: region?.center ?? LANDING,
        anchorIds: anchors.map((anchor) => anchor.id),
        ...(region ? { regionId: region.id } : {}),
        ...(clusterLandmark ? { landmarkId: clusterLandmark.id } : {}),
        priority: lead.priority,
      };
    });

  const terrainRng = rng.fork("terrain");
  const lightRng = rng.fork("light");
  const rugged =
    planet.archetype === "lava" ||
    planet.archetype === "volcanic" ||
    planet.archetype === "rocky";

  return {
    id: `surface:${hashSeed(`${planet.seed}:surface-world:v3`).toString(36)}`,
    planetId: planet.id,
    seed: hashSeed(`${planet.seed}:surface-terrain`),
    authored,
    archetype: planet.archetype,
    biome,
    atmosphere: {
      zenith: palette.zenith,
      horizon: palette.horizon,
      fog: palette.fog,
      fogDensity: terrainRng.range(0.0018, 0.0031),
    },
    lighting: {
      sunColor:
        planet.archetype === "ice" || planet.archetype === "frozen"
          ? [0.78, 0.9, 1]
          : planet.archetype === "lava"
            ? [1, 0.42, 0.2]
            : [1, 0.7, 0.45],
      sunIntensity: lightRng.range(1.18, authored ? 1.72 : 1.58),
      sunAzimuth: lightRng.range(110, 190),
      sunElevation: lightRng.range(11, 24),
      skyAmbient: rgb(palette.fog).map((value) =>
        Math.min(0.25, value * 0.36),
      ) as SurfaceRgb,
      groundBounce: rgb(palette.horizon).map((value) =>
        Math.min(0.14, value * 0.18),
      ) as SurfaceRgb,
    },
    terrain: {
      noiseSeed: hashSeed(`${planet.seed}:surface-noise`),
      scale: terrainRng.range(0.021, 0.034),
      ridge: rugged
        ? terrainRng.range(0.72, 0.9)
        : terrainRng.range(0.45, 0.72),
      warp: terrainRng.range(0.18, authored ? 0.42 : 0.36),
      persistence: terrainRng.range(0.49, 0.58),
      lacunarity: terrainRng.range(1.92, 2.18),
      heightScale: terrainRng.range(
        planet.archetype === "ocean" ? 22 : 27,
        rugged ? 44 : 37,
      ),
      seaLevel:
        planet.archetype === "ocean"
          ? -9
          : planet.archetype === "ice"
            ? -15
            : -20,
      saturation: terrainRng.range(0.62, 0.8),
      contrast: terrainRng.range(1.08, 1.22),
      tint: palette.tint,
      palette: palette.terrain,
    },
    accent: palette.accent,
    densities: {
      landmarks: landmarkCount,
      content: contentEntries.length,
    },
    landing: LANDING,
    regions,
    landmarks,
    paths,
    contentAnchors,
    contentClusters,
  };
}
