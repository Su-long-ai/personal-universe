import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  observeRuntime,
  positiveDataset,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

async function openNavigator(page: Page) {
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".navigator-header span")).toHaveText(
    "PERSONAL UNIVERSE // SEARCH + PLACES",
  );
  return dialog;
}

async function wheelScale(
  page: Page,
  direction: "in" | "out",
) {
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );
  const html = page.locator("html");
  const startingPhase = await html.getAttribute(
    "data-universe-navigation-phase",
  );
  const continuousScaleDomain = [
    "galaxy",
    "system",
    "approach",
    "orbit",
    "atmosphere",
    "surface",
  ].includes(startingPhase ?? "");
  const deltaY = direction === "in" ? -120 : 120;

  // Galaxy through Surface now share one normalized product scale. Keep a
  // semantic-step helper for tests, but let each individual wheel sample move
  // only its real proportional distance. Galaxy 0->1 deliberately spans more
  // samples than the close-world intervals.
  await page.mouse.wheel(0, deltaY);
  if (continuousScaleDomain) {
    for (let sample = 0; sample < 7; sample += 1) {
      await page.waitForTimeout(80);
      const phaseAfterSample = await html.getAttribute(
        "data-universe-navigation-phase",
      );
      if (phaseAfterSample !== startingPhase) break;

      const blocked = await html.getAttribute("data-universe-scale-blocked");
      if (blocked) break;

      const position = Number(
        await html.getAttribute("data-universe-scale-position"),
      );
      if (!Number.isFinite(position)) break;

      const atAnchor =
        Math.abs(position - Math.round(position)) <= 0.01;
      if (atAnchor && startingPhase !== "galaxy") break;

      await page.mouse.wheel(0, deltaY);
    }
  }
  await page.waitForTimeout(320);
}

async function dispatchScaleWheel(page: Page, deltaY: number) {
  await page.locator("main.universe-root").evaluate(
    (root, value) => {
      root.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: value,
        }),
      );
    },
    deltaY,
  );
}

test("public page publishes canonical and social preview metadata", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const canonicalHref = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonicalHref).toBeTruthy();

  const pageUrl = new URL(page.url());
  const canonicalUrl = new URL(canonicalHref!);
  expect(canonicalUrl.pathname).toBe(pageUrl.pathname);
  expect(canonicalUrl.search).toBe("");

  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(description).toContain("projects, research, and artifacts");

  const ogTitle = await page
    .locator('meta[property="og:title"]')
    .getAttribute("content");
  const ogUrl = await page
    .locator('meta[property="og:url"]')
    .getAttribute("content");
  const ogImage = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  const twitterCard = await page
    .locator('meta[name="twitter:card"]')
    .getAttribute("content");
  const twitterImage = await page
    .locator('meta[name="twitter:image"]')
    .getAttribute("content");

  expect(ogTitle).toBe("Personal Universe");
  expect(ogUrl).toBe(canonicalHref);
  expect(ogImage).toBeTruthy();
  expect(twitterCard).toBe("summary_large_image");
  expect(twitterImage).toBe(ogImage);

  const previewUrl = new URL(ogImage!);
  expect(previewUrl.pathname).toMatch(/\/social-preview\.png$/);

  const previewResponse = await page.request.get(previewUrl.pathname);
  expect(previewResponse.ok()).toBeTruthy();
  expect(previewResponse.headers()["content-type"]).toContain("image/png");
  expect((await previewResponse.body()).byteLength).toBeGreaterThan(100_000);

  await runtime.assertClean(testInfo);
});

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

  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-opening-motion",
    "frozen",
  );

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

test("System wheel approaches the focused planet before the Approach boundary", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await dispatchScaleWheel(page, -72);

  // The System renderer is still authoritative, but the same camera has
  // already moved 37.5% toward the focused planet. Renderer identity only
  // changes after the continuous coordinate reaches the Approach endpoint.
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.375",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-camera-segment",
    "system:approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-scale-frame",
    "ready",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-camera-settled",
    "system",
  );

  const radius = Number(
    await html.getAttribute("data-universe-system-scale-radius"),
  );
  const distance = Number(
    await html.getAttribute("data-universe-system-scale-distance"),
  );
  expect(radius).toBeGreaterThan(0);
  expect(distance).toBeGreaterThan(0);

  await dispatchScaleWheel(page, 72);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("wheel scale advances and reverses world layers without auto chaining", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  // Arrival alone must not auto-chain into orbit anymore.
  await page.waitForTimeout(420);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "orbit");
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "surface");

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "orbit");
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );

  await runtime.assertClean(testInfo);
});

test("close-world wheel moves the live camera before a semantic phase boundary", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -72);

  // Three eighths of the Approach -> Orbit interval: semantic identity has
  // not changed, but the one camera authority is already at the interpolated
  // position. This is the contract that the old threshold/phase ladder lacked.
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.375",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-camera-segment",
    "approach:orbit",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );

  await dispatchScaleWheel(page, 72);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("low-quality Surface retains the existing terrain fallback", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
    { timeout: 15_000 },
  );

  await runtime.assertClean(testInfo);
});

test("the first opening wheel always acquires a scale target", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "auto-orbit",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );
  await page.mouse.wheel(0, -120);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.250",
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-galaxy-scale-target"),
      { timeout: 10_000 },
    )
    .not.toBeNull();
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-blocked",
    "no-galaxy-focus",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "stopped",
  );

  await runtime.assertClean(testInfo);
});

test("manual galaxy takeover disables the opening soft focus", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-scale-soft-focus",
    "available",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.62;
  const y = box!.y + box!.height * 0.48;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 30, { steps: 6 });
  await page.mouse.up();

  await expect(html).toHaveAttribute(
    "data-universe-scale-soft-focus",
    "disabled",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "stopped",
  );

  await runtime.assertClean(testInfo);
});

test("continuous wheel coordinate crosses close-world boundaries without waiting for settlement", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Keep scrolling without waiting for authored shot settlement. Six
  // half-interval wheel samples traverse the continuous coordinate from
  // Approach (2) to Surface (5); there is no world-step queue anymore.
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 30_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("rapid reverse during transition supersedes stale camera completion", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  await page.mouse.wheel(0, -120);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );

  // Reverse the continuous coordinate before crossing the Orbit anchor.
  // The camera must return to the exact Approach anchor with no stale
  // intermediate completion winning afterward.
  await page.waitForTimeout(40);
  await page.mouse.wheel(0, 120);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute("data-universe-scale-index", "2");
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  // Give any stale intermediate rest/completion ample opportunity to arrive.
  await page.waitForTimeout(800);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );

  await runtime.assertClean(testInfo);
});

test("trackpad-like small deltas move the close-world coordinate continuously", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // A tiny trackpad sample now produces visible scale motion immediately;
  // it is not held behind a discrete threshold accumulator.
  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.083",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  // The coordinate itself survives an input pause. Continue the gesture until
  // the exact Orbit anchor (3.0) is reached.
  await page.waitForTimeout(600);
  for (let index = 0; index < 11; index += 1) {
    await dispatchScaleWheel(page, -16);
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "3.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("surface boundary stays settled and outward wheel returns all the way to galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "active",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-blocked",
    "surface-limit",
  );

  for (const phase of ["atmosphere", "orbit", "approach"] as const) {
    await wheelScale(page, "out");
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      phase,
    );
    await expect(html).not.toHaveAttribute(
      "data-universe-camera-settled",
      phase === "atmosphere" ? "surface" : phase === "orbit" ? "atmosphere" : "orbit",
    );
    await expect(html).toHaveAttribute(
      "data-universe-camera-settled",
      phase,
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-surface-terrain-lifecycle",
      "parked",
    );
  }

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute("data-universe-scale-index", "0");
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("reduced motion keeps continuous scale reversible and settled", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 8_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 5_000 },
  );

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 5_000 },
  );

  await runtime.assertClean(testInfo);
});

test("Search takeover freezes an in-flight continuous world scale coordinate", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Move halfway toward Orbit and open Search in the same browser task.
  // Search is a higher-priority authority: it freezes the coordinate where
  // the user left it instead of allowing hidden queued phase motion.
  await page.locator("main.universe-root").evaluate((root) => {
    root.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -120,
      }),
    );
    const searchButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("SEARCH / PLACES"),
    );
    if (!(searchButton instanceof HTMLButtonElement)) {
      throw new Error("Search button unavailable during scale takeover");
    }
    searchButton.click();
  });
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );

  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");
  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "navigator-open",
  );

  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("wheel enters a centered YEIS star focus without clicking", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=star:c0&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "star:c0",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "star:c0",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("Galaxy scale uses small wheel deltas as direct native LOD distance", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.042",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system",
    "h-aurora",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system-ready",
    "true",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system-overview",
    "approaching:h-aurora",
  );

  const firstRatio = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  expect(firstRatio).toBeGreaterThan(1);

  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.083",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeLessThan(firstRatio);

  await runtime.assertClean(testInfo);
});

test("Galaxy scale reverses the same native LOD path before System", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  const inwardRatio = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );

  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.250",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeGreaterThan(inwardRatio);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  await runtime.assertClean(testInfo);
});

test("Galaxy native LOD reaches the matched System endpoint only at scale one", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, -96);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-entry-view",
    "yeis-native",
    { timeout: 10_000 },
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  // The first outward sample crosses back into Galaxy at a proportional 0.75,
  // not through the legacy return jump.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("release scale trace is monotonic from Galaxy zero to Surface five and back", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const trace: Array<{
    direction: "in" | "out";
    position: number;
    phase: string | null;
    bridge: string | null;
    renderer: string | null;
  }> = [];

  const sample = async (direction: "in" | "out") => {
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    trace.push({
      direction,
      position,
      phase: await html.getAttribute("data-universe-navigation-phase"),
      bridge: await html.getAttribute("data-universe-galaxy-scale-bridge"),
      renderer:
        (await html.getAttribute("data-universe-world-renderer")) ??
        (await html.getAttribute("data-universe-system-renderer")) ??
        (await html.getAttribute("data-yeis-native-system")),
    });
    return position;
  };

  // Use one fixed physical sample size throughout. Nothing in the test asks
  // the product to jump to a semantic phase.
  let previous = 0;
  for (let index = 0; index < 18; index += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(100);
    const position = await sample("in");
    expect(position).toBeGreaterThanOrEqual(previous - 0.001);
    expect(position).toBeLessThanOrEqual(5.001);
    previous = position;
    if (position >= 4.999) break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );

  previous = 5;
  for (let index = 0; index < 24; index += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(100);
    const position = await sample("out");
    expect(position).toBeLessThanOrEqual(previous + 0.001);
    expect(position).toBeGreaterThanOrEqual(-0.001);
    previous = position;
    const phase = await html.getAttribute("data-universe-navigation-phase");
    if (position <= 0.001 && phase === "galaxy") break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-navigation-phase",
    "returning",
  );

  expect(trace.some((entry) => entry.position > 0 && entry.position < 1))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 1 && entry.position < 2))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 2 && entry.position < 3))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 3 && entry.position < 4))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 4 && entry.position < 5))
    .toBeTruthy();

  await testInfo.attach("continuous-scale-release-trace.json", {
    body: Buffer.from(JSON.stringify(trace, null, 2)),
    contentType: "application/json",
  });
  await runtime.assertClean(testInfo);
});

test("Search freezes and resumes a partial Galaxy scale path", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  const beforeSearch = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  const dialog = await openNavigator(page);
  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "navigator-open",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  await page.waitForTimeout(500);
  const duringSearch = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  expect(Math.abs(duringSearch - beforeSearch)).toBeLessThan(0.02);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeLessThan(beforeSearch);

  await runtime.assertClean(testInfo);
});

test("partial Galaxy scale tolerates repeated direction changes without hidden travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const sequence = [
    [-96, "0.250"],
    [-96, "0.500"],
    [96, "0.250"],
    [-96, "0.500"],
    [96, "0.250"],
    [96, "0.000"],
    [-96, "0.250"],
  ] as const;

  for (const [deltaY, position] of sequence) {
    await dispatchScaleWheel(page, deltaY);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      position,
    );
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    await expect(html).not.toHaveAttribute("data-universe-traveling");
  }

  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );
  await runtime.assertClean(testInfo);
});

test("wheel follows Hero focus from galaxy through system to surface", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-preferred",
    "hero:aurora-01",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "planet:aurora-01",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
  );

  await runtime.assertClean(testInfo);
});

test("opening galaxy auto-orbits until the visitor takes control", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "auto-orbit",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const centerX = box!.x + box!.width * 0.5;
  const centerY = box!.y + box!.height * 0.5;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 36, centerY + 12, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(() => html.getAttribute("data-yeis-opening-motion"))
    .toBe("stopped");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await waitForYeis(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-opening-motion",
    "reduced",
  );

  await runtime.assertClean(testInfo);
});

test("Chinese and English switch in place and persist", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);
  await expect(
    page.getByText(
      "Personal signals are scattered among observed and imagined worlds. Scroll or use the trackpad to move closer, or open Search / Places to choose a destination.",
    ),
  ).toBeVisible();

  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  const languageButton = page.getByRole("button", {
    name: "Switch language to Chinese",
  });
  await expect(languageButton).toHaveText("ZH");
  await languageButton.click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "zh",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", {
      name: "一张连接真实观测与想象世界的动态地图。",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /搜索 \/ 地点/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "个人信号散落在真实观测与想象世界之间。滚动鼠标滚轮或触控板向前靠近，也可以打开“搜索 / 地点”选择目的地。",
    ),
  ).toBeVisible();
  expect(mainFrameNavigations).toBe(0);

  await page.getByRole("button", { name: /搜索 \/ 地点/ }).click();
  await expect(
    page.getByRole("dialog", { name: "宇宙导航" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("搜索个人信号、行星、恒星、天体地标、星系…"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await waitForYeis(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "zh",
  );

  const englishButton = page.getByRole("button", {
    name: "切换语言为英文",
  });
  await expect(englishButton).toHaveText("EN");
  await englishButton.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "en",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      name: "A living map of observed and imagined worlds.",
    }),
  ).toBeVisible();

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

  // Search/deep-link entry must hand off to the same continuous-scale
  // coordinator instead of becoming a click-only dead end.
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  expect(new URL(page.url()).searchParams.get("destination")).toMatch(
    /^exoplanet:/,
  );

  await runtime.assertClean(testInfo);
});

test("Chinese Moon alias preserves exact native-body travel identity", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("月球");

  const moon = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Moon" })
    .first();
  await expect(moon).toBeVisible();
  await moon.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  const destinationId = "body:c0/moon";
  const nativeTarget = "c0/moon";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );

  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === nativeTarget || complete === nativeTarget;
    })
    .toBe(true);
  await expect(html).toHaveAttribute(
    "data-universe-travel-complete",
    nativeTarget,
    { timeout: 15_000 },
  );

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toBe(destinationId);
  expect(url.searchParams.get("phase")).toBeNull();
  expect(url.searchParams.get("star")).toBeNull();
  expect(url.searchParams.get("body")).toBeNull();
  await expect(page.locator(".navigation-failure-notice")).toHaveCount(0);
  expect(
    await html.getAttribute("data-universe-navigation-error"),
  ).toBeNull();

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

test("Search keyboard navigation reaches personal content", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
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

  await runtime.assertClean(testInfo);
});

test("Places featured destination navigates", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
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

  await runtime.assertClean(testInfo);
});

test("Earth body navigation preserves async search and shareable return flow", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const featuredRows = dialog
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-featured") });
  await expect(featuredRows.first()).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Earth");

  // Query edits synchronously invalidate the prior Places rows instead of
  // leaving them clickable during the async search debounce window.
  expect(await featuredRows.count()).toBe(0);
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

  // Measure the two product events on the browser's clock. Hosted SwiftShader
  // can delay Playwright itself, so a fixed wait that starts after Playwright
  // notices settlement can race an otherwise correct 6.5 s dwell.
  await page.evaluate(() => {
    const root = document.documentElement;
    const timing = {
      settledAt: null as number | null,
      completeAt: null as number | null,
    };
    Object.assign(window, { __journeySettleTiming: timing });

    const capture = () => {
      if (
        timing.settledAt === null &&
        root.dataset.universeCameraSettled === "approach"
      ) {
        timing.settledAt = performance.now();
      }
      if (
        timing.completeAt === null &&
        root.dataset.universeJourneyComplete === "Featured Journey"
      ) {
        timing.completeAt = performance.now();
      }
    };

    new MutationObserver(capture).observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-camera-settled",
        "data-universe-journey-complete",
      ],
    });
    capture();
  });

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /Featured Journey/ }).click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  // Do not require Playwright itself to observe a transient SETTLING/DWELLING
  // label. Hosted software-WebGL can stall the driver while the browser keeps
  // advancing timers. The browser-clock observer installed before Journey
  // start is the authoritative contract below: completion must occur at least
  // six seconds after the destination actually settles.
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-journey-complete",
    "Featured Journey",
    { timeout: 15_000 },
  );

  const timing = await page.evaluate(() => {
    return (
      window as typeof window & {
        __journeySettleTiming?: {
          settledAt: number | null;
          completeAt: number | null;
        };
      }
    ).__journeySettleTiming;
  });
  expect(timing?.settledAt).not.toBeNull();
  expect(timing?.completeAt).not.toBeNull();
  expect(timing!.completeAt! - timing!.settledAt!).toBeGreaterThanOrEqual(
    6_000,
  );
  await expect(controls).toContainText("JOURNEY COMPLETE");

  await runtime.assertClean(testInfo);
});

test("wheel scale takeover interrupts Journey without changing destination", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  const controls = page.locator(".universe-journey-controls");
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await page.getByRole("button", { name: /Featured Journey/ }).click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const destinationId = await html.getAttribute(
    "data-universe-active-destination",
  );
  expect(destinationId).toBeTruthy();
  const destinationBefore = new URL(page.url()).searchParams.get(
    "destination",
  );
  expect(destinationBefore).toBe(destinationId);

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Even a sub-threshold trackpad intent is manual navigation and must stop
  // Journey auto-advance immediately without changing destination identity.
  await page.mouse.wheel(0, -16);
  await expect(controls).toHaveCount(0);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId!,
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    destinationBefore,
  );

  // The identity assertions above may exceed the single-sample gesture
  // reset. Start a fresh trackpad-like gesture and cross the threshold inside
  // one reset window; Journey must stay stopped while manual scale resumes.
  // Chromium can coalesce tiny automation-level mouse.wheel samples; use the
  // same DOM WheelEvent accumulator probe as the dedicated trackpad contract.
  // The first page.mouse.wheel above still validates real pointer takeover.
  for (let index = 0; index < 11; index += 1) {
    await dispatchScaleWheel(page, -16);
    await page.waitForTimeout(20);
  }

  await expect(html).not.toHaveAttribute(
    "data-universe-scale-superseded",
    "manual-camera",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(controls).toHaveCount(0);
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId!,
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    destinationBefore,
  );
  expect(new URL(page.url()).searchParams.get("phase")).toBe("orbit");

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
  await expect(
    page.getByRole("button", { name: /Projects Journey/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Research Journey/ }),
  ).toHaveCount(0);
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

test("Hero Search produces a reloadable exact world deep link", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("AURORA-01");

  const hero = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-hero") })
    .filter({ hasText: "AURORA-01" })
    .first();
  await expect(hero).toBeVisible();
  await hero.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  const destinationId = "hero:aurora-01";
  const nativeTarget = "h-aurora/aurora-01";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ AURORA-01/)).toBeVisible();

  const sharedUrl = new URL(page.url());
  expect(sharedUrl.searchParams.get("destination")).toBe(destinationId);
  expect(sharedUrl.searchParams.get("star")).toBe("h-aurora");
  expect(sharedUrl.searchParams.get("body")).toBe("aurora-01");
  expect(sharedUrl.searchParams.get("phase")).toBe("approach");

  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ AURORA-01/)).toBeVisible();

  // A cold-reloaded exact world link must rejoin the same scale coordinator;
  // deep-link entry is not a separate click-only navigation mode.
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  const scaledUrl = new URL(page.url());
  expect(scaledUrl.searchParams.get("destination")).toBe(destinationId);
  expect(scaledUrl.searchParams.get("phase")).toBe("orbit");

  await runtime.assertClean(testInfo);
});

test("Chinese Andromeda alias starts the exact galaxy travel contract", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("仙女座");

  const galaxy = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-galaxy") })
    .filter({ hasText: "Andromeda" })
    .first();
  await expect(galaxy).toBeVisible();
  await galaxy.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    /^galaxy:\d+$/,
  );
  const destinationId = await html.getAttribute(
    "data-universe-active-destination",
  );
  expect(destinationId).toMatch(/^galaxy:\d+$/);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    destinationId!,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === destinationId || complete === destinationId;
    })
    .toBe(true);

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toBe(destinationId);
  expect(url.searchParams.get("phase")).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Locate then real canvas click reuses the same landmark destination", async ({
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
  await landmark.locator(".navigator-locate").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-locate-complete",
    /^landmark:\d+$/,
  );

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, "native YEIS canvas should have a clickable viewport").not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  );

  await expect(html).toHaveAttribute(
    "data-yeis-picked-target",
    "landmark:l-m42",
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "landmark:l-m42",
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    "landmark:l-m42",
  );

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
