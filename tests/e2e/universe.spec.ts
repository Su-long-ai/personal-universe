import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  observeRuntime,
  positiveDataset,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

test("default YEIS boots with native galaxy and personal signals", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  const initialRequests = new Set<string>();
  const initialScripts = new Set<string>();

  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4321/")) return;
    const type = request.resourceType();
    if (!["document", "script", "stylesheet", "fetch", "xhr"].includes(type)) return;
    const parsed = new URL(url);
    initialRequests.add(`${type}:${parsed.pathname}`);
    if (type === "script") initialScripts.add(parsed.pathname);
  });

  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await expect
    .poll(
      async () =>
        page
          .locator("html")
          .getAttribute("data-yeis-landmark-photos-complete"),
      { timeout: 20_000 },
    )
    .toBe("1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-requested",
    "15",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-loaded",
    "15",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-failed",
    "0",
  );

  const content = await positiveDataset(page, "data-personal-content");
  const signals = await positiveDataset(page, "data-personal-signals");
  const overlay = await positiveDataset(page, "data-personal-signal-overlay");

  expect(content).toBeGreaterThan(0);
  expect(signals).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(0);
  expect(initialRequests.size).toBeLessThanOrEqual(80);
  expect(initialScripts.size).toBeLessThanOrEqual(40);

  mkdirSync("test-results", { recursive: true });
  const metrics = {
    initialCriticalRequests: initialRequests.size,
    initialScripts: initialScripts.size,
    personalContent: content,
    personalSignals: signals,
    personalSignalOverlay: overlay,
  };
  writeFileSync(
    "test-results/runtime-metrics.json",
    JSON.stringify(metrics, null, 2) + "\n",
  );
  writeFileSync(
    "test-results/runtime-metrics.md",
    [
      "## Browser runtime metrics",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      `| Initial document/script/style/fetch/xhr requests | ${initialRequests.size} |`,
      `| Initial JS requests | ${initialScripts.size} |`,
      `| Personal content entries | ${content} |`,
      `| Personal signals | ${signals} |`,
      `| Personal signal overlay points | ${overlay} |`,
      "",
    ].join("\n"),
  );

  await testInfo.attach("runtime-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
  await runtime.assertClean(testInfo);
});

test("v2 query remains a healthy rollback path", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?engine=v2&freeze=1");

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-engine",
    "v2",
  );
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.locator(".hero-copy")).toBeVisible();
  await runtime.assertClean(testInfo);
});

test("personal signal deep link reaches system and world content", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const targets = await page
    .locator("html")
    .getAttribute("data-personal-signal-targets");
  const target = targets
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  expect(target, "page should expose an actual personal signal target").toBeTruthy();

  await page.goto(
    `/?phase=system&star=${encodeURIComponent(target!)}&freeze=1`,
  );
  await waitForYeisEngine(page);
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(page.locator(".content-signal-card")).toBeVisible();

  await page.goto(
    `/?phase=orbit&star=${encodeURIComponent(target!)}&freeze=1`,
  );
  await waitForYeisEngine(page);
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
  await expect(page.locator(".world-content-card")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("blocking YEIS stars.bin exercises the real v2 fallback", async ({
  page,
}, testInfo) => {
  const stars = /\/vendor\/yeis\/data\/stars\.bin(?:\?|$)/;
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [
      /^\[YEIS-BRIDGE\] FAILED; retaining V2 fallback/,
      /^\[YEIS-NATIVE-GALAXY\] FAILED/,
      /^Failed to load resource: net::ERR_FAILED$/,
    ],
    allowFailedRequests: [stars],
  });

  await page.route(stars, async (route) => {
    await route.abort("failed");
  });
  await page.goto("/?freeze=1");

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-engine",
    "v2-fallback",
  );
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.locator(".hero-copy")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("observed NASA exoplanet Search opens the exact observed world", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Gliese 12 b");

  const exoplanet = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-exoplanet") })
    .filter({ hasText: "Gliese 12 b" })
    .first();
  await expect(exoplanet).toBeVisible();
  await exoplanet.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Gliese 12 b/)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^exoplanet:/);
  expect(url.searchParams.get("body")).toBe(
    "catalog:Gliese 12:Gliese 12 b",
  );

  await runtime.assertClean(testInfo);
});

test("black-hole Search preserves exact native travel identity", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Cygnus X-1");

  const blackHole = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-blackhole") })
    .first();
  await expect(blackHole).toBeVisible();
  await blackHole.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^blackhole:/);

  const exactTarget = await html.getAttribute(
    "data-universe-navigation-target",
  );
  expect(exactTarget).toBeTruthy();
  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === exactTarget || complete === exactTarget;
    })
    .toBe(true);

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^blackhole:/);
  expect(url.searchParams.get("phase")).toBeNull();
  await expect(page.locator(".navigation-failure-notice")).toHaveCount(0);
  expect(
    await html.getAttribute("data-universe-navigation-error"),
  ).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Search keyboard navigation and Places destination both navigate", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Personal Universe");
  await expect
    .poll(async () =>
      Number(
        (await page
          .locator("html")
          .getAttribute("data-universe-navigator-results")) ?? "0",
      ),
    )
    .toBeGreaterThan(0);

  await search.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  const personalWorld = page.locator(".world-content-card");
  await expect(personalWorld).toBeVisible();
  await expect(personalWorld).toContainText("Personal Universe");
  const personalTarget = await page
    .locator("html")
    .getAttribute("data-universe-navigation-target");
  expect(personalTarget).toBeTruthy();

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  await expect(dialog).toBeVisible();
  const featured = page.locator(".navigator-result-row", {
    has: page.locator(".kind-featured"),
  }).first();
  await expect(featured).toBeVisible();
  await featured.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  const activeFeatured = await page
    .locator("html")
    .getAttribute("data-universe-active-destination");
  expect(activeFeatured).toMatch(/^featured:star:/);
  const placeTarget = await page
    .locator("html")
    .getAttribute("data-universe-navigation-target");
  expect(placeTarget).toBeTruthy();

  // The pinned-MIT English dictionaries and shareable body links should work
  // through the same navigation surface without a second identity layer.
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  await expect(dialog).toBeVisible();
  await search.fill("Earth");

  // Query edits synchronously invalidate the previous Places rows instead of
  // leaving them clickable during the async search debounce window.
  expect(
    await dialog
      .locator(".navigator-result-row")
      .filter({ has: page.locator(".kind-featured") })
      .count(),
  ).toBe(0);
  expect(
    await dialog.locator(".navigator-results").getAttribute("aria-busy"),
  ).toBe("true");

  const earth = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Earth" })
    .first();
  await expect(earth).toBeVisible();
  await expect(dialog).not.toContainText("Dünya");
  await earth.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();

  // Earth is represented in the product system model, so selecting it must
  // enter the same Approach contract used by canvas/deep-link world travel.
  // Native body camera fallback is reserved for YEIS bodies that do not map
  // to a PlanetDefinition (for example moons/spacecraft).
  const html = page.locator("html");
  const earthDestination = "body:c0/earth";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    earthDestination,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    "c0/earth",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  const sharedUrl = new URL(page.url());
  expect(sharedUrl.searchParams.get("destination")).toBe(earthDestination);
  expect(sharedUrl.searchParams.get("star")).toBe("c0");
  expect(sharedUrl.searchParams.get("body")).toBe("earth");
  expect(sharedUrl.searchParams.get("phase")).toBe("approach");
  expect(sharedUrl.searchParams.get("freeze")).toBe("1");

  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    earthDestination,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    "c0/earth",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  sharedUrl.searchParams.set("phase", "orbit");
  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("phase")).toBe("orbit");

  await page.getByRole("button", { name: "← RETURN TO SYSTEM" }).click();
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  const returnedSystemUrl = new URL(page.url());
  expect(returnedSystemUrl.searchParams.get("phase")).toBe("system");
  expect(returnedSystemUrl.searchParams.get("body")).toBeNull();
  expect(returnedSystemUrl.searchParams.get("destination")).toBeNull();

  await page.getByRole("button", { name: "← RETURN TO GALAXY" }).click();
  await waitForYeis(page);
  const returnedGalaxyUrl = new URL(page.url());
  expect(returnedGalaxyUrl.searchParams.get("phase")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("star")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("body")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("destination")).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Guided Journey auto advance starts only after the destination settles", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  const controls = page.locator(".universe-journey-controls");
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /Featured Journey/ }).click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(controls).not.toContainText("JOURNEY COMPLETE");
  await expect(controls).toContainText(
    "SETTLING · AUTO ADVANCE WAITS FOR ARRIVAL",
  );

  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 15_000 },
  );
  await expect(controls).toContainText(
    "DWELLING · AUTO ADVANCE AFTER ARRIVAL",
  );
  await expect(controls).not.toContainText("JOURNEY COMPLETE");

  // Dwell is measured from actual camera settlement, not from the earlier
  // React phase handoff. Keep most of the 6.5 s dwell observable before the
  // single-stop Journey is allowed to enter its finished state.
  await page.waitForTimeout(6_000);
  await expect(controls).not.toContainText("JOURNEY COMPLETE");
  await expect(controls).toContainText("JOURNEY COMPLETE", {
    timeout: 2_500,
  });
  await expect(html).toHaveAttribute(
    "data-universe-journey-complete",
    "Featured Journey",
  );

  await runtime.assertClean(testInfo);
});

test("Guided Journey completes visibly and competing navigation interrupts", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const navigatorButton = page.getByRole("button", {
    name: /SEARCH \/ PLACES/,
  });
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const controls = page.locator(".universe-journey-controls");
  const html = page.locator("html");

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  const featuredJourney = page.getByRole("button", {
    name: /Featured Journey/,
  });
  await expect(featuredJourney).toBeEnabled();
  await featuredJourney.click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(controls).toContainText("REDUCED MOTION · MANUAL ADVANCE");
  await expect(html).toHaveAttribute(
    "data-universe-journey",
    "Featured Journey",
  );
  await expect(page.locator(".world-content-card")).toBeVisible();

  await controls.getByRole("button", { name: "DONE" }).click();
  await expect(controls).toContainText("JOURNEY COMPLETE");
  await expect(controls).toContainText(
    "COMPLETE · NAVIGATION REMAINS AVAILABLE",
  );
  await expect(html).toHaveAttribute(
    "data-universe-journey-complete",
    "Featured Journey",
  );

  await controls.getByRole("button", { name: "CLOSE" }).click();
  await expect(controls).toBeHidden();
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /Featured Journey/ }).click();
  await expect(controls).toBeVisible();

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Earth");
  const earth = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Earth" })
    .first();
  await expect(earth).toBeVisible();
  await earth.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeHidden();
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");

  await runtime.assertClean(testInfo);
});

test("landmark Search shares the same travel destination contract", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Orion Nebula");

  const landmark = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-landmark") })
    .filter({ hasText: "Orion" })
    .first();
  await expect(landmark).toBeVisible();
  await landmark.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-active-destination",
    /landmark:/,
  );
  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^landmark:/);
  expect(url.searchParams.get("phase")).toBeNull();

  await runtime.assertClean(testInfo);
});
