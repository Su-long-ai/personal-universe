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

## Galaxy → native System LOD bridge

Task `GALAXY-SYSTEM-SCALE-CONTINUITY-001` restores the full-scale renderer
composition present at the pinned MIT YEIS boundary instead of inventing a
transition scene. The Galaxy YEIS scene now keeps the pinned current-system
`BodyRenderer`, `BodyPoints`, and `OrbitLines` beside `StarPoints`.
This is the engine's original LOD contract: the catalogue renderer suppresses
the current system's star point while that same star and its local bodies are
represented by native meshes/points/orbits.

Scale-in to a stellar destination stays under the native
`CameraController`. If the target belongs to another frame, the engine first
calls `Universe.switchTo()` and `CameraController.shiftFrame()`, preserving
the absolute camera position while local coordinates change. The current-system
renderers are then retargeted to the new `StarSystem`; as apparent size grows,
their existing culling and point/mesh rules determine which detail becomes
visible. The product System renderer is not mounted during this native path.

The native endpoint is not a magic distance. `nativeSystemSpan()` is shared
with the product similarity adapter, and the Galaxy camera computes its arrival
distance with the same perspective sphere-fit formula and
`SYSTEM_OVERVIEW_FRAME_SCALE` used by camera-controls on the product side.
Task `GALAXY-SYSTEM-DIRECT-SCALE-COORDINATE-001` retains the pinned
`CameraController.goToPoint()` interpolation but replaces elapsed-time
progress with the normalized product coordinate: Galaxy=0 and System=1. Task
`GALAXY-NATIVE-SCALE-PROGRESS-EXECUTOR-001` makes that ownership explicit in
the retained controller: a progress override evaluates the native trajectory
at the requested coordinate without advancing `t` from frame time or invoking
normal timed completion at coordinate 1. Each wheel/trackpad sample therefore
scrubs the existing logarithmic native camera trajectory directly. No second
camera, tween loop, transition renderer or alternate LOD representation is
introduced.

The resulting `starId + position + quaternion + systemOverview` view state is
persisted continuously and written at coordinate 1. When product System takes
authority, `CinematicCamera` reuses that quaternion and the normal
viewport-aware System fit distance, so camera ownership changes without
resetting the view direction. A persistent bridge snapshot keeps the original
Galaxy endpoint, target star, approach direction and native arrival distance
across the renderer handoff. Reverse System→Galaxy reconstructs the same
pinned trajectory at coordinate 1 and scrubs it backward toward coordinate 0
rather than reinterpreting target-system kilometres or playing a separate
return animation.

Exact body Search/Places/click travel remains unchanged; only wheel scale travel
normalizes a body/content focus to its owning star before the System boundary.

Runtime evidence includes:

- `data-yeis-native-system="<star id>"`
- `data-yeis-native-system-ready="true"`
- `data-yeis-native-system-span-km`
- `data-yeis-native-system-overview="approaching:<star id>|<star id>"`
- `data-universe-travel-arrival-ratio`
- `data-universe-system-entry-view="yeis-native"`

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

The renderer handoff prefers one real paint at the matched endpoint, but that
preference has a 64 ms deadline. On healthy GPU rendering the paint path wins;
on throttled/software WebGL the composition-matched endpoint hands authority
over directly so sustained wheel input cannot be stranded at coordinate 1 or 2.
Repeated same-direction samples at an endpoint do not invalidate the scheduled
handoff. The reverse path mounts System at coordinate 2 while retaining the
selected planet as scale focus; if its body frame is not ready yet, the camera
holds the last Approach frame rather than snapping to the System overview. No
transition planet, fade, second camera, input replay queue or custom tween loop
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
- once a System scale target is locked, the selected close-world module can
  begin warming while the System renderer still owns presentation;
- the System renderer remains mounted across the semantic boundary until the
  close world has participated in two real composer frames, so lazy import or
  shader warmup cannot expose an empty Canvas;
- one `PlanetPass` is allocated with the stable EffectComposer and is enabled
  or parked as presentation changes; phase changes do not dispose and recreate
  the composer/pass pair;
- LOW quality always uses the lightweight fallback;
- AUTO quality falls back on software renderers such as SwiftShader/llvmpipe;
- HIGH quality explicitly requests the live renderer and is used by the
  release visual acceptance test.

The handoff exposes separate readiness layers instead of collapsing them into
one boolean:

1. `data-universe-world-scene-ready` means the close-world React/R3F scene is
   mounted. It is not permission to remove System presentation.
2. `data-universe-world-capability` identifies the concrete renderer capability
   selected for the current planet/quality/hardware identity.
3. `data-universe-world-paint-ready="true"` means that concrete renderer has
   participated in real visible frames. This is the only renderer signal used
   by `CinematicCamera` settlement and the System -> Approach presentation
   handoff.
4. `data-universe-camera-settled` remains camera-controls' physical arrival
   signal. It cannot be published for a close-world phase before first paint.
5. `data-universe-world-ready` and
   `data-universe-world-screenshot-ready` belong to pipeline convergence and
   capture acceptance. They may be stricter than first paint and never act as
   substitutes for it.

Returning to System invalidates first-paint authority even though the same
Planet/material resources remain warm. Re-entering Approach must therefore
paint the retained renderer again before System presentation is released.
Quality or planet identity changes invalidate the same token for the replacement
renderer, preventing readiness from leaking across capabilities.

Runtime evidence:

- `data-universe-world-renderer`
- `data-universe-world-capability`
- `data-universe-world-pipeline`
- `data-universe-world-ready`
- `data-universe-world-screenshot-ready`
- `data-universe-world-scene-ready`
- `data-universe-world-scene-lifecycle="prewarming|active|parked"`
- `data-universe-world-paint-ready="true"`
- `data-universe-world-pipeline-lifecycle="parked|active"`
- `data-universe-world-pipeline-allocations`

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

The software fallback texture is retained per planet for the shared Canvas
lifetime instead of being keyed to the active quality selector. LOW still uses
the intentional solid lightweight material, but switching LOW -> AUTO reuses
the already-generated map rather than rebuilding the DataTexture. HIGH on
software may keep that tiny map parked underneath the live world so a later
AUTO fallback can resume without CPU texture generation on the quality-change
path.

Runtime evidence:

- `data-universe-world-fallback-surface="generated-texture"` identifies the
  active AUTO/software generated-map path;
- `data-universe-world-fallback-texture-allocations` counts generated fallback
  map allocations and remains stable across LOW/AUTO/HIGH switches for one
  planet.

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
fallback begins real terrain construction and driver preparation during the
inward Atmosphere interval at the first idle/stable boundary instead of merely
mounting a dormant component and deferring `createInfiniteTerrain().prepare()`
until Surface. Once the instance exists, the hidden Atmosphere phase also uses
the detached landing view for bounded destination-ring streaming, so coordinate
5 does not have to start camera-centred chunk creation from zero. If navigation
reverses before construction begins, the scheduled prime is cancelled; if it
reverses after construction has begun, hidden streaming pauses immediately and
the same instance remains retained/parked for the next inward journey rather
than being restarted.

At coordinate 5, fallback presentation has an explicit readiness handoff. The
lightweight close-world globe remains the visible authority while the terrain is
still deferred/preparing. ProceduralTerrains Infinite World is camera-centred,
so hidden preparation uses a detached, non-rendered view at the exact fallback
landing frame rather than the still-visible globe camera. This view has no input
or tween authority; camera-controls remains the only product camera.

`SurfaceTerrain` publishes ready only after the complete initial radial chunk
ring exists around that landing view. Only then does the retained terrain become
the Surface renderer, the product camera begin its fallback local-frame move,
the close-world scene enter `parked`, and pipeline/screenshot readiness become
eligible. This keeps navigation coordinate ownership direct while preventing a
semantic Surface state from exposing either a partially streamed horizon or a
"ready" ring centred on the previous globe camera.

Once created, one retained Infinite World instance is reused; leaving Surface
hides the same scene and pauses its `terrain.update` call, but does not
synchronously dispose streamed GPU/chunk resources on the wheel transition path.
The retained instance is disposed only when its R3F Canvas host is actually
destroyed. This remains a bounded one-instance residency tradeoff, not a terrain
cache and not a second renderer or navigation authority.

Runtime evidence:

- `data-universe-surface-terrain-lifecycle="active"` while fallback Surface is visible;
- `data-universe-surface-terrain-lifecycle="parked"` after leaving Surface while the Canvas remains alive;
- `data-universe-surface-terrain-profile="infinite-software|infinite-hardware"` identifies the retained fallback world budget;
- `data-universe-surface-terrain-allocations` counts actual Infinite World construction attempts so rapid reversals/re-entry can prove the retained instance stayed singular;
- `data-universe-surface-terrain-ready-view="landing-prestream"` proves the accepted initial ring was streamed around the destination Surface view before presentation took ownership;
- `data-universe-surface-prewarm="scheduled|cancelled|preparing|ready"` distinguishes an idle prime cancelled before construction from an already-started retained preparation that may finish while parked.

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

Task `SCALE-RENDERER-CONTINUITY-001` moves the ownership boundary outward
without adding another renderer: once a planet focus is locked, the existing
close-world scene may prewarm while System still presents. The System scene
remains visible until the close world reports real painted frames. The
EffectComposer is now allocated once for the shared Canvas lifetime instead of
being keyed to LOW/AUTO/HIGH capability. PlanetPass is provisioned lazily only
when a live world is first requested, then retained and parked across later
fallback/quality switches; bloom is likewise retained and toggled rather than
rebuilt. This keeps AUTO/software cheap before a live request while preventing
quality changes from reallocating the complete post-processing chain. The live
ProceduralPlanets world follows the same lifetime rule: its resource identity is
planet + renderer class, not the current LOW/AUTO/HIGH selector. The package
marks `chunkRes` and `maxDepth` as structural rebuild keys, so real-GPU
quality does not blindly toggle those through `Planet.set()`. Warmup freezes
the first requested live structural tier: a direct HIGH entry constructs 32/6
immediately with no throwaway AUTO world, while an AUTO entry constructs 24/5.
An AUTO-first Planet promotes once to 32/6 on its first later HIGH request, and
that structural tier is never demoted for that Planet. Repeated LOW/AUTO/HIGH
cycles therefore cannot repeatedly throw away its LOD world.
Non-structural cloud quality, cloud resolution and split factor still follow
AUTO/HIGH through the package's live `Planet.set()` API. The last applied
dynamic profile is tracked per Planet, so a temporary LOW fallback followed by a
return to the same live quality does not even repeat that update. Software HIGH
keeps the bounded hosted-runner profile. Switching temporarily to a fallback
mode hides and parks that same live Planet instead of disposing it, so returning
to a live capability reuses the warmed world immediately. AUTO keeps its cheaper
initial structure unless the visitor has explicitly requested HIGH. LOW/AUTO-
software retain the same Surface terrain instance, with cancellable Atmosphere-
time preparation before the final boundary. Once a destination has actually
entered System/close-world ownership, UniverseCanvas also keeps that
PlanetScene mounted and parked through the reverse Galaxy endpoint while the
same Galaxy destination remains captured. The target's destination id is the
retention key: changing/clearing the Galaxy target unmounts the old world and
releases its GPU resources, so this is one bounded retained world rather than a
growing cache. Software WebGL never begins construction of a missing live
Planet while that retained scene is hidden; it only reuses an already-warmed
instance there.

Runtime evidence:

- `data-universe-world-pipeline-allocations` counts shared composer allocation;
- `data-universe-world-planet-pass-allocations` counts lazy PlanetPass allocation;
- `data-universe-world-planet-allocations` counts live Planet construction;
- `data-universe-world-live-profile` reports the currently active retained
  dynamic profile (`gpu-auto`, `gpu-high`, or `software-high`);
- `data-universe-world-live-profile-updates` counts actual dynamic
  `Planet.set()` profile applications;
- `data-universe-world-live-structure` reports the retained structural tier;
- `data-universe-world-structural-promotions` counts one-way AUTO -> HIGH LOD
  promotions;
- `data-universe-world-impostor-pixels` reports the retained PlanetRenderer's
  active impostor threshold. PlanetRenderer is lazy inside PlanetPass, so the
  pipeline applies the current threshold as soon as the renderer appears and
  does not credit that creation frame as first-paint evidence.

Live first-paint authority is also renderer-derived rather than a component-age
heuristic. The retained PlanetPass increments
`data-universe-world-live-draw-frame` only after an actual PlanetRenderer frame
reports at least one drawn planet and `pending=0`. PlanetScene snapshots that
counter when capability/presentation authority changes and exposes two stages.
The first concrete matched draw publishes
`data-universe-world-paint-started="true"`; UniverseCanvas then transfers only
the selected target body's presentation from System to close-world. The pinned
YEIS path reuses `BodyRenderer.byId` and hides that target `BodyView.group`
after the ordinary YEIS update, while the prototype fallback simply omits the
matching keyed `PlanetBody`. The star, orbit context and every other System
body remain visible. After two consecutive matched draw stamps PlanetScene
publishes `data-universe-world-paint-ready="true"`, and only then may the whole
System renderer leave. This removes the duplicate target planet without a fade,
mask, second renderer or blank ownership gap.

UniverseCanvas keys both paint-started and paint-ready authority by
`planet id + quality` rather than storing unqualified booleans. The current
identity is mirrored in a ref, so a callback whose captured identity is already
stale is discarded before it can mutate parent readiness at all. Old cleanup
work therefore cannot either authorize a new world or revoke a new world's
already-earned authority. Runtime diagnostics
`data-universe-system-handoff-target` and
`data-universe-system-target-suppressed` make the intermediate ownership stage
machine-verifiable.

Live pipeline convergence tokens are capability-scoped. Entering any fallback
mode clears the retained PlanetPass consecutive-stable-frame counter; returning
to live rendering must earn fresh `pending=0` frames before
`data-universe-world-ready` / screenshot readiness can be republished. First
paint remains a separate earlier authority and only requires that the concrete
`procedural-planets-pass` is installed and has painted consecutive frames.

Large renderer paths are lazy-loaded. The pinned native current-system LOD
resources now live inside the YEIS Galaxy scene for coordinate 0→1 and are
disposed with that scene; the product similarity-scaled native System renderer
is still constructed only when product System owns coordinate 1→2. Live
close-world ProceduralPlanets resources may begin prewarming during late System
after a scale target is locked, then remain mounted through Approach, Orbit,
Atmosphere and Surface. Crucially, the live `Planet` is not disposed and recreated at the
Atmosphere → Surface boundary; React keeps the same close-world component and
the same compositor path alive. The software/LOW Surface fallback is the one
intentional exception: after its first use, one generic ProceduralTerrains
instance remains parked under the shared Canvas so Surface → Atmosphere does not
perform synchronous resource destruction in the input-critical path. Only one close-world destination is retained at a time. It may coexist parked
with Galaxy for a captured reverse endpoint and may coexist visibly with System
for the short two-stage first-paint handoff above, but neither case introduces a
second Canvas, renderer, camera or destination authority. Clearing/changing the
captured destination releases the retained close-world resource set.

The product release gate validates both semantic arrival and renderer readiness;
screenshots remain evidence, not the authority for navigation state.

### Surface fallback transform boundary

ProceduralTerrains currently requires its terrain world transform to remain the
identity matrix. The fallback Surface path therefore stays at its native world
origin and reuses the legacy fallback camera shot. It is not parented, rotated
or scaled onto the live globe. The primary high-quality path remains the
continuous ProceduralPlanets globe; the fallback prioritizes correctness and
availability over pretending to share the live globe frame.
