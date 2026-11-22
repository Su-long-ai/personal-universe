import type { GalaxyMarker } from "../types";
import type { UniverseContentPlacement } from "../content";
import type { YeisCoreRuntime } from "./index";
import { markerForYeisStarId } from "./bridge";

export type UniverseNavigationKind =
  | "personal"
  | "featured"
  | "star"
  | "blackhole"
  | "landmark"
  | "galaxy";

export type UniverseNavigationTarget =
  | { kind: "star"; nativeId: string }
  | { kind: "galaxy"; index: number }
  | { kind: "landmark"; index: number };

export interface UniverseNavigationDestination {
  id: string;
  kind: UniverseNavigationKind;
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
 * English-facing subset of the pinned MIT YEIS Places list.
 * Stable refs and spatial semantics come from src/ui/places.ts / src/main.ts
 * at e520568; Personal Universe owns only product presentation.
 */
const FEATURED_STAR_REFS = [
  "Proxima Centauri",
  "Sirius",
  "Vega",
  "Betelgeuse",
  "Polaris",
] as const;

const FEATURED_GALAXY_REFS = [
  "Andromeda",
  "M33",
  "Büyük Macellan",
  "M87",
] as const;

const FEATURED_LANDMARK_REFS = [
  "l-m42",
  "l-pleiades",
  "l-m1",
  "l-omegacen",
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
  return q
    ? searchDestinations(runtime, q, placements, markers, normalizeQuery)
    : browseDestinations(runtime, placements, markers);
}

export async function navigationMarker(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): Promise<GalaxyMarker> {
  if (destination.target.kind !== "star") {
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
    markers.find((marker) => marker.nativeId === destination.target.nativeId);

  return (
    existing ??
    markerForYeisStarId(runtime, markers, destination.target.nativeId)
  );
}

function browseDestinations(
  runtime: YeisCoreRuntime,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  const out = personalDestinations(placements, markers);

  for (const ref of FEATURED_STAR_REFS) {
    const hit = runtime.catalog.search(ref, 1)[0];
    if (hit === undefined) continue;
    const nativeId = "c" + hit;
    out.push({
      id: "featured:" + nativeId,
      kind: "featured",
      title: runtime.catalog.nameOf(hit),
      detail:
        "FEATURED STAR · " +
        formatDistanceLy(runtime.catalog.distancePc(hit)),
      target: { kind: "star", nativeId },
    });
  }

  for (const ref of FEATURED_GALAXY_REFS) {
    const hit = runtime.universe.galaxies.search(ref, 1)[0];
    if (hit === undefined) continue;
    out.push(galaxyDestination(runtime, hit, "featured"));
  }

  for (const id of FEATURED_LANDMARK_REFS) {
    const index = runtime.universe.landmarks.findIndex(
      (landmark) => landmark.def.id === id,
    );
    if (index < 0) continue;
    out.push(landmarkDestination(runtime, index, "featured"));
  }

  const sagA = runtime.universe.blackHole("b0");
  if (sagA) {
    out.push({
      id: "featured:b0",
      kind: "featured",
      title: sagA.entry.name,
      detail: "FEATURED PLACE · BLACK HOLE",
      target: { kind: "star", nativeId: sagA.systemStarId },
    });
  }

  return dedupe(out).slice(0, 18);
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
      title: "AURORA",
      detail: "HERO SYSTEM · PERSONAL UNIVERSE",
      target: { kind: "star", nativeId: runtime.heroSystem.id },
    });
  }

  for (const index of runtime.catalog.search(query, 8)) {
    const nativeId = "c" + index;
    const info = runtime.catalog.info(index);
    out.push({
      id: "star:" + nativeId,
      kind: "star",
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
      title: blackHole.entry.name,
      detail: "BLACK HOLE · YEIS PLACE",
      target: { kind: "star", nativeId: blackHole.systemStarId },
    });
  }

  for (const index of runtime.universe.searchLandmarks(query, 6)) {
    out.push(landmarkDestination(runtime, index));
  }

  for (const index of runtime.universe.galaxies.search(query, 6)) {
    out.push(galaxyDestination(runtime, index));
  }

  return dedupe(out).slice(0, 16);
}

function galaxyDestination(
  runtime: YeisCoreRuntime,
  index: number,
  kind: UniverseNavigationKind = "galaxy",
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
    title: galaxies.name(index),
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
      title: landmark.def.name,
      detail: landmark.def.kind.toUpperCase() + " · YEIS LANDMARK",
      target: { kind: "star", nativeId: landmark.systemId },
    };
  }

  return {
    id: "landmark:" + landmark.def.id,
    kind,
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
  return target.kind + ":" + target.index;
}

function formatDistanceLy(distancePc: number): string {
  const ly = distancePc * 3.26156;
  if (ly < 100) return ly.toFixed(1) + " LY";
  if (ly < 10_000) return ly.toFixed(0) + " LY";
  if (ly < 1_000_000) return (ly / 1000).toFixed(1) + " KLY";
  return (ly / 1_000_000).toFixed(2) + " MLY";
}
