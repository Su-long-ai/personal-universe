import type {
  GalaxyMarker,
  SystemDefinition,
} from "../types";
import type {
  UniverseContentEntry,
  UniverseContentPlacement,
} from "./types";

export function placeUniverseContent(
  entries: UniverseContentEntry[],
  markers: GalaxyMarker[],
): UniverseContentPlacement[] {
  if (entries.length === 0 || markers.length === 0) return [];

  const hero = markers.find((marker) => marker.source === "hero");
  const hasYeisAuthority = markers.some((marker) => marker.engine === "yeis");
  const autoMarkers = markers.filter(
    (marker) =>
      marker.engine === "yeis" &&
      marker.source !== "hero" &&
      Boolean(marker.nativeId),
  );

  const used = new Set<string>();
  const placements: UniverseContentPlacement[] = [];

  for (const entry of [...entries].sort(compareEntries)) {
    const placementKey = contentPlacementKey(entry);
    let marker: GalaxyMarker | undefined;

    if (entry.placement === "hero") {
      marker = hero;
    } else if (entry.placement === "pinned") {
      marker = resolvePinnedMarker(entry, markers);

      // YEIS navigation can materialize native stars lazily even when they are
      // outside the intentionally small Galaxy marker sample. Keep the
      // authored Personal Signal alive as a virtual placement, then let the
      // existing markerForYeisStarId path resolve the real spatial target.
      if (
        !marker &&
        hasYeisAuthority &&
        entry.starId &&
        isLazyYeisNativeId(entry.starId)
      ) {
        placements.push({
          entry,
          markerId: `yeis:${entry.starId}`,
          nativeId: entry.starId,
          planetSlotSeed: stableHash(`${placementKey}:planet`),
        });
        continue;
      }
    } else {
      marker = chooseRendezvousMarker(placementKey, autoMarkers, used);
    }

    // Pinned non-YEIS marker IDs must never silently drift to another star.
    if (!marker) continue;

    used.add(markerIdentity(marker));
    placements.push({
      entry,
      markerId: marker.id,
      nativeId: marker.nativeId,
      planetSlotSeed: stableHash(`${placementKey}:planet`),
    });
  }

  return placements;
}

export function attachContentToSystem(
  system: SystemDefinition,
  placements: UniverseContentPlacement[],
): SystemDefinition {
  if (placements.length === 0) return system;

  const content = placements.map((placement) => placement.entry);
  if (system.planets.length === 0) {
    return { ...system, content };
  }

  const planets = system.planets.map((planet) => ({
    ...planet,
    content: planet.content ? [...planet.content] : [],
  }));

  for (const placement of placements) {
    const index = placement.planetSlotSeed % planets.length;
    planets[index].content = [
      ...(planets[index].content ?? []),
      placement.entry,
    ];
  }

  return {
    ...system,
    content,
    planets,
  };
}

export function placementsForMarker(
  placements: UniverseContentPlacement[],
  markerId: string,
): UniverseContentPlacement[] {
  return placements.filter((placement) => placement.markerId === markerId);
}

/**
 * Resolve one authored content placement by canonical or migration-era identity.
 * Legacy IDs are exact aliases only; the returned placement always retains the
 * canonical entry.id used by current Personal destinations.
 */
export function placementForContentReference(
  placements: readonly UniverseContentPlacement[],
  reference: string,
): UniverseContentPlacement | undefined {
  const entryId = reference.startsWith("personal:")
    ? reference.slice("personal:".length)
    : reference;
  if (!entryId) return undefined;

  return placements.find(
    (placement) =>
      placement.entry.id === entryId ||
      placement.entry.legacyIds?.includes(entryId),
  );
}

function resolvePinnedMarker(
  entry: UniverseContentEntry,
  markers: GalaxyMarker[],
): GalaxyMarker | undefined {
  if (!entry.starId) return undefined;
  return markers.find(
    (marker) =>
      marker.nativeId === entry.starId ||
      marker.id === entry.starId,
  );
}

function isLazyYeisNativeId(value: string): boolean {
  return value === "h-aurora" || /^c(?:0|[1-9]\d*)$/.test(value);
}

function chooseRendezvousMarker(
  key: string,
  markers: GalaxyMarker[],
  used: Set<string>,
): GalaxyMarker | undefined {
  let bestUnused: GalaxyMarker | undefined;
  let bestUnusedScore = -1;
  let bestAny: GalaxyMarker | undefined;
  let bestAnyScore = -1;

  for (const marker of markers) {
    const score = rendezvousScore(key, marker);

    if (
      score > bestAnyScore ||
      (score === bestAnyScore && compareMarkerIdentity(marker, bestAny) < 0)
    ) {
      bestAny = marker;
      bestAnyScore = score;
    }

    if (used.has(markerIdentity(marker))) continue;

    if (
      score > bestUnusedScore ||
      (score === bestUnusedScore && compareMarkerIdentity(marker, bestUnused) < 0)
    ) {
      bestUnused = marker;
      bestUnusedScore = score;
    }
  }

  // Keep one signal per star while capacity exists. Once entries outnumber
  // eligible stars, reuse the HRW winner instead of inventing a second scheme.
  return bestUnused ?? bestAny;
}

function rendezvousScore(key: string, marker: GalaxyMarker): number {
  return stableHash(`${key}\u0000${markerIdentity(marker)}`);
}

function markerIdentity(marker: GalaxyMarker): string {
  return marker.nativeId ?? marker.id;
}

function compareMarkerIdentity(
  a: GalaxyMarker,
  b: GalaxyMarker | undefined,
): number {
  if (!b) return -1;
  return markerIdentity(a).localeCompare(markerIdentity(b));
}

function contentPlacementKey(entry: UniverseContentEntry): string {
  return entry.placementKey?.trim() || entry.id;
}

function compareEntries(a: UniverseContentEntry, b: UniverseContentEntry): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  return contentPlacementKey(a).localeCompare(contentPlacementKey(b));
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
