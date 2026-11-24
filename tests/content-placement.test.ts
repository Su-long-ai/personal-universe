import assert from "node:assert/strict";
import test from "node:test";

import { placeUniverseContent } from "../src/lib/universe/content/placement.ts";
import type { GalaxyMarker } from "../src/lib/universe/types.ts";
import type { UniverseContentEntry } from "../src/lib/universe/content/types.ts";

function marker(index: number): GalaxyMarker {
  return {
    id: `yeis:c${index}`,
    name: `STAR ${index}`,
    seed: `yeis:c${index}`,
    source: "catalog",
    engine: "yeis",
    nativeId: `c${index}`,
    position: [index, 0, 0],
    spectralType: "G",
  };
}

function entry(
  id: string,
  overrides: Partial<UniverseContentEntry> = {},
): UniverseContentEntry {
  return {
    id,
    title: id,
    summary: id,
    kind: "project",
    status: "active",
    importance: 3,
    tags: [],
    featured: false,
    placement: "auto",
    ...overrides,
  };
}

function placementMap(
  entries: UniverseContentEntry[],
  markers: GalaxyMarker[],
): Map<string, string | undefined> {
  return new Map(
    placeUniverseContent(entries, markers).map((placement) => [
      placement.entry.id,
      placement.nativeId,
    ]),
  );
}

test("auto placement is independent of marker array order", () => {
  const markers = Array.from({ length: 64 }, (_, index) => marker(index + 1));
  const entries = Array.from({ length: 24 }, (_, index) =>
    entry(`entry-${String(index).padStart(2, "0")}`),
  );

  const forward = placementMap(entries, markers);
  const reversed = placementMap(entries, [...markers].reverse());

  assert.deepEqual(reversed, forward);
});

test("adding one star minimally remaps existing automatic signals", () => {
  const markers = Array.from({ length: 64 }, (_, index) => marker(index + 1));
  const entries = Array.from({ length: 24 }, (_, index) =>
    entry(`entry-${String(index).padStart(2, "0")}`),
  );

  const before = placementMap(entries, markers);
  const after = placementMap(entries, [...markers, marker(999)]);
  const moved = entries.filter(
    ({ id }) => before.get(id) !== after.get(id),
  );

  assert.equal(moved.length, 1);
});

test("100 automatic signals stay fully placed without a fixed-capacity ceiling", () => {
  const markers = Array.from({ length: 128 }, (_, index) => marker(index + 1));
  const entries = Array.from({ length: 100 }, (_, index) =>
    entry(`scale-${String(index).padStart(3, "0")}`),
  );

  const placements = placeUniverseContent(entries, markers);
  const destinations = new Set(
    placements.map((placement) => placement.nativeId),
  );

  assert.equal(placements.length, 100);
  assert.equal(destinations.size, 100);
});

test("placementKey survives content file/id renames", () => {
  const markers = Array.from({ length: 32 }, (_, index) => marker(index + 1));
  const before = placeUniverseContent(
    [entry("old/path", { placementKey: "stable-project" })],
    markers,
  );
  const after = placeUniverseContent(
    [entry("new/path", { placementKey: "stable-project" })],
    markers,
  );

  assert.equal(before[0]?.nativeId, after[0]?.nativeId);
  assert.equal(before[0]?.planetSlotSeed, after[0]?.planetSlotSeed);
});

test("pinned placement stays on the requested YEIS star", () => {
  const markers = Array.from({ length: 16 }, (_, index) => marker(index + 1));
  const placements = placeUniverseContent(
    [
      entry("pinned", {
        placement: "pinned",
        placementKey: "pinned",
        starId: "c12",
      }),
    ],
    [...markers].reverse(),
  );

  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.nativeId, "c12");
});

test("a missing non-YEIS pinned destination does not silently drift", () => {
  const markers = Array.from({ length: 8 }, (_, index) => marker(index + 1));
  const placements = placeUniverseContent(
    [
      entry("missing", {
        placement: "pinned",
        starId: "external-marker-that-does-not-exist",
      }),
    ],
    markers,
  );

  assert.equal(placements.length, 0);
});
