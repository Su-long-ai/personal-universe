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
  const autoMarkers = markers
    .filter(
      (marker) =>
        marker.engine === "yeis" &&
        marker.source !== "hero" &&
        Boolean(marker.nativeId),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const used = new Set<string>();
  const placements: UniverseContentPlacement[] = [];

  for (const entry of [...entries].sort(compareEntries)) {
    let marker: GalaxyMarker | undefined;

    if (entry.placement === "hero" && hero) {
      marker = hero;
    } else if (autoMarkers.length > 0) {
      const start = stableHash(entry.id) % autoMarkers.length;
      for (let offset = 0; offset < autoMarkers.length; offset += 1) {
        const candidate = autoMarkers[(start + offset) % autoMarkers.length];
        if (!used.has(candidate.id)) {
          marker = candidate;
          break;
        }
      }
      marker ??= autoMarkers[start];
    }

    if (!marker) continue;
    used.add(marker.id);
    placements.push({
      entry,
      markerId: marker.id,
      nativeId: marker.nativeId,
      planetSlotSeed: stableHash(`${entry.id}:planet`),
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

function compareEntries(a: UniverseContentEntry, b: UniverseContentEntry): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  return a.id.localeCompare(b.id);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
