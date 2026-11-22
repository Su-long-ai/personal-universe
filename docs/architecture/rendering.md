# Rendering architecture

Personal Universe keeps one navigation authority and one browser rendering host.

## Authority boundaries

- **YEIS MIT pin `e52056897364e060fbd6d00951628f163b57d7a1`** remains the universe, native star/system/body and cross-scale navigation authority.
- **React Three Fiber** owns the shared Three.js canvas, renderer lifecycle, product camera integration and phase composition.
- **ProceduralPlanets v0.5.1** is a close-world visual subsystem only. It does not own destinations, routing, system identity, content placement or deep links.
- Project code is glue between those existing capabilities; it must not grow a second universe engine.

## Close-world rendering

For `approach`, `orbit` and `atmosphere` phases, the selected `PlanetDefinition` first commits the existing lightweight fallback world. On a capable renderer, one live `procedural-planets` `Planet` is then warmed in after the arrival frame and an idle/warm-up window.

The live object is attached to the existing R3F scene and scaled into the established Personal Universe world coordinates. The existing cinematic camera and `PLANET_ANCHOR` remain authoritative. Quick travel/return actions can cancel warm-in without paying the live-world construction cost.

The post-processing chain is:

```text
shared R3F scene
  -> RenderPass
  -> PlanetPass (close-world phases only)
  -> UnrealBloomPass
  -> OutputPass
```

`PlanetPass` reuses the EffectComposer's existing WebGL renderer and depth buffer. It does not create another canvas or WebGL context. The live `Planet` and `PlanetPass` are explicitly disposed with their React/composer lifetimes.

A small inner fallback sphere remains behind the live surface so shader warm-up never presents a blank selected world. It is not a second planet authority.

Quality mode maps to renderer capability plus the upstream live renderer's documented terrain/cloud knobs instead of project-owned shaders:

- low: keep the complete lightweight fallback and do not mount `PlanetPass`;
- auto: use the live renderer on hardware WebGL, but keep the fallback on detected SwiftShader/llvmpipe/software rasterizers;
- high: explicitly force the live `Planet + PlanetPass` path with the higher quadtree/cloud budgets.

This is a product performance policy, not a CI-only switch: software-rendered browsers get a responsive complete world instead of a GPU-blocking live path, while users can still explicitly request HIGH to exercise live rendering.

## Runtime evidence

Close-world runtime exposes the actual active path:

- live: `data-universe-world-renderer="procedural-planets-live"` and `data-universe-world-pipeline="procedural-planets-pass"`;
- adaptive fallback: `data-universe-world-renderer="procedural-planets-fallback-<reason>"` and `data-universe-world-pipeline="fallback-<reason>"`;
- scene commit: `data-universe-world-scene-ready="true"` only after the lazy close-world scene has actually mounted;
- capture readiness: `data-universe-world-ready="true"` only once that scene plus the active live or fallback path is ready.

Normal visual screenshots accept either a ready live path or the renderer-capability fallback. A separate HIGH-quality Playwright case forces the live path and requires `PlanetPass` readiness without taking the expensive software-WebGL screenshot. This preserves real live-renderer coverage without using larger timeouts to hide GPU stalls.

## Next system-scale layer

The current schematic `SystemScene` is temporary. Its replacement is separately approved under `YEIS-NATIVE-SYSTEM-RENDERER-V3-001` and will reuse the pinned MIT YEIS `BodyRenderer + BodyPoints + OrbitLines` subsystem inside the same R3F host.

That follow-up must preserve the same destination model and content binding rather than introduce a second system model.
