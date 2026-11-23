# Rendering architecture

Personal Universe keeps one product navigation model and one React Three Fiber
host. Rendering engines are reused as specialized visual authorities instead
of becoming competing application shells.

## Authority map

| Layer | Visual authority | Product authority |
| --- | --- | --- |
| Galaxy / deep sky | Pinned MIT YEIS | Shared destination model, Search / Places, Personal Signals, Journey |
| Native stellar system | Pinned MIT YEIS BodyRenderer / BodyPoints / OrbitLines | Product phase, camera, destination identity, content binding, click intent |
| Close world (Approach / Orbit / Atmosphere) | ProceduralPlanets `Planet` + `PlanetPass` when supported | Product camera, phase progression, world identity, content cards |
| Surface | Existing product surface scene | Product camera and content |
| V2 rollback / non-native system | Existing product renderer | Existing product model |

The reusable YEIS source boundary is fixed at
`e52056897364e060fbd6d00951628f163b57d7a1`. Newer upstream AGPL code is not
copied into this repository.

## Native system adapter

YEIS renderer shaders are authored around a floating origin where the camera is
at zero and all positions/radii are expressed in one physical length unit. A
Three.js parent-scale transform would therefore make shader world positions and
lighting uniforms disagree.

The product adapter instead builds a render-only similarity-transformed
`StarSystem` from the same pinned YEIS body graph:

- native body ids and hierarchy are preserved;
- all lengths are multiplied by one system scale `s`;
- masses are multiplied by `s³`, preserving gravity/orbit similarity;
- linear velocities are multiplied by `s`;
- orbital periods and dimensionless elements are preserved;
- JPL/simple Kepler states are frozen to equivalent J2000 simple elements for
  the product overview;
- ring radii and gap widths use the same length scale;
- mission/trajectory spacecraft are excluded from the overview renderer;
- the transformed system is render-only and never becomes a navigation or
  content authority.

The outer native system is fitted to the existing product system shot rather
than moving the product camera into astronomical kilometre ranges.

Product-only interaction remains a thin overlay. Invisible hit targets use the
same native body ids and call the existing `onSelectPlanet` contract.
Personal Signal planets receive a cyan product halo without changing YEIS body
identity or orbital data. Non-YEIS systems retain `SystemScene` as fallback.

Runtime evidence:

- `data-universe-system-renderer="yeis-native"`
- `data-universe-system-ready="true"`

## Close-world renderer

Approach, Orbit and Atmosphere keep the existing R3F canvas and cinematic
camera. The product reuses ProceduralPlanets inside that host:

- a lightweight product sphere appears immediately;
- live `Planet` construction is delayed until the initial navigation frame is
  stable;
- `PlanetPass` is inserted into the existing EffectComposer only for the live
  path;
- LOW quality always uses the lightweight fallback;
- AUTO quality falls back on software renderers such as SwiftShader/llvmpipe;
- HIGH quality explicitly requests the live renderer and is used by the
  release visual acceptance test.

Runtime evidence:

- `data-universe-world-renderer`
- `data-universe-world-pipeline`
- `data-universe-world-ready`
- `data-universe-world-scene-ready`

A live HIGH world is accepted only when the renderer reports
`procedural-planets-live`, the pipeline reports
`procedural-planets-pass`, and `data-universe-world-ready="true"`.

## Fallback rules

Fallbacks are product behavior, not hidden test exceptions:

1. If YEIS cannot boot, the existing V2 rollback remains available.
2. If a system is not backed by a YEIS native star id, `SystemScene` remains
   the system renderer.
3. If the native system adapter fails at runtime, it reports
   `prototype-fallback` and retains the existing system scene.
4. If live close-world rendering is unsuitable for the current quality/hardware
   tier, the lightweight world remains visible and signals readiness through
   the fallback pipeline.
5. No fallback may create a second navigation/destination authority.

## Lifecycle and loading

Large renderer paths are lazy-loaded. Native system resources are constructed
only in the system phase and disposed on unmount. Close-world renderer resources
exist only in close-world phases. Galaxy rendering, native system rendering and
live close-world rendering therefore do not need to remain resident together.

The product release gate validates both semantic arrival and renderer readiness;
screenshots remain evidence, not the authority for navigation state.
