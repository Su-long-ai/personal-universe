import { expect, test, type Page } from "@playwright/test";
import { Quaternion } from "three";
import { measureTemporalContinuity } from "./support/temporal-continuity";
import { observeRuntime, waitForYeisEngine } from "./support/runtime";

test.use({ viewport: { width: 1000, height: 660 } });

type Sample = {
  time: number;
  position: number;
  appliedToken: string;
  distance: number;
  quaternion: string;
  phase: string;
};
type WheelTrace = { trusted: boolean; frames: Sample[] };

async function installFrameProbe(page: Page, endpoint: string) {
  await page.evaluate((goal) => {
    const html = document.documentElement;
    const read = () => {
      const d = html.dataset;
      return {
        time: performance.now(),
        position: Number(d.universeCinematicScaleAppliedPosition),
        appliedToken: d.universeCinematicScaleAppliedPosition ?? "",
        distance: Number(d.universeCameraDistance),
        quaternion: d.universeCameraQuaternion ?? "",
        phase: d.universeNavigationPhase ?? "",
      };
    };
    html.removeAttribute("data-test-cinematic-wheel-trace");
    window.addEventListener("wheel", (event) => {
      const frames = [read()];
      const collect = () => {
        frames.push(read());
        const current = frames[frames.length - 1];
        if (
          (frames.length >= 8 && current.appliedToken === goal) ||
          frames.length >= 100
        ) {
          html.setAttribute("data-test-cinematic-wheel-trace", JSON.stringify({
            trusted: event.isTrusted,
            frames,
          }));
        } else {
          requestAnimationFrame(collect);
        }
      };
      requestAnimationFrame(collect);
    }, { capture: true, once: true });
  }, endpoint);
}

async function readFrameProbe(page: Page): Promise<WheelTrace> {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-test-cinematic-wheel-trace", /.+/, {
    timeout: 20_000,
  });
  return JSON.parse((await html.getAttribute("data-test-cinematic-wheel-trace"))!);
}

function measureArc(frames: Sample[]) {
  const q = frames.map(({ quaternion }) =>
    new Quaternion().fromArray(quaternion.split(",").map(Number)).normalize(),
  );
  const angle = (a: Quaternion, b: Quaternion) => a.angleTo(b);
  const deltas = q.slice(1).map((value, i) => angle(q[i], value));
  const total = angle(q[0], q[q.length - 1]);
  expect(total).toBeGreaterThan(0.005);
  expect(deltas.filter((delta) => delta > 0.0001).length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...deltas) / total).toBeLessThan(0.75);
  expect(Math.max(...deltas) * 180 / Math.PI).toBeLessThan(24);
}

const cases = [
  { phase: "system", start: "1.250", end: "1.500", prime: -72, delta: -72 },
  { phase: "approach", start: "2.250", end: "2.625", prime: -48, delta: -72 },
  { phase: "orbit", start: "3.250", end: "3.625", prime: -48, delta: -72 },
  { phase: "atmosphere", start: "4.150", end: "4.350", prime: -36, delta: -48 },
] as const;

for (const { phase, start, end, prime, delta } of cases) {
  test(`trusted ${phase} wheel paints progressive camera distance and rotation in both directions`, async ({ page }, testInfo) => {
    const runtime = await observeRuntime(page);
    await page.goto(`/?phase=${phase}&star=h-aurora&body=aurora-01&freeze=1`);
    await waitForYeisEngine(page);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-universe-camera-settled", phase);
    if (phase === "system") {
      await expect(html).toHaveAttribute("data-universe-system-focus", /.+/);
    }
    const canvas = await page.locator("canvas").boundingBox();
    expect(canvas).not.toBeNull();
    await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
    await page.mouse.wheel(0, prime);
    await expect(html).toHaveAttribute("data-universe-cinematic-scale-applied-position", start);

    const measure = async (deltaY: number, expected: string) => {
      await installFrameProbe(page, expected);
      await page.mouse.wheel(0, deltaY);
      const trace = await readFrameProbe(page);
      expect(trace.trusted).toBe(true);
      expect(trace.frames.every((frame) => frame.phase === phase)).toBe(true);
      expect(trace.frames[trace.frames.length - 1].appliedToken).toBe(expected);
      const distance = trace.frames.map(({ distance }) => Math.log(distance));
      const readout = {
        coordinate: measureTemporalContinuity(trace.frames.map((frame) => frame.position)),
        distance: measureTemporalContinuity(distance),
      };
      for (const metric of Object.values(readout)) {
        expect(metric.monotonic).toBe(true);
        expect(metric.intermediatePositions).toBeGreaterThanOrEqual(3);
        expect(metric.largestStepFraction).toBeLessThan(0.7);
      }
      measureArc(trace.frames);
      const endDistance = trace.frames[trace.frames.length - 1].distance;
      expect(Math.sign(endDistance - trace.frames[0].distance)).toBe(Math.sign(deltaY));
      await testInfo.attach(`painted-${phase}-${expected}.json`, {
        body: JSON.stringify({ trace, readout }, null, 2),
        contentType: "application/json",
      });
      return endDistance;
    };
    const distanceBefore = Number(await html.getAttribute("data-universe-camera-distance"));
    await measure(delta, end);
    expect(await measure(-delta, start)).toBeCloseTo(distanceBefore, 5);
    await expect(html).not.toHaveAttribute("data-universe-traveling");
    await runtime.assertClean(testInfo);
  });
}

test("System closes its actual animated 2.000 exit before committing Approach", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-universe-camera-settled", "system");
  await expect(html).toHaveAttribute("data-universe-system-focus", /.+/);
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  for (const position of ["1.250", "1.500", "1.750"]) {
    await page.mouse.wheel(0, -72);
    await expect(html).toHaveAttribute("data-universe-cinematic-scale-applied-position", position);
  }

  await page.evaluate(() => {
    const root = document.documentElement;
    const trace: Array<[string?, string?, string?, string?]> = [];
    const read = () => {
      const d = root.dataset;
      trace.push([
        d.universeNavigationPhase,
        d.universeCinematicScaleAppliedPosition,
        d.universeHandoffExitProjectedRadius,
        d.universeHandoffExitQuaternion,
      ]);
      if (d.universeNavigationPhase === "system" && trace.length < 200) {
        requestAnimationFrame(read);
      } else {
        root.setAttribute("data-test-cinematic-handoff", JSON.stringify(trace));
      }
    };
    requestAnimationFrame(read);
  });
  await page.mouse.wheel(0, -72);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "approach");
  await expect(html).toHaveAttribute("data-universe-camera-settled", "approach");
  await expect(html).toHaveAttribute("data-test-cinematic-handoff", /.+/);
  const frames: Array<[string?, string?, string?, string?]> = JSON.parse(
    (await html.getAttribute("data-test-cinematic-handoff"))!,
  );
  await testInfo.attach("system-approach-applied-exit-trace.json", {
    body: JSON.stringify(frames, null, 2),
    contentType: "application/json",
  });
  const exitIndex = frames.findIndex(([phase, position, radius, quaternion]) =>
    phase === "system" && position === "2.000" && Number(radius) > 0 && quaternion,
  );
  expect(exitIndex, "Approach must see a rendered System exit, not downstream intent").toBeGreaterThanOrEqual(0);
  expect(frames.slice(exitIndex + 1).some(([phase]) => phase === "approach")).toBe(true);
  await expect(html).toHaveAttribute("data-universe-handoff-entry-projected-radius", /.+/);
  await runtime.assertClean(testInfo);
});
