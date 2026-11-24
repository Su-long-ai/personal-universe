import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSurfaceWorldProfile,
  surfaceModeForArchetype,
} from "../src/lib/universe/surface/worldProfile.ts";
import type {
  PlanetArchetype,
  PlanetDefinition,
} from "../src/lib/universe/types.ts";
import type { UniverseContentEntry } from "../src/lib/universe/content/types.ts";

function content(id: string): UniverseContentEntry {
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
