import { test, expect } from "./support/test";
import {
  observeRuntime,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

async function openNavigator(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  return dialog;
}


type ReleaseScaleSnapshot = {
  position: number;
  phase: string | null;
  direction: string | null;
  authority: string | null;
  handoff: string | null;
  queued: string | null;
  canvasCount: number;
};

async function dispatchReleaseWheel(
  page: import("@playwright/test").Page,
  deltaY: number,
) {
  await page.locator("main.universe-root").evaluate(
    (node, value) => {
      node.dispatchEvent(
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

async function releaseScaleSnapshot(
  page: import("@playwright/test").Page,
): Promise<ReleaseScaleSnapshot> {
  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      position: Number(data.universeScalePosition ?? "NaN"),
      phase: data.universeNavigationPhase ?? null,
      direction: data.universeScaleDirection ?? null,
      authority: data.universeRenderAuthority ?? null,
      handoff: data.universeHandoffState ?? null,
      queued: data.universeScaleQueued ?? null,
      canvasCount: document.querySelectorAll("canvas").length,
    };
  });
}

async function openHeroScaleJourney(page: import("@playwright/test").Page) {
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  expect(await page.locator("canvas").count()).toBe(1);
  return html;
}

async function stepReleaseScale(
  page: import("@playwright/test").Page,
  deltaY: number,
  position: number,
  phase: string,
) {
  await dispatchReleaseWheel(page, deltaY);
  const html = page.locator("html");
  await expect
    .poll(
      async () => Number(await html.getAttribute("data-universe-scale-position")),
      { timeout: 20_000 },
    )
    .toBeCloseTo(position, 3);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    phase,
    { timeout: 20_000 },
  );
  expect(await page.locator("canvas").count()).toBe(1);
}

async function driveReleaseScaleBurst(
  page: import("@playwright/test").Page,
  deltaY: number,
  done: (snapshot: ReleaseScaleSnapshot) => boolean,
  cadenceMs = 72,
  maxSamples = 96,
) {
  const trace: ReleaseScaleSnapshot[] = [];
  for (let sample = 0; sample < maxSamples; sample += 1) {
    await dispatchReleaseWheel(page, deltaY);
    await page.waitForTimeout(cadenceMs);
    const snapshot = await releaseScaleSnapshot(page);
    trace.push(snapshot);
    if (done(snapshot)) return trace;
  }
  throw new Error(
    `continuous-scale burst did not reach its terminal state after ${maxSamples} samples: ${JSON.stringify(trace.slice(-8))}`,
  );
}


test("fresh BrowserContext preserves one-canvas Galaxy midpoint reversal", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const runtime = await observeRuntime(page);

  try {
    await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
    await waitForYeis(page);

    const html = page.locator("html");
    await expect(html).toHaveAttribute(
      "data-universe-active-destination",
      "hero:aurora-01",
      { timeout: 20_000 },
    );
    expect(await page.locator("canvas").count()).toBe(1);

    const root = page.locator("main.universe-root");
    await root.evaluate((node) => {
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: -96,
        }),
      );
    });
    await expect(html).toHaveAttribute("data-universe-scale-position", "0.250");
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-bridge",
      "active",
      { timeout: 10_000 },
    );

    await root.evaluate((node) => {
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: 96,
        }),
      );
    });
    await expect(html).toHaveAttribute("data-universe-scale-position", "0.000");
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    expect(await page.locator("canvas").count()).toBe(1);

    await runtime.assertClean(testInfo);
  } finally {
    await context.close();
  }
});

test("Hero deep link returns through system to galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);

  await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();

  await page.getByRole("button", { name: /RETURN TO SYSTEM/ }).click();
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  await page.getByRole("button", { name: /RETURN TO GALAXY/ }).click();
  await waitForYeis(page);
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("black-hole navigation completes native travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Cygnus X-1");

  const result = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-blackhole") })
    .first();
  await expect(result).toBeVisible();
  await result.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^blackhole:/);
  const target = await html.getAttribute("data-universe-navigation-target");
  expect(target).toBeTruthy();

  await expect(html).toHaveAttribute("data-universe-traveling", target!);
  await expect
    .poll(
      async () => html.getAttribute("data-universe-travel-complete"),
      { timeout: 15_000 },
    )
    .toBe(target);
  await expect(html).not.toHaveAttribute("data-universe-traveling", target!);

  await runtime.assertClean(testInfo);
});

test("deep-sky landmark navigation completes native travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Orion Nebula");

  const result = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-landmark") })
    .first();
  await expect(result).toBeVisible();
  await result.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^landmark:/);
  const target = await html.getAttribute("data-universe-navigation-target");
  expect(target).toBeTruthy();

  await expect(html).toHaveAttribute("data-universe-traveling", target!);
  await expect
    .poll(
      async () => html.getAttribute("data-universe-travel-complete"),
      { timeout: 15_000 },
    )
    .toBe(target);
  await expect
    .poll(async () =>
      Number(
        (await html.getAttribute("data-universe-travel-arrival-ratio")) ??
          "Infinity",
      ),
    )
    .toBeLessThan(8);

  await runtime.assertClean(testInfo);
});

test("guided Journey stays manual under reduced motion", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await openNavigator(page);
  const journey = page
    .locator(".navigator-journeys button:not([disabled])")
    .first();
  await expect(journey).toBeVisible();
  const journeyText = (await journey.textContent()) ?? "";
  const stopMatch = /(\d+)\s+STOPS\b/.exec(journeyText);
  expect(
    stopMatch,
    "enabled Journey should expose a positive stop count",
  ).toBeTruthy();
  const stopCount = Number(stopMatch![1]);
  expect(stopCount).toBeGreaterThan(0);
  await journey.click();

  const controls = page.locator(".universe-journey-controls");
  const progress = page.locator(".journey-current small");
  await expect(controls).toBeVisible();
  await expect(page.locator(".journey-mode")).toHaveText(
    "REDUCED MOTION · MANUAL ADVANCE",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-journey",
    /.+/,
  );
  await expect(progress).toHaveText(`1 / ${stopCount}`);

  // Normal journeys auto-advance after a 6.5s dwell. Reduced motion must not.
  await page.waitForTimeout(7_000);
  await expect(progress).toHaveText(`1 / ${stopCount}`);

  if (stopCount > 1) {
    await page.getByRole("button", { name: "NEXT →" }).click();
    await expect(progress).toHaveText(`2 / ${stopCount}`);
    await page.getByRole("button", { name: "Stop guided journey" }).click();
  } else {
    await page.getByRole("button", { name: "DONE" }).click();
    await expect(page.getByText("JOURNEY COMPLETE")).toBeVisible();
    await expect(page.locator(".journey-mode")).toHaveText(
      "COMPLETE · NAVIGATION REMAINS AVAILABLE",
    );
    await page.getByRole("button", { name: "CLOSE" }).click();
  }

  await expect(controls).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-universe-journey",
    /.+/,
  );

  await runtime.assertClean(testInfo);
});

test("mobile navigation reaches an exact body deep link", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
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
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  const url = new URL(page.url());
  expect(url.searchParams.get("phase")).toBe("approach");
  expect(url.searchParams.get("star")).toBeTruthy();
  expect(url.searchParams.get("body")).toBeTruthy();

  await runtime.assertClean(testInfo);
});

test("invalid deep link fails closed to the galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=system&star=definitely-not-a-real-stellar-address&freeze=1",
  );
  await waitForYeis(page);

  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.getByText("STELLAR SYSTEM")).toBeHidden();

  await runtime.assertClean(testInfo);
});

test("runtime guard detects a critical client bundle failure", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [/^Failed to load resource: net::ERR_FAILED$/],
  });
  await page.route(/\/_astro\/[^?#]+\.js(?:\?|$)/i, async (route) => {
    await route.abort("failed");
  });

  await page.goto("/?freeze=1");
  await expect
    .poll(() =>
      runtime.problems.some(
        (problem) =>
          problem.kind === "requestfailed" &&
          problem.detail.includes("/_astro/"),
      ),
    )
    .toBeTruthy();

  await runtime.assertDetected(testInfo, "requestfailed");
});

test("runtime guard detects and recovers from forced WebGL context loss @webgl-heavy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [
      /^THREE\.WebGLRenderer: Context Lost\.?$/,
      /^THREE\.WebGLRenderer: Context Restored\.?$/,
    ],
  });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const recovery = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { supported: false, lost: false, restored: false };
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl");
    if (!gl) return { supported: false, lost: false, restored: false };
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) {
      return { supported: false, lost: false, restored: false };
    }

    const waitFor = (name: "webglcontextlost" | "webglcontextrestored") =>
      new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 5_000);
        canvas.addEventListener(
          name,
          (event) => {
            if (name === "webglcontextlost") {
              // WebGL only marks a lost context restorable when the loss event
              // is cancelled. Make the recovery precondition explicit instead
              // of relying on Three's listener ordering.
              event.preventDefault();
            }
            window.clearTimeout(timer);
            resolve(true);
          },
          { once: true },
        );
      });

    // WEBGL_lose_context only permits synthetic restoration when the
    // context-lost event is cancelled. Make that precondition explicit in the
    // probe instead of relying on renderer listener ordering.
    canvas.addEventListener(
      "webglcontextlost",
      (event) => event.preventDefault(),
      { once: true },
    );

    const lostPromise = waitFor("webglcontextlost");
    extension.loseContext();
    const lost = await lostPromise;
    if (!lost) return { supported: true, lost: false, restored: false };

    // restoreContext() is invalid until the context-lost event has completed.
    // Cross a task boundary so the synthetic restore follows the WebGL spec
    // rather than racing event dispatch on software-rendered runners.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const restoredPromise = waitFor("webglcontextrestored");
    extension.restoreContext();
    const restored = await restoredPromise;
    return {
      supported: true,
      lost,
      restored,
      contextStillLost: gl.isContextLost(),
    };
  });

  expect(
    recovery.supported,
    "WEBGL_lose_context should be available in Chromium",
  ).toBe(true);
  expect(recovery.lost, "forced WebGL loss event should fire").toBe(true);
  expect(recovery.restored, "forced WebGL restore event should fire").toBe(
    true,
  );
  expect(recovery.contextStillLost, "WebGL context should be restored").toBe(
    false,
  );

  await expect
    .poll(() =>
      runtime.problems.some(
        (problem) => problem.kind === "webglcontextlost",
      ),
    )
    .toBeTruthy();

  // R3F/Three should keep the native galaxy alive after native context
  // restoration rather than requiring a page reload or a second Canvas.
  await waitForYeis(page);
  await runtime.assertDetected(testInfo, "webglcontextlost");
});


test("release: Hero completes the full reversible 0-to-5-to-0 scale journey", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  const html = await openHeroScaleJourney(page);

  const inward: Array<[number, string]> = [
    [0.25, "galaxy"],
    [0.5, "galaxy"],
    [0.75, "galaxy"],
    [1, "system"],
    [4 / 3, "system"],
    [5 / 3, "system"],
    [2, "approach"],
    [2.5, "approach"],
    [3, "orbit"],
    [3.5, "orbit"],
    [4, "atmosphere"],
    [4.4, "atmosphere"],
    [4.8, "atmosphere"],
    [5, "surface"],
  ];

  for (const [position, phase] of inward) {
    await stepReleaseScale(page, -96, position, phase);
    if (position >= 2 && Number.isInteger(position)) {
      await expect(html).toHaveAttribute(
        "data-universe-camera-settled",
        phase,
        { timeout: 30_000 },
      );
    }
  }

  await expect(html).toHaveAttribute("data-universe-scale-position", "5.000");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );

  const outward: Array<[number, string]> = [
    [4.6, "atmosphere"],
    [4.2, "atmosphere"],
    [3.75, "orbit"],
    [3.25, "orbit"],
    [2.75, "approach"],
    [2.25, "approach"],
    [2, "approach"],
    [5 / 3, "system"],
    [4 / 3, "system"],
    [1, "system"],
    [0.75, "galaxy"],
    [0.5, "galaxy"],
    [0.25, "galaxy"],
    [0, "galaxy"],
  ];

  for (const [position, phase] of outward) {
    await stepReleaseScale(page, 96, position, phase);
  }

  await expect(html).toHaveAttribute("data-universe-scale-position", "0.000");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued", /.+/);
  expect(await page.locator("canvas").count()).toBe(1);

  await runtime.assertClean(testInfo);
});

test("release: rapid sustained wheel cadence crosses every scale authority and reverses immediately @webgl-heavy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  const html = await openHeroScaleJourney(page);

  const inwardTrace = await driveReleaseScaleBurst(
    page,
    -96,
    (snapshot) =>
      snapshot.position >= 4.999 &&
      snapshot.phase === "surface" &&
      snapshot.canvasCount === 1,
  );

  await expect(html).toHaveAttribute("data-universe-scale-position", "5.000");
  const inwardPhases = new Set(inwardTrace.map((snapshot) => snapshot.phase));
  for (const phase of [
    "galaxy",
    "system",
    "approach",
    "orbit",
    "atmosphere",
    "surface",
  ]) {
    expect(
      inwardPhases.has(phase),
      `rapid inward trace should expose ${phase}`,
    ).toBeTruthy();
  }

  // Reverse immediately from the terminal Surface state. Do not wait for a
  // fresh dwell/readiness cycle: a direction change must supersede any queued
  // inward intent and keep the same Canvas alive all the way back to Galaxy.
  const outwardTrace = await driveReleaseScaleBurst(
    page,
    96,
    (snapshot) =>
      snapshot.position <= 0.001 &&
      snapshot.phase === "galaxy" &&
      snapshot.canvasCount === 1,
  );

  await expect(html).toHaveAttribute("data-universe-scale-position", "0.000");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued", /.+/);
  expect(await page.locator("canvas").count()).toBe(1);

  const outwardPhases = new Set(outwardTrace.map((snapshot) => snapshot.phase));
  for (const phase of ["atmosphere", "orbit", "approach", "system", "galaxy"]) {
    expect(
      outwardPhases.has(phase),
      `rapid outward trace should expose ${phase}`,
    ).toBeTruthy();
  }

  await testInfo.attach("continuous-scale-rapid-trace.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          inward: inwardTrace,
          outward: outwardTrace,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  await runtime.assertClean(testInfo);
});
