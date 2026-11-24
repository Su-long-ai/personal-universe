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

Runtime evidence:

- `data-universe-world-renderer`
- `data-universe-world-pipeline`
- `data-universe-world-ready`
- `data-universe-world-scene-ready`
- `data-universe-world-scene-lifecycle="prewarming|active"`
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

### Surface world product model

Task `SURFACE-WORLD-PRODUCTIZATION-V3-001` adds one semantic Surface model
above the existing renderer choices. `buildSurfaceWorldProfile(planet)` is a
pure deterministic adapter over `PlanetDefinition`: the stable planet seed,
archetype, hero identity and already-attached content entries derive the biome,
atmosphere, light, terrain parameters, landing point, regions, paths, landmarks
and content anchors. It is product/layout state only; it is not another terrain,
camera, navigation or content authority.

The same profile is consumed by both renderer adapters:

- the primary ProceduralPlanets path keeps the existing live planet and projects
  the generated product geography into the landing tangent frame returned by
  `Planet.getSurfacePoint()`;
- the ProceduralTerrains Infinite fallback consumes the same terrain seed,
  palette, lighting, landing point and product layout while retaining its
  camera-centred world transform;
- Astro Content Collections and the existing planet `content` array remain the
  only authored content source. Surface content anchors spatialize those entries
  by stable placement key instead of copying them into a Surface-only CMS.

Hero worlds set `authored=true` and receive denser geography through the same
model. Generated and observed terrestrial archetypes automatically expose
`surface-terrain` and can therefore become complete Surface destinations
without per-world scene authoring. Task `SURFACE-YEIS-SECONDARY-WORLDS-001`
applies the same archetype capability rule inside the default YEIS bridge:
native terrestrial secondary bodies are ordinary Surface destinations too,
while gas and ice giants remain orbit-only. The bridge does not introduce a
YEIS-specific terrain or content model; it only exposes capability metadata to
the same downstream Surface product layer. Gas and ice giants retain
`surfaceMode="none"`; even a forced deep link must not invent a ground layer.

The product UI reads this same profile to show biome, region, landmark and
content-location context. Multiple world-content cards are laid out as one
bounded readable stack rather than competing absolute overlays, so Surface
remains a page-like destination instead of a game HUD or a separate application.

Content hierarchy is also derived from the existing content model rather than
authored again for Surface. Featured or high-importance entries become
`primary` signals, normal active entries become `secondary`, and low-weight
entries remain `ambient`. Stable content placement keys still own coordinates;
priority changes presentation order and emphasis without changing an entry's
terrain anchor. Deterministic clusters group those anchors into reusable
region-level presentation units. Both ProceduralPlanets and ProceduralTerrains
consume the same ranked anchors and clusters.

When the active YEIS destination is a Personal Signal, the existing
`personal:<entryId>` destination remains the single focus authority.
`UniverseApp` derives the matching Surface entry from the selected planet and
publishes `data-universe-surface-focus-entry` throughout the close-world
journey. Surface renderers translate that identity to the existing deterministic
anchor and publish `data-universe-surface-focus-anchor`; they do not create a
second navigation target. Focus temporarily outranks display importance so the
requested signal and its cluster remain visible during 4→5, while the underlying
anchor priority and coordinates stay unchanged. The world-content stack uses
the same ordering from Approach onward, including narrow layouts that only keep
the first two Surface cards.

This shared hierarchy is scale-aware. During the live Atmosphere→Surface
interval the tangent overlay exposes only the highest-ranked signal and cluster,
then expands at Surface without changing their coordinates. The bounded
software fallback keeps the top-ranked signals rather than an arbitrary id
slice. On narrow Surface layouts the product UI shows the first two ranked cards
and keeps the destination copy below them; no fake content is generated for a
secondary world whose existing content array is empty.

Pointer/touch exploration continues to reuse the one `camera-controls`
authority. Its wheel action remains disabled, so wheel/trackpad scale input
continues to belong exclusively to the continuous-scale coordinator and can
leave Surface immediately. When pointer/touch exploration has changed the
Surface camera, the same controller's current position/target is retained as a
world- and renderer-scoped Surface endpoint. Reverse 5→4 scale motion and a
same-world return therefore use the explored frame without introducing another
camera store or another interpolation loop. Renderer-mode or world identity
changes invalidate the retained endpoint.

Runtime evidence is shared across live and fallback paths:

- `data-universe-surface-profile="surface:…"` identifies the deterministic
  semantic world;
- `data-universe-surface-biome` publishes the selected world archetype style;
- `data-universe-surface-landmarks` and
  `data-universe-surface-content-anchors` expose generated layout density;
- `data-universe-surface-content-clusters` and
  `data-universe-surface-primary-signals` expose the shared semantic hierarchy;
- live Surface additionally publishes
  `data-universe-surface-layout-tier="transition|full"`,
  `data-universe-surface-layout-signals`, and
  `data-universe-surface-layout-clusters` so the 4→5 content handoff can be
  validated independently of camera settlement;
- fallback additionally publishes
  `data-universe-surface-terrain-instance` as the retained terrain identity;
  repeated 4.6↔5 reversals must preserve that identity while lifecycle changes
  only between `parked` and `active`;
- fallback additionally publishes
  `data-universe-surface-terrain-world="<same profile id>"`, proving the
  terrain adapter and product layout are using the same world identity.

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
fallback begins preparing during the inward Atmosphere interval at an
idle/stable boundary instead of waiting for the Surface boundary. If navigation
reverses before construction begins, the scheduled prime is cancelled. Once
created, one retained Infinite World instance is reused; leaving Surface hides
the same scene and pauses its `terrain.update` call, but does not synchronously
dispose streamed GPU/chunk resources on the wheel transition path. The retained
instance is disposed only when its R3F Canvas host is actually destroyed. This remains a bounded one-instance residency tradeoff,
not a terrain cache and not a second renderer or navigation authority.

Runtime evidence:

- `data-universe-surface-terrain-lifecycle="active"` while fallback Surface is visible;
- `data-universe-surface-terrain-lifecycle="parked"` after leaving Surface while the Canvas remains alive;
- `data-universe-surface-terrain-profile="infinite-software|infinite-hardware"` identifies the retained fallback world budget;
- `data-universe-surface-prewarm="scheduled|cancelled|preparing|ready"` exposes the cancellable prime lifecycle.

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
remains visible until the close world reports real painted frames, and the
EffectComposer plus PlanetPass are parked rather than rebuilt when presentation
is inactive. The same Planet/material/LOD identity therefore survives forward
and reverse travel. LOW/AUTO-software retain the same Surface terrain instance,
with cancellable Atmosphere-time preparation before the final boundary.

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

### Surface spatial-focus budget

Both the live ProceduralPlanets tangent layout and the retained
ProceduralTerrains fallback consume the same deterministic
`SurfaceWorldProfile`. When a content signal is focused, render-budget ranking
promotes only the associated signal, cluster, region and landmark; unrelated
generated ordering is left intact. This matters most on software/LOW tiers,
where only a bounded subset of landmarks and regions is drawn.

The focused objects are presentation cues, not a new renderer authority. When
a focused signal is attached to a generated landmark that already belongs to
the bounded path network, that existing path is promoted/highlighted as part of
the same context; focus never synthesizes extra roads or increases geometry
density. 3D signal clicks and the equivalent DOM card/cluster controls feed the
same local Surface focus callback, while the existing CinematicCamera and
destination coordinator retain camera and navigation ownership.

The live renderer, fallback renderer and Surface card layer share one bounded
content budget: one signal during transition, three in software mode and six in
stable/full presentation. Focus ranking can promote an otherwise out-of-budget
signal into that window, so selecting content never requires expanding geometry
or DOM cost with total content size.

Cluster controls are deliberately not capped to the renderer's 3D signal
budget. Every generated content cluster remains represented in the DOM, and
repeated activation cycles through that cluster's signals in deterministic
priority/title order. This keeps all content reachable when software/LOW
rendering or narrow layouts intentionally draw/show fewer anchors and cards.
