import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSurfaceWorldProfile,
  rankSurfaceContentAnchors,
  surfaceModeForArchetype,
} from "../src/lib/universe/surface/worldProfile.ts";
import type {
  PlanetArchetype,
  PlanetDefinition,
} from "../src/lib/universe/types.ts";
import type { UniverseContentEntry } from "../src/lib/universe/content/types.ts";

function content(
  id: string,
  overrides: Partial<UniverseContentEntry> = {},
): UniverseContentEntry {
  return {
    id,
    title: id.toUpperCase(),
    summary: id,
    kind: "project",
    status: "active",
    importance: 3,
    tags: [],
    featured: false,
    placement: "auto",
    placementKey: `stable:${id}`,
    ...overrides,
  };
}

function planet(
  seed: string,
  archetype: PlanetArchetype = "temperate",
  overrides: Partial<PlanetDefinition> = {},
): PlanetDefinition {
  return {
    id: `planet:${seed}`,
    name: `WORLD ${seed}`,
    seed,
    archetype,
    radiusEarth: 1,
    massEarth: 1,
    equilibriumTempK: 288,
    orbitAU: 1,
    orbitalPeriodYears: 1,
    moons: [],
    hasRings: false,
    surfaceMode: surfaceModeForArchetype(archetype),
    ...overrides,
  };
}

test("surface profiles are exactly reproducible from stable planet identity", () => {
  const source = planet("repeatable", "ocean", {
    content: [content("alpha"), content("beta")],
  });

  assert.deepEqual(
    buildSurfaceWorldProfile(source),
    buildSurfaceWorldProfile(source),
  );
});

test("secondary worlds vary by seed without hand authored state", () => {
  const first = buildSurfaceWorldProfile(planet("world-a", "desert"));
  const second = buildSurfaceWorldProfile(planet("world-b", "desert"));

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.terrain.noiseSeed, second.terrain.noiseSeed);
  assert.notDeepEqual(first.landmarks, second.landmarks);
});

test("content anchors are stable when content input ordering changes", () => {
  const entries = [content("one"), content("two"), content("three")];
  const forward = buildSurfaceWorldProfile(
    planet("content-world", "temperate", { content: entries }),
  );
  const reverse = buildSurfaceWorldProfile(
    planet("content-world", "temperate", { content: [...entries].reverse() }),
  );

  assert.deepEqual(reverse.contentAnchors, forward.contentAnchors);
});

test("existing content anchors do not move when unrelated content is added", () => {
  const base = buildSurfaceWorldProfile(
    planet("insertion-stable", "temperate", {
      content: [content("alpha"), content("omega")],
    }),
  );
  const expanded = buildSurfaceWorldProfile(
    planet("insertion-stable", "temperate", {
      content: [content("alpha"), content("middle"), content("omega")],
    }),
  );

  for (const entryId of ["alpha", "omega"]) {
    const before = base.contentAnchors.find(
      (anchor) => anchor.entryId === entryId,
    );
    const after = expanded.contentAnchors.find(
      (anchor) => anchor.entryId === entryId,
    );
    assert.deepEqual(after, before);
  }
});

test("content cluster geometry stays stable when unrelated content is inserted", () => {
  const base = buildSurfaceWorldProfile(
    planet("cluster-insertion-stable", "temperate", {
      content: [content("alpha"), content("omega")],
    }),
  );
  const expanded = buildSurfaceWorldProfile(
    planet("cluster-insertion-stable", "temperate", {
      content: [
        content("alpha"),
        content("middle", { importance: 5 }),
        content("omega"),
      ],
    }),
  );

  for (const cluster of base.contentClusters) {
    const after = expanded.contentClusters.find(
      (candidate) => candidate.id === cluster.id,
    );
    assert.ok(after, `cluster ${cluster.id} should retain its spatial identity`);
    assert.deepEqual(after.center, cluster.center);
    assert.equal(after.label, cluster.label);
    assert.equal(after.regionId, cluster.regionId);
  }
});

test("surface content ranking preserves product importance without moving anchors", () => {
  const source = buildSurfaceWorldProfile(
    planet("priority-world", "temperate", {
      content: [
        content("ambient", { importance: 1 }),
        content("secondary", { importance: 3 }),
        content("featured", { importance: 2, featured: true }),
        content("important", { importance: 5 }),
      ],
    }),
  );

  const ranked = rankSurfaceContentAnchors(source.contentAnchors);
  assert.deepEqual(
    ranked.map((anchor) => anchor.priority),
    ["primary", "primary", "secondary", "ambient"],
  );
  assert.deepEqual(
    new Set(ranked.map((anchor) => anchor.id)),
    new Set(source.contentAnchors.map((anchor) => anchor.id)),
  );
});

test("content clusters cover every signal exactly once", () => {
  const source = buildSurfaceWorldProfile(
    planet("cluster-world", "desert", {
      content: [
        content("alpha"),
        content("beta", { importance: 5 }),
        content("gamma", { importance: 1 }),
        content("delta"),
        content("epsilon"),
      ],
    }),
  );

  const clustered = source.contentClusters.flatMap(
    (cluster) => cluster.anchorIds,
  );
  assert.deepEqual(
    [...clustered].sort(),
    source.contentAnchors.map((anchor) => anchor.id).sort(),
  );
  assert.ok(
    source.contentClusters.every(
      (cluster) =>
        cluster.anchorIds.length > 0 &&
        Number.isFinite(cluster.center[0]) &&
        Number.isFinite(cluster.center[1]),
    ),
  );
});

test("hero worlds use the same model but receive richer landmark density", () => {
  const filler = buildSurfaceWorldProfile(planet("same", "ocean"));
  const hero = buildSurfaceWorldProfile(
    planet("same", "ocean", { heroKey: "home" }),
  );

  assert.equal(filler.authored, false);
  assert.equal(hero.authored, true);
  assert.ok(hero.landmarks.length > filler.landmarks.length);
  assert.ok(hero.regions.length >= filler.regions.length);
});

test("only terrestrial archetypes become surface destinations", () => {
  assert.equal(surfaceModeForArchetype("temperate"), "surface-terrain");
  assert.equal(surfaceModeForArchetype("ocean"), "surface-terrain");
  assert.equal(surfaceModeForArchetype("rocky"), "surface-terrain");
  assert.equal(surfaceModeForArchetype("lava"), "surface-terrain");
  assert.equal(surfaceModeForArchetype("gas_giant"), "none");
  assert.equal(surfaceModeForArchetype("ice_giant"), "none");
});
