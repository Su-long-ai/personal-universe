import type { GalaxyMarker } from "../types";
import type { UniverseContentPlacement } from "../content";
import type { YeisCoreRuntime } from "./index";
import { markerForYeisStarId } from "./bridge";

export type UniverseNavigationKind =
  | "personal"
  | "featured"
  | "body"
  | "star"
  | "blackhole"
  | "landmark"
  | "galaxy";

export type UniverseNavigationGroup =
  | "personal"
  | "worlds"
  | "stars"
  | "blackholes"
  | "landmarks"
  | "galaxies";

export type UniverseNavigationTarget =
  | { kind: "star"; nativeId: string }
  | { kind: "body"; nativeId: string; bodyId: string }
  | { kind: "blackhole"; id: string }
  | { kind: "galaxy"; index: number }
  | { kind: "landmark"; index: number };

export interface UniverseNavigationDestination {
  id: string;
  kind: UniverseNavigationKind;
  group: UniverseNavigationGroup;
  title: string;
  detail: string;
  target: UniverseNavigationTarget;
  markerId?: string;
  entryId?: string;
}

export interface UniverseNavigationCameraRequest {
  requestId: number;
  mode: "locate" | "travel";
  target: UniverseNavigationTarget;
  title: string;
}

/**
 * Refs below are copied from the pinned MIT YEIS src/ui/places.ts at
 * e520568. Personal Universe derives display text from the active YEIS model
 * and intentionally omits the Solar-System body/spacecraft group from browse:
 * those objects are not first-class in the current R3F system renderer.
 */
const CURATED_STAR_REFS = [
  "Proxima Centauri",
  "Rigil Kentaurus",
  "Sirius",
  "Vega",
  "Betelgeuse",
  "Rigel",
  "Polaris",
  "Aldebaran",
  "Antares",
  "Deneb",
] as const;

const CURATED_BLACK_HOLE_REFS = [
  "b0",
  "cygx1",
  "b2",
  "b3",
  "b4",
  "b1",
  "m31star",
  "lmcx1",
  "m33x7",
  "cenastar",
] as const;

const CURATED_LANDMARK_REFS = [
  "l-crabpsr",
  "l-vela",
  "l-b1919",
  "l-lich",
  "l-j1748",
  "l-hulsetaylor",
  "l-geminga",
  "l-j0437",
  "l-sgr1806",
  "l-m42",
  "l-pleiades",
  "l-carina",
  "l-m1",
  "l-omegacen",
  "l-30dor",
  "l-r136a1",
  "l-sn1987a",
  "l-g1",
  "l-m31v1",
  "l-ngc604",
] as const;

const CURATED_GALAXY_REFS = [
  { ref: 0, title: "Milky Way" },
  { ref: "Büyük Macellan", title: "Large Magellanic Cloud" },
  { ref: "Küçük Macellan", title: "Small Magellanic Cloud" },
  { ref: "Andromeda", title: "Andromeda (M31)" },
  { ref: "Üçgen", title: "Triangulum (M33)" },
  { ref: "Centaurus A", title: "Centaurus A" },
  { ref: "Girdap", title: "Whirlpool (M51)" },
  { ref: "Fırıldak (M101)", title: "Pinwheel (M101)" },
  { ref: "Sombrero", title: "Sombrero (M104)" },
  { ref: "M87", title: "Virgo A (M87)" },
  { ref: "Antenler", title: "Antennae Galaxies" },
] as const;

export async function loadUniverseNavigation(
  query: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): Promise<UniverseNavigationDestination[]> {
  const [{ loadYeisCore }, { normalizeQuery }] = await Promise.all([
    import("./index"),
    import("../../../vendor/yeis/core/Universe"),
  ]);
  const runtime = await loadYeisCore();
  const q = normalizeQuery(query);
  const destinations = q
    ? searchDestinations(runtime, q, placements, markers, normalizeQuery)
    : browseDestinations(runtime, placements, markers);

  return orderDestinations(destinations, q, normalizeQuery);
}

export async function navigationMarker(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): Promise<GalaxyMarker> {
  const nativeId =
    destination.target.kind === "star" || destination.target.kind === "body"
      ? destination.target.nativeId
      : null;

  if (!nativeId) {
    throw new Error(
      `Navigation target ${destination.id} is spatial, not a star/system target`,
    );
  }

  const { loadYeisCore } = await import("./index");
  const runtime = await loadYeisCore();
  const existing =
    (destination.markerId
      ? markers.find((marker) => marker.id === destination.markerId)
      : undefined) ??
    markers.find((marker) => marker.nativeId === nativeId);

  return existing ?? markerForYeisStarId(runtime, markers, nativeId);
}

function browseDestinations(
  runtime: YeisCoreRuntime,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  const out = personalDestinations(placements, markers);

  for (const ref of CURATED_STAR_REFS) {
    const hit = runtime.catalog.search(ref, 1)[0];
    if (hit === undefined) continue;
    const nativeId = "c" + hit;
    out.push({
      id: "featured:" + nativeId,
      kind: "featured",
      group: "stars",
      title: runtime.catalog.nameOf(hit),
      detail:
        "FEATURED STAR · " +
        formatDistanceLy(runtime.catalog.distancePc(hit)),
      target: { kind: "star", nativeId },
    });
  }

  for (const ref of CURATED_BLACK_HOLE_REFS) {
    const blackHole = runtime.universe.blackHole(ref);
    if (!blackHole) continue;
    out.push({
      id: "featured:blackhole:" + ref,
      kind: "featured",
      group: "blackholes",
      title: blackHole.entry.name,
      detail: "FEATURED PLACE · BLACK HOLE",
      target: { kind: "blackhole", id: blackHole.entry.id },
    });
  }

  for (const id of CURATED_LANDMARK_REFS) {
    const index = runtime.universe.landmarks.findIndex(
      (landmark) => landmark.def.id === id,
    );
    if (index < 0) continue;
    out.push(landmarkDestination(runtime, index, "featured"));
  }

  for (const item of CURATED_GALAXY_REFS) {
    const index =
      typeof item.ref === "number"
        ? item.ref
        : runtime.universe.galaxies.search(item.ref, 1)[0];
    if (index === undefined || index < 0) continue;
    out.push(galaxyDestination(runtime, index, "featured", item.title));
  }

  return out;
}

function searchDestinations(
  runtime: YeisCoreRuntime,
  query: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
  normalize: (value: string) => string,
): UniverseNavigationDestination[] {
  const out: UniverseNavigationDestination[] = [];

  for (const destination of personalDestinations(placements, markers)) {
    const placement = placements.find(
      (candidate) => candidate.entry.id === destination.entryId,
    );
    const haystack = normalize(
      [
        destination.title,
        destination.detail,
        ...(placement?.entry.tags ?? []),
      ].join(" "),
    );
    if (haystack.includes(query)) out.push(destination);
  }

  if (
    normalize("AURORA HELION HERO WORLD").includes(query) ||
    query.includes("aurora") ||
    query.includes("helion")
  ) {
    out.push({
      id: "featured:aurora",
      kind: "featured",
      group: "stars",
      title: "AURORA",
      detail: "HERO SYSTEM · PERSONAL UNIVERSE",
      target: { kind: "star", nativeId: runtime.heroSystem.id },
    });
  }

  const currentStarId = runtime.universe.current.starId;
  const currentSystemName =
    runtime.universe.starName(currentStarId) + " System";
  for (const body of runtime.universe.bodies) {
    if (body.data.type !== "planet" && body.data.type !== "dwarf") continue;
    const haystack = normalize(
      [body.name, body.data.name, body.id, body.data.type].join(" "),
    );
    if (!haystack.includes(query)) continue;
    out.push({
      id: `body:${currentStarId}:${body.id}`,
      kind: "body",
      group: "worlds",
      title: body.name,
      detail: body.data.type.toUpperCase() + " · " + currentSystemName,
      target: {
        kind: "body",
        nativeId: currentStarId,
        bodyId: body.id,
      },
    });
  }

  for (const foreign of runtime.universe.searchForeignBodies(query, 8)) {
    if (foreign.body.type !== "planet" && foreign.body.type !== "dwarf") {
      continue;
    }
    out.push({
      id: `body:${foreign.starId}:${foreign.body.id}`,
      kind: "body",
      group: "worlds",
      title: foreign.name,
      detail:
        foreign.body.type.toUpperCase() +
        " · " +
        foreign.systemName,
      target: {
        kind: "body",
        nativeId: foreign.starId,
        bodyId: foreign.body.id,
      },
    });
  }

  for (const index of runtime.catalog.search(query, 8)) {
    const nativeId = "c" + index;
    const info = runtime.catalog.info(index);
    out.push({
      id: "star:" + nativeId,
      kind: "star",
      group: "stars",
      title: info.name,
      detail:
        (info.catalogSpectral || info.spectral || "STAR") +
        " · " +
        formatDistanceLy(info.distancePc),
      target: { kind: "star", nativeId },
    });
  }

  for (const blackHole of runtime.universe.searchBlackHoles(query, 4)) {
    out.push({
      id: "blackhole:" + blackHole.entry.id,
      kind: "blackhole",
      group: "blackholes",
      title: blackHole.entry.name,
      detail: "BLACK HOLE · YEIS PLACE",
      target: { kind: "blackhole", id: blackHole.entry.id },
    });
  }

  for (const index of runtime.universe.searchLandmarks(query, 6)) {
    out.push(landmarkDestination(runtime, index));
  }

  for (const index of runtime.universe.galaxies.search(query, 6)) {
    out.push(galaxyDestination(runtime, index));
  }

  return out;
}

function galaxyDestination(
  runtime: YeisCoreRuntime,
  index: number,
  kind: UniverseNavigationKind = "galaxy",
  title?: string,
): UniverseNavigationDestination {
  const galaxies = runtime.universe.galaxies;
  const distancePc = Math.hypot(
    galaxies.positions[index * 3],
    galaxies.positions[index * 3 + 1],
    galaxies.positions[index * 3 + 2],
  );
  return {
    id: "galaxy:" + index,
    kind,
    group: "galaxies",
    title: title ?? galaxies.name(index),
    detail:
      "GALAXY · " +
      (index === 0 ? "HOME" : formatDistanceLy(distancePc)),
    target: { kind: "galaxy", index },
  };
}

function landmarkDestination(
  runtime: YeisCoreRuntime,
  index: number,
  kind: UniverseNavigationKind = "landmark",
): UniverseNavigationDestination {
  const landmark = runtime.universe.landmarks[index];
  if (landmark.systemId) {
    return {
      id: "landmark:" + landmark.def.id,
      kind,
      group: "landmarks",
      title: landmark.def.name,
      detail: landmark.def.kind.toUpperCase() + " · YEIS LANDMARK",
      target: { kind: "star", nativeId: landmark.systemId },
    };
  }

  return {
    id: "landmark:" + landmark.def.id,
    kind,
    group: "landmarks",
    title: landmark.def.name,
    detail: landmark.def.kind.toUpperCase() + " · DEEP-SKY PLACE",
    target: { kind: "landmark", index },
  };
}

function personalDestinations(
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));

  return placements.flatMap((placement) => {
    const marker = markerById.get(placement.markerId);
    const nativeId = placement.nativeId ?? marker?.nativeId;
    if (!nativeId) return [];

    return [
      {
        id: "personal:" + placement.entry.id,
        kind: "personal" as const,
        group: "personal" as const,
        title: placement.entry.title,
        detail:
          placement.entry.kind.toUpperCase() +
          " · " +
          (marker?.name ?? nativeId),
        target: { kind: "star" as const, nativeId },
        markerId: placement.markerId,
        entryId: placement.entry.id,
      },
    ];
  });
}

const GROUP_ORDER: Record<UniverseNavigationGroup, number> = {
  personal: 0,
  worlds: 1,
  stars: 2,
  blackholes: 3,
  landmarks: 4,
  galaxies: 5,
};

function orderDestinations(
  destinations: UniverseNavigationDestination[],
  query: string,
  normalize: (value: string) => string,
): UniverseNavigationDestination[] {
  const ranked = dedupe(destinations).map((destination, sourceIndex) => ({
    destination,
    sourceIndex,
    matchRank: query ? destinationMatchRank(destination, query, normalize) : 0,
  }));

  ranked.sort((a, b) => {
    const groupDelta =
      GROUP_ORDER[a.destination.group] - GROUP_ORDER[b.destination.group];
    if (groupDelta !== 0) return groupDelta;

    const rankDelta = a.matchRank - b.matchRank;
    if (rankDelta !== 0) return rankDelta;

    return a.sourceIndex - b.sourceIndex;
  });

  return ranked.map(({ destination }) => destination).slice(0, query ? 24 : 72);
}

function destinationMatchRank(
  destination: UniverseNavigationDestination,
  query: string,
  normalize: (value: string) => string,
): number {
  const title = normalize(destination.title);
  const detail = normalize(destination.detail);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.split(/\s+/).some((token) => token.startsWith(query))) return 2;
  if (title.includes(query)) return 3;
  if (detail.startsWith(query)) return 4;
  if (detail.includes(query)) return 5;
  return 6;
}

function dedupe(
  destinations: UniverseNavigationDestination[],
): UniverseNavigationDestination[] {
  const seen = new Set<string>();
  return destinations.filter((destination) => {
    const key =
      destination.kind === "personal"
        ? destination.id
        : targetKey(destination.target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetKey(target: UniverseNavigationTarget): string {
  if (target.kind === "star") return "star:" + target.nativeId;
  if (target.kind === "body") {
    return "body:" + target.nativeId + ":" + target.bodyId;
  }
  if (target.kind === "blackhole") return "blackhole:" + target.id;
  return target.kind + ":" + target.index;
}

function formatDistanceLy(distancePc: number): string {
  const ly = distancePc * 3.26156;
  if (ly < 100) return ly.toFixed(1) + " LY";
  if (ly < 10_000) return ly.toFixed(0) + " LY";
  if (ly < 1_000_000) return (ly / 1000).toFixed(1) + " KLY";
  return (ly / 1_000_000).toFixed(2) + " MLY";
}
