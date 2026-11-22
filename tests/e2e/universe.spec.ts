import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  observeRuntime,
  positiveDataset,
  waitForYeis,
} from "./support/runtime";

test("default YEIS boots with native galaxy and personal signals", async ({
  page,
}, testInfo) => {
  const runtime = observeRuntime(page);
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
  const runtime = observeRuntime(page);
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
  const runtime = observeRuntime(page);
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
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(page.locator(".content-signal-card")).toBeVisible();

  await page.goto(
    `/?phase=orbit&star=${encodeURIComponent(target!)}&freeze=1`,
  );
  await expect(page.locator(".world-content-card")).toBeVisible();
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("blocking YEIS stars.bin exercises the real v2 fallback", async ({
  page,
}, testInfo) => {
  const stars = /\/vendor\/yeis\/data\/stars\.bin(?:\?|$)/;
  const runtime = observeRuntime(page, {
    allowConsoleErrors: [
      /^\[YEIS-BRIDGE\] FAILED; retaining V2 fallback/,
      /^\[YEIS-NATIVE-GALAXY\] FAILED/,
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

test("Search keyboard navigation and Places destination both navigate", async ({
  page,
}, testInfo) => {
  const runtime = observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search universe" });
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
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(page.locator(".content-signal-card")).toBeVisible();
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
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  const placeTarget = await page
    .locator("html")
    .getAttribute("data-universe-navigation-target");
  expect(placeTarget).toBeTruthy();

  await runtime.assertClean(testInfo);
});
