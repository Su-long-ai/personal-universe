import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type * as Population from "../../src/lib/universe/generation/population";
import type { SystemDefinition } from "../../src/lib/universe/types";
import type * as Bridge from "../../src/lib/universe/yeis/bridge";
import { observeRuntime, waitForYeisEngine } from "./support/runtime";

let vite: ViteDevServer;
let population: typeof Population;
let bridge: typeof Bridge;
let runtime: Parameters<typeof Bridge.resolveYeisSystem>[0];
const estimatedStarFields = [
  "spectralType",
  "temperatureK",
  "massSolar",
  "radiusSolar",
  "luminositySolar",
];

test.beforeAll(async ({ baseURL }) => {
  // Let the product's Vite compiler expand pinned YEIS's import.meta.glob.
  // Use the real bundled HYG data and native Universe, not a second generator.
  vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  bridge = (await vite.ssrLoadModule(
    "/src/lib/universe/yeis/bridge.ts",
  )) as typeof Bridge;
  population = (await vite.ssrLoadModule(
    "/src/lib/universe/generation/population.ts",
  )) as typeof Population;
  const { StarCatalog } = (await vite.ssrLoadModule(
    "/src/vendor/yeis/data/StarCatalog.ts",
  )) as typeof import("../../src/vendor/yeis/data/StarCatalog");
  const { Universe } = (await vite.ssrLoadModule(
    "/src/vendor/yeis/core/Universe.ts",
  )) as typeof import("../../src/vendor/yeis/core/Universe");
  const catalog = await StarCatalog.load(new URL("vendor/yeis/", baseURL).href);
  const universe = new Universe(catalog);
  universe.registerExtraSystem({
    id: "h-aurora",
    name: "AURORA",
    positionPc: catalog.position(0),
    galaxy: 0,
    info: catalog.info(0),
    bodies: () => [universe.current.star.data],
  });
  runtime = { catalog, universe, heroSystem: universe.system("h-aurora") };
});

test.afterAll(async () => {
  await vite?.close();
});

function nativeSystem(starId: string): SystemDefinition {
  return bridge.resolveYeisSystem(runtime, bridge.markerForYeisStarId(runtime, [], starId));
}

test("native catalogue identity retains observations without promoting photometric estimates", () => {
  const index = bridge.buildYeisGalaxyIndex(runtime, []);
  const marker = index.markers.find(
    (candidate) =>
      candidate.name === "Sirius" && candidate.nativeId?.startsWith("c"),
  )!;
  expect(marker).toBeDefined();
  const directMarker = bridge.markerForYeisStarId(runtime, [], marker.nativeId!);
  for (const entry of [marker, directMarker]) {
    expect(entry.id).toBe(marker.id);
    expect(entry.seed).toBe(marker.seed);
    expect(entry.population?.provenance).toBe("hybrid");
    expect(entry.population?.observedFields).toContain("position");
    expect(entry.population?.inferredFields).toContain("spectralType");
    expect(entry.population?.observedFields).not.toContain("spectralType");
  }

  const system = bridge.resolveYeisSystem(runtime, marker);
  expect(system.id).toBe(`yeis-system:${marker.nativeId}`);
  expect(system.seed).toBe(marker.seed);
  expect(population.systemPopulationFingerprint(nativeSystem(marker.nativeId!))).toBe(
    population.systemPopulationFingerprint(system),
  );
  expect(population.validateSystemPopulation(system)).toEqual([]);
  expect(system.population?.provenance).toBe("hybrid");
  expect(system.star.name).toBe("Sirius");
  expect(system.star.population?.provenance).toBe("hybrid");
  expect(system.star.population?.observedFields).toEqual(["name"]);
  expect(system.star.population?.inferredFields).toEqual(
    [...estimatedStarFields].sort(),
  );
  expect(system.planets.length).toBeGreaterThan(0);
  expect(
    system.planets.every((planet) => planet.population?.provenance === "generated"),
  ).toBe(true);
});

test("native measured host keeps its explicit physical overrides observed", () => {
  const host = runtime.universe.blackHole("cygx1");
  expect(host).toBeDefined();
  expect(runtime.universe.hasMeasuredInfo(host!.systemStarId)).toBe(true);
  const system = nativeSystem(host!.systemStarId);
  expect(population.validateSystemPopulation(system)).toEqual([]);
  expect(system.population?.provenance).toBe("hybrid");
  expect(system.star.population?.provenance).toBe("observed");
  expect(system.star.population?.observedFields).toEqual(
    ["name", ...estimatedStarFields].sort(),
  );
  expect(system.star.population?.inferredFields).toEqual([]);
});

test("native Solar worlds distinguish computed periods from explicit periods", () => {
  const system = nativeSystem("c0");
  expect(population.validateSystemPopulation(system)).toEqual([]);
  expect(system.population?.provenance).toBe("observed");
  const earth = system.planets.find((planet) => planet.id === "yeis-planet:earth")!;
  expect(earth.population?.observedFields).toContain("orbitAU");
  expect(earth.population?.observedFields).not.toContain("orbitalPeriodYears");
  expect(earth.population?.inferredFields).toContain("orbitalPeriodYears");
  expect(earth.population?.capability).toBe("surface-capable");
  expect(
    earth.moons.map((moon) => [moon.id, moon.population?.parentId]),
  ).toContainEqual(["yeis-moon:moon", earth.id]);
  const ceres = system.planets.find((planet) => planet.id === "yeis-planet:ceres")!;
  expect(ceres.population?.observedFields).toContain("orbitalPeriodYears");
  expect(ceres.population?.inferredFields).not.toContain("orbitalPeriodYears");
  const jupiter = system.planets.find((planet) => planet.id === "yeis-planet:jupiter")!;
  expect(jupiter.population?.capability).toBe("orbit-only");
  expect(jupiter.surfaceMode).toBe("none");
});

test("native procedural identity and world capability remain deterministic across remapping", () => {
  const starId = "p0:0:4:2:1:5";
  const marker = bridge.markerForYeisStarId(runtime, [], starId);
  const first = nativeSystem(starId);
  const second = nativeSystem(starId);
  expect(marker.population?.provenance).toBe("generated");
  expect([
    first.population?.provenance,
    first.star.population?.provenance,
  ]).toEqual(["generated", "generated"]);
  expect(population.validateSystemPopulation(first)).toEqual([]);
  expect(first).not.toBe(second);
  expect(population.systemPopulationFingerprint(first)).toBe(
    population.systemPopulationFingerprint(second),
  );
  expect(first.planets.length).toBeGreaterThan(0);
  for (const planet of first.planets) {
    const giant =
      planet.archetype === "gas_giant" || planet.archetype === "ice_giant";
    expect(planet.population?.capability).toBe(
      giant ? "orbit-only" : "surface-capable",
    );
    expect(planet.population?.provenance).toBe("generated");
  }
});

test("default YEIS named catalogue deep link retains hybrid provenance and canonical route", async ({
  page,
}, testInfo) => {
  const [siriusIndex] = runtime.catalog.search("Sirius", 1);
  expect(siriusIndex).toBeDefined();
  const starId = `c${siriusIndex}`;
  const diagnostics = page.locator("html");
  const name = page.locator(".system-copy strong");
  const guard = await observeRuntime(page);
  await page.goto(`/?phase=system&star=${starId}&freeze=1`);
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass === 1) await page.reload();
    await waitForYeisEngine(page);
    await expect(diagnostics).toHaveAttribute(
      "data-universe-population-provenance",
      "hybrid",
    );
    await expect(name).toContainText("Sirius");
    expect(new URL(page.url()).searchParams.get("star")).toBe(starId);
  }
  await guard.assertClean(testInfo);
});
