import { expect, test, type Page } from "@playwright/test";
import { observeRuntime, waitForYeis, waitForYeisEngine } from "./support/runtime";

const lifecycle = "data-universe-native-system-lifecycle";
const instance = "data-universe-native-system-instance";
const phase = "data-universe-navigation-phase";

async function wheel(page: Page, deltas: number[]) {
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  for (const delta of deltas) await page.mouse.wheel(0, delta);
}

// Share the actual drawn native resource probe with the retention test.
async function installNativeProbe(page: Page, holdFirstLowPaint = false) {
  await page.addInitScript((holdEarlyPaint) => {
    const roots = new Set<any>();
    const renderers = new WeakSet<any>();
    const pending = new Map<number, FrameRequestCallback>();
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    let id = 0;
    let previousOwner: string | null = null;
    let armed = false;
    let held: { owner: string; centred: string; distance: number } | null = null;
    let suspend = false;
    const resource = (owner?: string) => {
      for (const root of roots) {
        const stack = [root.current];
        for (let fiber; (fiber = stack.pop()); ) {
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
          for (let h = fiber.memoizedState, k = 0; h && k < 100; k++, h = h.next) {
            const state = h.memoizedState;
            if (state?.instance && (!owner || state.instance === owner) &&
                state.scene?.isScene && state.scene.visible && state.bodies?.views) {
              return state;
            }
          }
        }
      }
      return null;
    };
    const install = () => {
      for (const root of roots) {
        const stack = [root.current];
        for (let fiber; (fiber = stack.pop()); ) {
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
          const state = fiber.stateNode?.__r3f?.root?.getState?.();
          const gl = state?.gl;
          if (!gl || renderers.has(gl)) continue;
          renderers.add(gl);
          const draw = gl.render;
          gl.render = function (scene: unknown, camera: any) {
            const result = draw.call(this, scene, camera);
            if (!armed) return result;
            const data = document.documentElement.dataset;
            const owner = data.universeNativeSystemInstance;
            if (!owner || owner === previousOwner || !owner.startsWith("h-aurora:") ||
                data.universeNavigationPhase !== "system" ||
                data.universeNativeSystemLifecycle !== "active" ||
                data.universeCameraSettled !== "system" ||
                data.universeSystemFocus) return result;
            const actual = resource(owner);
            if (!actual) return result;
            const size = state.size;
            const candidates = actual.bodies.views.map((view: any) => {
              const projected = view.body.position.clone().project(camera);
              return {
                id: view.body.id,
                z: projected.z,
                distance: Math.hypot(projected.x * size.width / 2, projected.y * size.height / 2),
                planet: view.body.data.type === "planet",
              };
            }).filter((view: any) => view.planet && view.z >= -1 && view.z <= 1)
              .sort((a: any,b: any) => a.distance - b.distance);
            const first = candidates[0];
            if (first?.distance > 92 || !first) return result;
            held = { owner, centred: first.id, distance: first.distance };
            armed = false;
            suspend = true;
            return result;
          };
        }
      }
    };
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => ++id,
        onCommitFiberRoot: (_: number, root: any) => {
          roots.add(root);
          if (holdEarlyPaint) install();
        },
        onCommitFiberUnmount: () => {},
      },
      __nativeRetentionProbe() {
        const native = resource();
        if (!native) return false;
        const stats = { updates: 0, draws: 0 };
        const update = native.system.update;
        native.system.update = function (...args: any[]) {
          stats.updates++;
          return update.apply(this, args);
        };
        native.scene.traverse((object: any) => {
          if (!object.geometry || !object.material) return;
          const draw = object.onBeforeRender;
          object.onBeforeRender = function (...args: any[]) {
            stats.draws++;
            return draw.apply(this, args);
          };
        });
        Object.assign(window, { __readNativeRetention: () => ({ ...stats, visible: native.scene.visible }) });
        return true;
      },
      __earlyLowPaint: {
        arm() { previousOwner = document.documentElement.dataset.universeNativeSystemInstance ?? null; armed = true; },
        read() { return held; },
        release() {
          armed = false;
          suspend = false;
          for (const callback of pending.values()) raf(callback);
          pending.clear();
        },
      },
    });
    if (holdEarlyPaint) {
      window.requestAnimationFrame = (callback) => {
        const handle = raf((time) => {
          if (suspend) pending.set(handle, callback);
          else callback(time);
        });
        return handle;
      };
      window.cancelAnimationFrame = (handle) => {
        pending.delete(handle);
        cancel(handle);
      };
    }
  }, holdFirstLowPaint);
}

test("LOW native System parks the same owner without updates or draws and republishes only on return", async ({ page }, info) => {
  test.slow();
  const runtime = await observeRuntime(page);
  await installNativeProbe(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute(instance);
  await page.getByLabel("QUALITY").selectOption("low");
  await expect(html).toHaveAttribute("data-universe-active-destination", "hero:aurora-01", {timeout:20_000});
  await expect(html).not.toHaveAttribute(instance);
  await wheel(page, [-96,-96,-96,-96]);
  await expect(html).toHaveAttribute(phase, "system", {timeout:10_000});
  await expect(html).toHaveAttribute(instance, /^h-aurora:\d+$/);
  await expect(html).toHaveAttribute(lifecycle, "active");
  const resource = (await html.getAttribute(instance))!;
  expect(await page.evaluate(() => (window as any).__nativeRetentionProbe())).toBe(true);
  const stats = () => page.evaluate(() => (window as any).__readNativeRetention());
  await expect.poll(async () => (await stats()).draws).toBeGreaterThan(0);
  await expect.poll(async () => (await stats()).updates).toBeGreaterThan(0);
  await wheel(page, [-96,-96,-96]);
  await expect(html).toHaveAttribute(phase, "approach", {timeout:15_000});
  await expect(html).toHaveAttribute("data-universe-scale-position", "2.000");
  await wheel(page, [-96,-96]);
  await expect(html).toHaveAttribute(phase, "orbit");
  await expect(html).toHaveAttribute(lifecycle, "parked");
  await expect(html).toHaveAttribute(instance, resource);
  await expect(html).not.toHaveAttribute("data-universe-system-ready");
  await expect(html).not.toHaveAttribute("data-universe-system-focus");
  const parked = await stats();
  expect(parked.visible).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) => {
    let n=0;
    const tick=()=>{ if(++n===4)resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  expect(await stats()).toEqual(parked);
  await wheel(page, [96,96]);
  await expect(html).toHaveAttribute(phase, "approach");
  await expect(html).toHaveAttribute("data-universe-scale-position", "2.000");
  await wheel(page, [96,96,96]);
  await expect(html).toHaveAttribute(phase, "system", {timeout:10_000});
  await expect(html).toHaveAttribute(instance, resource);
  await expect(html).toHaveAttribute(lifecycle, "active");
  await expect(html).toHaveAttribute("data-universe-cinematic-scale-applied-position", "1.000");
  await expect.poll(async () => (await stats()).draws).toBeGreaterThan(parked.draws);
  await expect.poll(async () => (await stats()).updates).toBeGreaterThan(parked.updates);
  await wheel(page, [96,96,96,96]);
  await expect(html).toHaveAttribute(phase, "galaxy", {timeout:10_000});
  await expect(html).toHaveAttribute("data-universe-galaxy-scale-applied-position", "0.000");
  await expect(html).not.toHaveAttribute(instance);
  await runtime.assertClean(info);
});

test("LOW parked native System is evicted by quality and a new star gets an independent owner", async ({page},info) => {
  test.slow();
  const runtime = await observeRuntime(page);
  // This owner-lifetime test does not depend on optional Solar imagery. Use
  // the same deterministic NASA tile fixture as the Solar provenance test.
  const tile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMISGoCAAI6ATVu1FmqAAAAAElFTkSuQmCC",
    "base64",
  );
  await page.route(/^https:\/\/(?:trek\.nasa\.gov\/tiles\/|gibs\.earthdata\.nasa\.gov\/wmts\/)/,
    (route) => route.fulfill({
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: tile,
    }),
  );
  await installNativeProbe(page, true);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await page.evaluate(() => (window as any).__earlyLowPaint.arm());
  await page.getByLabel("QUALITY").selectOption("low");
  const html=page.locator("html");
  try {
    await expect.poll(() => page.evaluate(() => (window as any).__earlyLowPaint.read()))
      .toMatchObject({ owner: /^h-aurora:\d+$/, centred: expect.any(String) });
    await expect(html).not.toHaveAttribute("data-universe-system-focus");
    await expect(html).toHaveAttribute("data-universe-camera-settled","system");
    await wheel(page,[-96]);
    try {
      await expect(html).toHaveAttribute("data-universe-scale-position","1.333");
    } finally {
      await info.attach("first-low-system-wheel.json", {
        contentType: "application/json",
        body: JSON.stringify(await page.evaluate(() => ({
          rendered: (window as any).__earlyLowPaint.read(),
          requested: document.documentElement.dataset.universeScalePosition,
          blocked: document.documentElement.dataset.universeScaleBlocked ?? null,
        }))),
      });
    }
  } finally {
    await page.evaluate(() => (window as any).__earlyLowPaint.release());
  }
  await wheel(page,[-96,-96]);
  await expect(html).toHaveAttribute(phase,"approach",{timeout:15_000});
  await expect(html).toHaveAttribute(lifecycle,"parked");
  const parked=(await html.getAttribute(instance))!;
  await page.getByLabel("QUALITY").selectOption("auto");
  await expect(html).not.toHaveAttribute(instance);
  await expect(html).toHaveAttribute("data-universe-camera-settled","approach",{timeout:15_000});
  await wheel(page,[96,96,96]);
  await expect(html).toHaveAttribute(phase,"system",{timeout:10_000});
  await expect(html).toHaveAttribute("data-universe-camera-settled","system",{timeout:15_000});
  await expect(html).toHaveAttribute(instance,/^h-aurora:\d+$/);
  const autoOwner=await html.getAttribute(instance);
  await page.getByLabel("QUALITY").selectOption("low");
  let second="";
  await expect.poll(async()=>{
    const owner=await html.getAttribute(instance);
    if (owner && /^h-aurora:\d+$/.test(owner) && owner!==autoOwner) second=owner;
    return second;
  }).not.toBe("");
  expect(second).not.toBe(parked);
  await wheel(page,[-96,-96,-96]);
  await expect(html).toHaveAttribute(lifecycle,"parked",{timeout:15_000});
  await expect(html).toHaveAttribute(instance,second);
  await page.getByRole("button",{name:/SEARCH \/ PLACES/}).click();
  const dialog=page.getByRole("dialog",{name:"Universe navigator"});
  await dialog.getByRole("combobox",{name:"Search universe"}).fill("Earth");
  await dialog.locator('.navigator-result-row[data-destination-id="body:c0/earth"]')
    .locator(".navigator-result-open").click();
  await expect(html).toHaveAttribute("data-universe-active-destination","body:c0/earth",{timeout:20_000});
  // An Approach navigation may show the destination's System before handing
  // its selected body to the world renderer. Either way no Aurora owner may
  // survive the identity switch, and any newly parked owner must be Solar.
  await expect(html).toHaveAttribute(phase,"approach",{timeout:15_000});
  await expect(html).toHaveAttribute("data-universe-scale-position","2.000");
  await expect(html).toHaveAttribute("data-universe-camera-settled","approach",{timeout:15_000});
  await expect(html).not.toHaveAttribute(instance,second);
  const onApproach=await html.getAttribute(instance);
  if (onApproach !== null) {
    expect(onApproach).toMatch(/^c0:\d+$/);
    await expect(html).toHaveAttribute(lifecycle,"parked");
  }
  await wheel(page,[96,96,96]);
  await expect(html).toHaveAttribute(phase,"system",{timeout:10_000});
  await expect(html).toHaveAttribute(instance,/^c0:\d+$/);
  expect(await html.getAttribute(instance)).not.toBe(second);
  if (onApproach !== null) await expect(html).toHaveAttribute(instance,onApproach);
  await info.attach("native-replacement-identities.json",{
    contentType:"application/json",
    body:JSON.stringify({parked,autoOwner,second,onApproach,final:await html.getAttribute(instance)}),
  });
  await runtime.assertClean(info);
});

test("WebGL context loss evicts the native System owner and restoration creates a fresh one", async ({page}) => {
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");
  const html=page.locator("html");
  await expect(html).toHaveAttribute(instance,/^h-aurora:\d+$/);
  await expect(html).toHaveAttribute(lifecycle,"active");
  await expect(html).toHaveAttribute("data-universe-camera-settled","system");
  const prior=(await html.getAttribute(instance))!;
  const supported=await page.locator("canvas").evaluate((canvas: HTMLCanvasElement)=>{
    const extension=canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    canvas.addEventListener("webglcontextlost",event=>event.preventDefault(),{once:true});
    document.addEventListener("pu-test-webgl-restore",()=>extension.restoreContext(),{once:true});
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle","lost");
  await expect(html).not.toHaveAttribute(instance);
  await page.evaluate(()=>document.dispatchEvent(new Event("pu-test-webgl-restore")));
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle","active");
  await expect(html).toHaveAttribute("data-universe-webgl-context-generation","1");
  await expect(html).toHaveAttribute(instance,/^h-aurora:\d+$/);
  await expect(html).not.toHaveAttribute(instance,prior);
  await expect(html).toHaveAttribute("data-universe-system-ready","true");
});
