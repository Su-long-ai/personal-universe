import type { GalaxyMarker } from "../types";
import type { UniverseContentPlacement } from "../content";
import { normalizeQuery } from "../../../vendor/yeis/core/Universe";
import {
  HERO_SYSTEM_ID,
  loadYeisCore,
  type YeisCoreRuntime,
} from "./index";
import { markerForYeisStarId } from "./bridge";

export type UniverseNavigationKind =
  | "personal"
  | "featured"
  | "star"
  | "blackhole"
  | "landmark";

export interface UniverseNavigationDestination {
  id: string;
  kind: UniverseNavigationKind;
  title: string;
  detail: string;
  nativeId: string;
  markerId?: string;
  entryId?: string;
}

export interface UniverseNavigationFocusRequest {
  requestId: number;
  nativeId: string;
  title: string;
}

/**
 * Small English-facing subset of the pinned MIT YEIS Places list.
 * The stable refs come from src/ui/places.ts at e520568; the current product
 * shell owns presentation/copy while the astronomical lookup stays in YEIS.
 */
const FEATURED_STAR_REFS = [
  "Proxima Centauri",
  "Sirius",
  "Vega",
  "Betelgeuse",
  "Polaris",
] as const;

export async function loadUniverseNavigation(
  query: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): Promise<UniverseNavigationDestination[]> {
  const runtime = await loadYeisCore();
  const q = normalizeQuery(query);
  return q
    ? searchDestinations(runtime, q, placements, markers)
    : browseDestinations(runtime, placements, markers);
}

export async function navigationMarker(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): Promise<GalaxyMarker> {
  const runtime = await loadYeisCore();
  const existing =
    (destination.markerId
      ? markers.find((marker) => marker.id === destination.markerId)
      : undefined) ??
    markers.find((marker) => marker.nativeId === destination.nativeId);

  return existing ?? markerForYeisStarId(runtime, markers, destination.nativeId);
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
      detail: "FEATURED PLACE · " + formatDistanceLy(runtime.catalog.distancePc(hit)),
      nativeId,
    });
  }

  const sagA = runtime.universe.blackHole("b0");
  if (sagA) {
    out.push({
      id: "featured:b0",
      kind: "featured",
      title: sagA.entry.name,
      detail: "FEATURED PLACE · BLACK HOLE",
      nativeId: sagA.systemStarId,
    });
  }

  return dedupe(out).slice(0, 12);
}

function searchDestinations(
  runtime: YeisCoreRuntime,
  query: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  const out: UniverseNavigationDestination[] = [];

  for (const destination of personalDestinations(placements, markers)) {
    const placement = placements.find(
      (candidate) => candidate.entry.id === destination.entryId,
    );
    const haystack = normalizeQuery(
      [
        destination.title,
        destination.detail,
        ...(placement?.entry.tags ?? []),
      ].join(" "),
    );
    if (haystack.includes(query)) out.push(destination);
  }

  if (
    normalizeQuery("AURORA HELION HERO WORLD").includes(query) ||
    query.includes("aurora") ||
    query.includes("helion")
  ) {
    out.push({
      id: "featured:aurora",
      kind: "featured",
      title: "AURORA",
      detail: "HERO SYSTEM · PERSONAL UNIVERSE",
      nativeId: HERO_SYSTEM_ID,
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
      nativeId,
    });
  }

  for (const blackHole of runtime.universe.searchBlackHoles(query, 4)) {
    out.push({
      id: "blackhole:" + blackHole.entry.id,
      kind: "blackhole",
      title: blackHole.entry.name,
      detail: "BLACK HOLE · YEIS PLACE",
      nativeId: blackHole.systemStarId,
    });
  }

  for (const index of runtime.universe.searchLandmarks(query, 5)) {
    const landmark = runtime.universe.landmarks[index];
    if (!landmark?.systemId) continue;
    out.push({
      id: "landmark:" + landmark.def.id,
      kind: "landmark",
      title: landmark.def.name,
      detail: landmark.def.kind.toUpperCase() + " · YEIS LANDMARK",
      nativeId: landmark.systemId,
    });
  }

  return dedupe(out).slice(0, 12);
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
        nativeId,
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
        : destination.kind + ":" + destination.nativeId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDistanceLy(distancePc: number): string {
  const ly = distancePc * 3.26156;
  if (ly < 100) return ly.toFixed(1) + " LY";
  if (ly < 10_000) return ly.toFixed(0) + " LY";
  return (ly / 1000).toFixed(1) + " KLY";
}
