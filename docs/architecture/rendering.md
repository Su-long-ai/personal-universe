# Rendering architecture

Personal Universe keeps one navigation authority and one browser rendering host.

## Authority boundaries

- **YEIS MIT pin `e52056897364e060fbd6d00951628f163b57d7a1`** remains the universe, native star/system/body and cross-scale navigation authority.
- **React Three Fiber** owns the shared Three.js canvas, renderer lifecycle, product camera integration and phase composition.
- **ProceduralPlanets v0.5.1** is a close-world visual subsystem only. It does not own destinations, routing, system identity, content placement or deep links.
- Project code is glue between those existing capabilities; it must not grow a second universe engine.

## Close-world rendering

For `approach`, `orbit` and `atmosphere` phases, the selected `PlanetDefinition` creates one live `procedural-planets` `Planet`.

The object is attached to the existing R3F scene and scaled into the established Personal Universe world coordinates. The existing cinematic camera and `PLANET_ANCHOR` remain authoritative.

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

Quality mode maps to the upstream live renderer's documented terrain/cloud knobs instead of project-owned shaders:

- low: reduced chunk/depth/cloud budgets;
- auto: upstream-like balanced defaults;
- high: higher quadtree and cloud budgets.

## Runtime evidence

Close-world runtime exposes:

- `data-universe-world-renderer="procedural-planets-live"`
- `data-universe-world-pipeline="procedural-planets-pass"`

Visual Playwright cases require these markers for Personal Signal and Hero worlds in addition to the existing phase/content assertions.

## Next system-scale layer

The current schematic `SystemScene` is temporary. Its replacement is separately approved under `YEIS-NATIVE-SYSTEM-RENDERER-V3-001` and will reuse the pinned MIT YEIS `BodyRenderer + BodyPoints + OrbitLines` subsystem inside the same R3F host.

That follow-up must preserve the same destination model and content binding rather than introduce a second system model.
