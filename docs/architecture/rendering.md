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

The outer native system is fitted to a shared product overview radius
(`SYSTEM_OVERVIEW_RADIUS = 7`) rather than moving the product camera into
astronomical kilometre ranges. The renderer keeps that geometry budget stable
across devices. `CinematicCamera` reuses camera-controls'
`getDistanceToFitSphere()` against the same radius and current camera
projection, so portrait/narrow viewports move the camera farther back instead
of clipping or shrinking the native system. The existing System view direction,
target, transition authority and settlement semantics stay unchanged.

Pinned YEIS body, point and orbit renderers emit camera-relative child
coordinates because their native floating-origin host keeps the camera at zero.
The R3F product camera instead remains at its real cinematic shot position. The
adapter therefore translates the shared native render-only sub-scene by the
current product camera position once per frame. This restores the scene-graph
world coordinates while preserving YEIS camera-relative distances, apparent
sizes and shader uniforms. Without this host translation the camera displacement
would be applied twice, making the whole native system appear artificially
small.

Product-only interaction remains a thin overlay. Invisible hit targets use the
same native body ids and call the existing `onSelectPlanet` contract.
Personal Signal planets receive a cyan product halo without changing YEIS body
identity or orbital data. Non-YEIS systems retain `SystemScene` as fallback.

The product's existing center/wheel focus is also fed back into the retained YEIS renderer instead of being redrawn by React. The focused native body id is passed to `OrbitLines.update(..., selectedId)`, which uses YEIS's own selected-orbit emphasis, and the same body receives a bounded `BodyRenderer` fill value so a resolvable disc remains readable. This is visual feedback for the existing focus authority; it does not create a second selection model, orbit layer or label system.

Runtime evidence:

- `data-universe-system-renderer="yeis-native"`
- `data-universe-system-ready="true"`
- `data-universe-system-focus="<product planet id>"`

## System → world scale bridge

Task `SYSTEM-WORLD-SCALE-CONTINUITY-001` removes the remaining product-camera
jump between the System renderer and Approach without overlapping renderers.
While System remains authoritative, the locked planet exposes only a narrow
render-space frame: product planet id, exact current center and rendered/physical
radius. Native YEIS supplies this directly from its current transformed body;
the product fallback computes the same contract from its existing compressed
orbit and mesh radius.

The existing `camera-controls` instance remains the sole camera executor.
Scale coordinate 1 is the viewport-aware System overview. From 1→2 the camera
target interpolates toward the locked body's current center while camera
distance interpolates logarithmically from the System overview distance to
`getDistanceToFitSphere(bodyRadius) * Approach.frameScale`. The viewing
direction and radius-relative target offset converge to the existing Approach
composition, so coordinate 2 has matched apparent framing even though renderer
coordinates change after the boundary.

The renderer handoff is deliberately delayed until the matched System endpoint
has had a paint opportunity. The reverse path mounts System at coordinate 2
while retaining the selected planet as scale focus; if its body frame is not
ready yet, the camera holds the last Approach frame rather than snapping to the
System overview. No transition planet, fade, second camera or custom tween loop
is introduced.

Runtime evidence:

- `data-universe-scale-position="1.xxx"`
- `data-universe-scale-camera-segment="system:approach"`
- `data-universe-system-scale-frame="awaiting|ready"`
- `data-universe-system-scale-radius`
- `data-universe-system-scale-distance`

## Close-world renderer

Approach, Orbit and Atmosphere keep the existing R3F canvas and the same
`camera-controls` camera authority. The product reuses ProceduralPlanets inside
that host. Task `WORLD-CONTINUOUS-SCALE-COORDINATE-001` continues the
normalized product scale coordinate (System=1, Approach=2, Orbit=3,
Atmosphere=4, Surface=5).
Wheel delta changes this coordinate directly. The camera resolves the existing
viewport-aware shot anchors on either side and reuses
`camera-controls.lerpLookAt()` with a reversible smoothstep interpolation;
React `UniversePhase` is now a semantic/rendering boundary rather than a
camera tween trigger.

This does not add a RAF loop, tween library or second camera. On software/LOW
fallback, Approach through Atmosphere still use the same continuous product
camera path. Only the final Atmosphere→Surface segment may fall back to the
existing semantic handoff because ProceduralTerrains intentionally owns a
different local surface frame. A live ProceduralPlanets world instead exposes
its terrain-derived Surface frame while the coordinate is still inside that
final segment, allowing the primary path to interpolate all the way to the
landing frame.

The product reuses ProceduralPlanets inside that host:

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

Task `WORLD-SOFTWARE-FALLBACK-TEXTURE-001` improves only the AUTO/software
representation without weakening that capability boundary. SwiftShader still
uses the same lightweight sphere, `MeshStandardMaterial`, product lights,
camera and phase contract; it never constructs the live ProceduralPlanets
world. The fallback now reuses Three.js' installed `ImprovedNoise` addon to
generate one deterministic 128x64 equirectangular `DataTexture` from the
planet seed and archetype. Noise is sampled on a unit sphere so longitude
wraps continuously, while archetype palettes provide ocean/land, rocky,
frozen, lava, giant-band and alien visual identity. The texture is generated
once per software-fallback planet, sampled by the existing material, and
disposed with the component. It adds no draw call, downloaded asset, custom
shader or second planet renderer. Explicit LOW quality intentionally retains
the older solid lightweight representation.

Runtime evidence:

- `data-universe-world-fallback-surface="generated-texture"` identifies the
  AUTO/software generated-map path.

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
renderer, the existing ProceduralTerrains subsystem remains the fallback inside
the same near-surface product frame. Task `SURFACE-INFINITE-FALLBACK-001`
uses the package's own `createInfiniteTerrain` world mode instead of exposing a
finite board edge. Infinite World follows the product camera with bounded
chunk streaming; software rendering uses a deliberately small radius, triangle
budget, creation rate and clipmap resolution. This is still the same installed
terrain subsystem, not a second terrain engine. The fallback publishes
`data-universe-surface-renderer="procedural-terrains-fallback"` and
`data-universe-surface-terrain-profile="infinite-software"` or
`"infinite-hardware"`.

Task `SURFACE-FALLBACK-LIFETIME-001` still owns the resource lifetime. The
first fallback Surface visit creates one retained Infinite World instance;
leaving Surface hides the same scene and pauses its `terrain.update` call, but
does not synchronously dispose streamed GPU/chunk resources on the wheel
transition path. The retained instance is disposed only when its R3F Canvas host
is actually destroyed. This remains a bounded one-instance residency tradeoff,
not a terrain cache and not a second renderer or navigation authority.

Runtime evidence:

- `data-universe-surface-terrain-lifecycle="active"` while fallback Surface is visible;
- `data-universe-surface-terrain-lifecycle="parked"` after leaving Surface while the Canvas remains alive;
- `data-universe-surface-terrain-profile="infinite-software|infinite-hardware"` identifies the retained fallback world budget.

Task `SURFACE-SOFTWARE-VISUAL-PROFILE-001` tested whether the software
fallback could gain useful visual depth from ProceduralTerrains' existing
height, palette, lighting and fog uniforms alone. Hosted-equivalent mobile
screenshots showed either destructive dark clipping at aggressive settings or
no material composition improvement at conservative settings, so none of those
terrain-profile changes were promoted.

Task `SURFACE-SOFTWARE-DEPTH-CUES-001` therefore reuses the product's
existing arrival-marker concept instead. On software rendering the marker is a
static, low-polygon Three.js beacon built from basic materials; it adds no
scene lights, continuous animation, imported asset, post-processing pass or
second renderer. The real-GPU path keeps its existing full beacon, moon and
lighting. A software-lite moon candidate was also screenshot-tested and rejected
because narrow/tablet framing made it read as a distracting floating disc.
Runtime evidence publishes
`data-universe-surface-depth-cues="software-beacon"` on the software path and
`"full"` on the real-GPU fallback.

Task `SURFACE-SOFTWARE-HORIZON-BLEND-001` then tested an exact solid
background match to ProceduralTerrains' installed default fog color. The
software screenshots remained materially unchanged, so that implementation was
reverted rather than promoted.

Task `SURFACE-SOFTWARE-HORIZON-GRADIENT-001` keeps the same Three.js Scene
background authority but replaces the software-only solid background with a
tiny generated 1x8 `DataTexture`. The static gradient remains near-black at
the zenith and lifts only the horizon band toward the terrain palette; it adds
no downloaded asset, mesh, animation, scene light, post-process pass or second
renderer. GPU fallback keeps its existing solid background plus Three.js fog.
Runtime evidence publishes
`data-universe-surface-horizon="generated-gradient"` on the software path.

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
