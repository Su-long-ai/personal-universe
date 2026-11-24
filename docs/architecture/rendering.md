# Rendering architecture

Personal Universe keeps one product navigation model and one React Three Fiber
host. Rendering engines are reused as specialized visual authorities instead
of becoming competing application shells.

## Authority map

| Layer | Visual authority | Product authority |
| --- | --- | --- |
| Galaxy / deep sky | Pinned MIT YEIS | Shared destination model, Search / Places, Personal Signals, Journey |
| Native stellar system | Pinned MIT YEIS BodyRenderer / BodyPoints / OrbitLines | Product phase, camera, destination identity, content binding, click intent |
| Close world (Approach / Orbit / Atmosphere / Surface) | ProceduralPlanets `Planet` + `PlanetPass` when supported | Product camera, phase progression, world identity, content cards |
| Surface fallback | Existing ProceduralTerrains product surface scene | Product camera and content |
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

## Surface continuity

Task `PROCEDURAL-PLANET-SURFACE-HANDOFF-001` removes the primary-path
renderer swap at the final scale boundary.

For a live-capable terrestrial world, `PlanetScene` and the same
`PlanetPass` now stay mounted from Approach through Orbit and Atmosphere into
Surface. The surface camera moves into a near-ground tangent frame while the
same ProceduralPlanets cube-sphere quadtree continues refining underneath it.
No replacement globe or second spherical terrain engine is created.

Product-specific objects are ordinary Three.js overlays. Their live surface
anchor is derived through `Planet.getSurfacePoint()`, so the product marker is
placed against the terrain owned by ProceduralPlanets rather than against a
separate guessed sphere. The package's own geomorphed quadtree remains the
visual terrain authority.

Runtime evidence:

- `data-universe-surface-renderer="procedural-planets-live-surface"`
- `data-universe-surface-anchor-ready="true"`
- the existing `data-universe-world-renderer="procedural-planets-live"`
- the existing `data-universe-world-pipeline="procedural-planets-pass"`

If live rendering is intentionally disabled by LOW quality or an AUTO software
renderer, the existing ProceduralTerrains scene is retained and moved into the
same near-surface product frame. That fallback publishes
`data-universe-surface-renderer="procedural-terrains-fallback"`.

Task `SURFACE-FALLBACK-LIFETIME-001` makes that fallback resource follow the
Canvas lifetime instead of the Surface phase lifetime. The first fallback
Surface visit creates the existing `FiniteTerrain`; leaving Surface hides the
same scene and pauses its `terrain.update` call, but does not synchronously
dispose GPU/chunk resources on the wheel transition path. The retained instance
is disposed only when its R3F Canvas host is actually destroyed. This is a
bounded one-instance residency tradeoff, not a terrain cache and not a second
renderer or navigation authority.

Runtime evidence:

- `data-universe-surface-terrain-lifecycle="active"` while fallback Surface is visible;
- `data-universe-surface-terrain-lifecycle="parked"` after leaving Surface while the Canvas remains alive.

The retained fallback's heavy `terrain.update()` loop also reads the navigation
coordinator's existing phase ref as a synchronous stop signal. This is
read-only rendering glue, not another phase authority: the coordinator mutates
that ref before scheduling React state, so a hosted software-WebGL frame cannot
start new stale Surface terrain work after an outward intent.

ProceduralTerrains' finite runtime performs LOD/culling on every `update()`
and optionally drives its detail-page cache. On a software renderer the
fallback therefore disables that optional detail layer and invokes
`terrain.update()` only for the first visible view or a real camera/projection
change. Manual camera movement and resize still refresh terrain normally; a
stationary Surface no longer repeats identical SwiftShader work every frame.

The pinned runtime also documents that driver compilation inside
`FiniteTerrain.prepare()` cannot be interrupted. Hosted traces showed that
the original seven-octave/triplanar fallback could remain inside that compile
after the visitor had already requested Surface exit. The software profile
therefore keeps the same ProceduralTerrains runtime, seed and 72-unit footprint
but uses its supported lower-complexity configuration: 3 noise octaves,
4×4 larger chunks, 32/16/8/4 LOD segments, morphing off, detail off and
triplanar shading off. Real GPU fallback retains the original 6×6,
7-octave, 64/32/16/8, triplanar configuration.

Runtime evidence:
- `data-universe-surface-terrain-profile="software-performance"` on the software path;
- `data-universe-surface-terrain-profile="gpu-default"` on the real-GPU path.

Real-GPU fallback keeps the package's normal per-frame update cadence.

The retained Surface scene also consumes the same coordinator phase ref as a
render-time visibility stop. A Surface -> Atmosphere wheel event mutates that
ref synchronously; before the next R3F render the fallback group is hidden even
if React reconciliation is delayed by software WebGL. This prevents one stale
full terrain render from starving the reconciliation that would otherwise hide
the scene through the normal `phase` prop.

## Fallback rules

Fallbacks are product behavior, not hidden test exceptions:

1. If YEIS cannot boot, the existing V2 rollback remains available.
2. If a system is not backed by a YEIS native star id, `SystemScene` remains
   the system renderer.
3. If the native system adapter fails at runtime, it reports
   `prototype-fallback` and retains the existing system scene.
4. If live close-world rendering is unsuitable for the current quality/hardware
   tier, Approach/Orbit/Atmosphere retain the lightweight world and Surface uses
   the existing anchored ProceduralTerrains scene.
5. No fallback may create a second navigation/destination authority.

## Lifecycle and loading

Large renderer paths are lazy-loaded. Native system resources are constructed
only in the system phase and disposed on unmount. Live close-world
ProceduralPlanets resources exist only in close-world phases, now including
Surface. Crucially, the live `Planet` is not disposed and recreated at the
Atmosphere → Surface boundary; React keeps the same close-world component and
the same compositor path alive. The software/LOW Surface fallback is the one
intentional exception: after its first use, one generic ProceduralTerrains
instance remains parked under the shared Canvas so Surface → Atmosphere does not
perform synchronous resource destruction in the input-critical path. Galaxy,
system and live close-world rendering still do not need to remain resident
together, and no additional camera or destination authority is introduced.

The product release gate validates both semantic arrival and renderer readiness;
screenshots remain evidence, not the authority for navigation state.

### Surface fallback transform boundary

ProceduralTerrains currently requires its terrain world transform to remain the
identity matrix. The fallback Surface path therefore stays at its native world
origin and reuses the legacy fallback camera shot. It is not parented, rotated
or scaled onto the live globe. The primary high-quality path remains the
continuous ProceduralPlanets globe; the fallback prioritizes correctness and
availability over pretending to share the live globe frame.
