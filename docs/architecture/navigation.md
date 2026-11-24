# Universe Navigation

**Status:** YEIS is the default universe engine. Search, Places, canvas picking,
deep links, Personal Signals, native spatial travel and guided journeys share one
destination model.

**License boundary:** YEIS code/semantics in this subsystem are pinned to MIT
commit `e52056897364e060fbd6d00951628f163b57d7a1`. Current upstream AGPL
code is not copied into Personal Universe. Old localized labels from the pinned
Places catalogue are source lookup refs only; product copy is owned here and is
English/neutral.

## One navigation model

`src/lib/universe/yeis/navigation.ts` is the narrow adapter between product
intent and YEIS.

The product does **not** maintain separate Search, Places, canvas and deep-link
routers. They all resolve a `UniverseNavigationDestination`, then call the same
execution path in `UniverseApp`.

Destination targets are intentionally small:

- `star(nativeId)`: open a YEIS star/system through the existing product
  resolver;
- `marker(markerId)`: observed NASA host without a native YEIS star identity;
- `body(starId, bodyId)`: exact native YEIS system body;
- `observed-body(markerId, bodyId)`: exact NASA observed planet in the
  existing v2 host-system resolver;
- `content(nativeId, markerId, entryId)`: exact Personal Signal;
- `blackhole(id)`: exact pinned-YEIS black-hole body;
- `landmark(index)`: non-stellar deep-sky target;
- `galaxy(index)`: galaxy-centre target.

Camera requests are derived from those destinations rather than being authored
by UI components.

## Search

The single navigator input searches, in product-priority order:

1. Content Collection entries / Personal Signals;
2. Hero world;
3. observed exoplanet hosts;
4. real observed exoplanets from the existing NASA Exoplanet Archive snapshot;
5. bodies in the currently open product system;
6. current/native YEIS bodies and bodies in other hand-authored systems;
7. catalogue stars;
8. black holes;
9. landmarks, nebulae and clusters;
10. galaxies.

Personal content searches title, summary, tags, kind and status. Common Chinese
astronomical aliases are translated into the same normalized YEIS query path
without adding a second astronomy index. The pinned MIT normalization remains
the canonical accent/case folding behavior.

Results are grouped. Personal content is intentionally ranked before generic
astronomy. The keyboard contract is:

- `Ctrl/Cmd+K` or `/` outside text editing: open navigator;
- `ArrowUp / ArrowDown`: move selection;
- `Enter`: Open / Travel;
- `Shift+Enter`: Locate in galactic view;
- `Escape`: close.

The vendored YEIS `Input.isTyping()` check prevents the 3D hotkey layer from
claiming keystrokes while the input is focused.

## Navigation failure recovery

Native YEIS camera failures remain part of the same shared destination
execution path. `UniverseApp` preserves the exact failed
`UniverseNavigationCameraRequest` and renders one persistent, non-modal
recovery notice rather than falling back to console-only diagnostics.

The notice follows the pinned-MIT YEIS single-notification concept without
copying the legacy UI implementation. It is announced as an ARIA alert, does
not take focus, and does not auto-dismiss. `RETRY` only refreshes
`requestId` and reissues the same camera target/mode through
`YeisGalaxyScene`; it does not re-resolve to a different destination or
create another navigation authority. `DISMISS` clears only the active error
feedback. Any new Search/Places/Canvas navigation or a successful native
arrival clears stale failure state.

A full toast queue/provider was intentionally not introduced: the product has
one authoritative native navigation request at a time, so Radix/React Aria
toast machinery would add queue and focus infrastructure without improving the
destination contract.

## Navigator interaction lifecycle

The Navigator keeps YEIS/shared destination resolution authoritative while the
React shell owns only presentation lifecycle.

- changing the query immediately invalidates the previous rows and marks the
  result region busy before the debounced search starts, so a former Places row
  cannot be activated as if it matched the new query;
- loading has a visible `Scanning destinations…` state rather than a blank
  list;
- Open/Travel and Locate expose a single pending action, disable competing row
  actions, and close the dialog only after the shared destination executor
  accepts the action;
- an immediate resolver/executor rejection stays visible in the dialog instead
  of becoming console-only;
- ArrowUp/ArrowDown, Enter, Shift+Enter and Escape remain the same keyboard
  contract and do not introduce a second selection/search authority.

cmdk and XState were evaluated for this lifecycle. cmdk has strong generic
loading/empty/group primitives but would duplicate selection/filter plumbing
while dual Open/Locate remains custom; XState is disproportionate for the small
local state surface. Existing React state/refs/effects therefore close this gap
around the retained pinned-MIT YEIS destination model.

## Places / Destinations

With an empty query the same navigator becomes a grouped Places surface.

Personal groups are generated directly from Astro Content Collections and
placement data:

- Personal Signals
- Featured
- Projects
- Research
- Experience
- Artifacts
- Notes

There is no second handwritten portfolio list.

Astronomical groups reuse stable refs from pinned MIT `src/ui/places.ts`:

- Observed Exoplanet Hosts
- Observed Exoplanets generated from the same NASA snapshot already used by the
  v2 observed-system resolver
- Planets & Bodies, including the pinned Solar System / mission destinations
- Stars
- Black Holes
- Nebulae, Clusters & Landmarks
- Galaxies

The product layer supplies English/neutral names. Legacy Turkish source strings
are retained only where a pinned catalogue lookup requires the original ref.

The current destination receives explicit visual state and all sections remain
operable on narrow/mobile layouts. Places presentation assigns each destination
to its first visible group, so one Personal Signal is not repeated again under
Featured or its content-kind facet. The underlying grouped sections remain
intact for Guided Journey derivation and Search semantics; this is display
de-duplication, not a second destination index.

## Product Open vs native travel

Personal Universe intentionally combines its React product scenes with YEIS
native travel instead of rebuilding either side.

### Product-open path

Catalogue stars, native-mapped observed hosts, Hero and Personal Signals resolve
through the existing product system adapter.

A Personal Signal destination carries the Content Collection `entryId`.
Opening it resolves the system and then selects the planet that
`attachContentToSystem()` actually attached that entry to. The app therefore
enters the exact generated signal planet rather than merely opening its star.

Hero resolves to the HELION system and AURORA-01 body.

If an ordinary pinned body also exists as a product planet, the same path opens
that product planet.

### Native fallback path

Some pinned Places bodies are moons, spacecraft or otherwise not represented by
the current React `PlanetDefinition` model. Those destinations do not degrade
to "open the Solar System". They fall back to pinned YEIS native semantics:
switch the YEIS reference frame when needed and call
`CameraController.goTo()` on the exact body.

Black holes always use the exact pinned `blackHole.entry.bodyId` after
switching to the owning system.

Star-type landmarks are real systems in pinned YEIS and therefore resolve as
star/system destinations. Non-stellar landmarks stay spatial.

### Spatial path

Pinned MIT arrival behavior is preserved:

- galaxy: `goToPoint` at approximately `2.6 * galaxyRadius`, with disc-normal
  approach;
- non-stellar landmark: `3.2 * radius`;
- remnant landmark: `5 * radius`.

The native `CameraController` remains the single camera-flight authority.
Personal Universe does not animate a competing R3F camera.

Native galaxy camera position/quaternion are retained across React phase
changes.

## World arrival and progressive planet bake

Product arrival state is authoritative before high-cost visual refinement.
When a destination resolves to a product `PlanetDefinition`, the app enters
`approach`, updates the shared destination/deep-link identity, and renders the
existing lightweight planet fallback immediately.

The adopted `procedural-planets` `bakePlanet()` representation remains the
hardware-world refinement layer, but its own documentation notes that baking
blocks the GPU and should be treated as loading work. `PlanetScene` therefore
renders the lightweight world first, leaves an intentional 1.8s interaction
window in which quick travel/return can cancel the refinement entirely, and only
then starts the deterministic bake in an idle slot. Auto quality uses a 512px
bake and explicit high quality retains 1024px.

Software WebGL renderers (SwiftShader/llvmpipe/softpipe) and explicit low-quality
mode keep the interactive fallback instead of invoking `bakePlanet()`. Cloud
traces showed software baking could block the page for roughly 20+ seconds,
including preventing an in-flight navigation/reload from being aborted. This is
a renderer capability fallback, not a different navigation or world identity.
The root element exposes `data-planet-render-mode` for runtime evidence
(`fallback-software-renderer`, `fallback-low-quality`, `fallback-warmup`,
`baking`, `baked`, or `fallback-error`).

This is a rendering/lifecycle optimization only. It does not change destination
identity, Search/Places semantics, the native-body fallback rule, or the
Galaxy → System → Planet → Approach contract. In particular Earth remains a
product planet (`body:c0/earth` → `c0/earth` at `phase=approach`); moons or
spacecraft absent from `PlanetDefinition` continue to use exact native YEIS
travel.

## Viewport-aware world framing

Product-world framing reuses the already-installed `camera-controls` camera
authority rather than maintaining separate desktop/tablet/mobile shot tables.
`PLANET_RENDER_RADIUS` is shared by the fallback and baked planet
representations. For Approach and Orbit, the cinematic transition remains owned by the same
`camera-controls` instance, while the final camera distance comes from
`CameraControls.getDistanceToFitSphere(PLANET_RENDER_RADIUS)` multiplied by a
small phase-specific breathing-room factor.

Task `WORLD-ARRIVAL-CINEMATIC-CONTINUITY-001` also keeps Orbit and Atmosphere
on the same illuminated hemisphere as the canonical live Surface anchor. Only
the existing shot azimuth/elevation changes: the ProceduralPlanets sun model,
fit distance, phase semantics, settlement generation guards and terrain-derived
Surface frame stay unchanged. This removes the near-black high-quality Orbit
composition and avoids the previous large camera reversal immediately before
landing.

Because `getDistanceToFitSphere()` uses the active camera's effective FOV and
aspect ratio, portrait viewports automatically move farther away when the
horizontal FOV is the limiting dimension. A resize/orientation change recomputes
the shot through the same control instance; no device-specific camera authority
is introduced.

Camera acceptance is based on the real current control state, not its target
end-state. `getPosition(..., false)` and `getTarget(..., false)` must reach
the shot tolerances before the root publishes
`data-universe-camera-settled=<phase>` and before visual screenshots are
captured. This prevents a transition command from being mistaken for a settled
camera simply because camera-controls has already stored its destination.

## Manual product-world camera takeover

Product-world exploration reuses the same `camera-controls` instance that owns
cinematic shots. No `OrbitControls`, second camera, or parallel navigation
authority is mounted.

Manual input is intentionally available only after the visitor reaches a stable
`system`, `orbit`, or `surface` phase:

- left-drag rotates around the current destination target;
- middle drag may dolly inside the stable product-world phase;
- one-finger touch rotates;
- two-finger touch keeps the existing touch exploration behavior;
- right drag and truck/pan remain disabled, so manual exploration cannot drift
  the authoritative destination target away from the selected world/system.

The **mouse wheel is no longer a local camera dolly**. It is reserved for the
continuous-scale coordinator described below, so YEIS, camera-controls and the
product shell cannot interpret the same wheel event as three different camera
commands.

`approach`, `atmosphere`, and `returning` remain cinematic transitions.
When drag/touch manual control starts, the current shot is marked overridden,
settled evidence is cleared, and the root publishes
`data-universe-camera-mode="manual"`. The current destination, phase and deep
link stay unchanged.

If a Guided Journey is active, direct camera takeover stops that Journey
immediately. This reuses pinned MIT TourPlayer's interruption rule: user camera
intent wins, and orchestration must not fight the visitor for the same camera.

## Continuous wheel scale navigation

Implemented under task `CONTINUOUS-SCALE-WHEEL-NAV-001`.

The default YEIS product now treats the mouse wheel as one **continuous scale
intent**, not as a free-flight speed control in the galaxy plus a second dolly
control in product-world scenes.

The retained stack remains unchanged:

- pinned MIT YEIS owns galaxy-scale coordinates, camera travel, catalogue
  picking and native system/body identity;
- the existing product destination model owns what a target means;
- the existing `camera-controls` instance owns smooth System/Approach/Orbit/
  Atmosphere/Surface camera shots;
- ProceduralPlanets owns the close-world visual tier where that world supports
  it.

Personal Universe adds only a coordinator that converts wheel gestures into
focus-preserving scale transitions. No second camera, RAF loop, renderer,
spatial index or router is introduced.

### Focus

At galaxy scale, the scene reuses existing YEIS projection/picking primitives
at the viewport centre. Explicit centre focus wins, with eligible priority:

1. Personal Signal;
2. Hero world;
3. observed host;
4. catalogue star;
5. procedural star.

The fresh opening view also has one **soft focus** fallback so a visitor can
start diving with the wheel even when the auto-orbit composition has no object
inside the centre-pick radius. That fallback prefers the first Personal Signal,
then the Hero world, then a native catalogue star. It is consumed by the first
scale-in gesture and is permanently disabled as soon as drag, touch, pinch,
pan or keyboard camera input shows that the visitor has taken spatial control.
After takeover, an empty centre remains empty instead of snapping back to a
product-selected target.

A completed **Locate** has affinity over coincident centre-screen overlays until
the visitor manually changes the camera. This reuses the same pending/current
semantics as Search/Places/Canvas navigation.

At system scale, the already-rendered planet positions are projected to the
viewport centre. The nearest eligible planet inside the bounded focus radius is
reported to the coordinator. No separate planet-position database is built.

For Hero/Personal destinations, the galaxy-scale destination is carried into
the opened system as a preferred planet intent. This means the visitor does not
have to reacquire AURORA-01 after crossing from the galaxy into HELION.

### Scale ladder

Wheel-in and wheel-out are reversible over the existing product ladder:

```text
Galaxy
  ↕
YEIS native star travel / focus
  ↕
Stellar System
  ↕
Approach
  ↕
Orbit
  ↕
Atmosphere
  ↕
Surface
```

The first inward wheel gesture on a centred galaxy target uses existing YEIS
native camera travel. A further inward gesture after that target is promoted to
the current destination enters the stellar-system renderer. If the visitor
continues scrolling while native locate/travel is still settling, one
enter-system intent is queued and consumed only after the existing destination
becomes current; a competing camera request is not created.

Inside the system, an inward gesture opens the current/preferred planet at
`approach`. Product-world scale then advances over the same phase ladder, but
wheel input is not discarded while a cinematic shot is moving. Additional
same-direction threshold crossings are queued as scale intent and consumed as
soon as each camera boundary settles, so a sustained wheel gesture can flow
through Orbit and Atmosphere without requiring stop-scroll-stop repetition.
Changing direction clears the queued intent and retargets one phase in the
opposite direction immediately.

Wheel-out performs the exact reverse ladder. At System it returns to the
retained YEIS galaxy view; farther out it can travel back toward the Milky Way
overview.

### Wheel ownership and hysteresis

Exactly one layer owns mouse-wheel scale input:

- YEIS `Input.wheel` is zeroed before the native CameraController update;
- camera-controls has its wheel ACTION disabled;
- the product coordinator accumulates small trackpad deltas and applies
  two-stage direction hysteresis: a lone tiny sample expires quickly, while an
  established same-direction gesture keeps its partial progress through short
  renderer/main-thread stalls.

Traditional mouse-wheel notches therefore feel immediate while fine trackpad
noise must accumulate before a scale boundary is crossed. A phase transition
itself serializes committed steps: extra input is queued while the camera is
unsettled, but distinct wheel events are never discarded solely because they
arrived inside a wall-clock cooldown. Changing direction clears queued intent
and resets the gesture lock.

Opening-galaxy auto-orbit yields on the first wheel scale gesture, and the same
gesture is still processed as scale intent. Manual spatial takeover disables
the opening soft-focus fallback so subsequent wheel navigation follows only
what is actually centred.

### Surface capability boundary

Continuous navigation does not claim every generated body has a terrain
surface. `PlanetSurfaceMode` remains authoritative.

- `surface-terrain` / `custom` worlds may continue through Atmosphere to
  Surface;
- `none` worlds stop at Orbit and publish a blocked scale boundary rather
  than inventing terrain.

Today AURORA-01 is the canonical full Galaxy → System → Planet → Surface
acceptance path. Ordinary generated and observed worlds remain astronomically
valid even when their current product representation stops at Orbit.

Search, Places, canvas clicks, deep links and Guided Journeys remain direct
entry paths into the same destinations. Continuous wheel navigation changes
interaction continuity, not destination identity.

## Canvas picking

Both galaxy-scale and system-scale canvas interactions route back into the
same destination model. In the system view, a clicked planet is adapted to the
same Personal Signal / observed-exoplanet / native-body / Hero destination used
by Search, Places and deep links. The legacy direct planet callback remains only
for the `?engine=v2` rollback path or an unmappable fallback.

In the native YEIS galaxy view, pick priority is:

1. Personal Signal overlay;
2. Hero;
3. HIP-less observed host overlay;
4. LandmarkSprites;
5. GalaxySprites;
6. catalogue stars;
7. procedural stars.

Signal clicks therefore open the exact content planet. Landmark and galaxy
picking use the pinned MIT renderers' pick APIs instead of a second spatial
index.

A completed **Locate** adds one bounded semantic exception without changing
that global priority: while the native camera remains untouched after settling,
a click inside the normal canvas-center hit radius resolves to the exact
destination that was just located. This prevents unrelated sky overlays that
happen to project near the same center pixel from stealing the deliberate
Locate target. The affinity is one-shot and is cleared by a new navigation
request or any manual camera input; clicks away from center continue through
the priority list above.

## Personal Signal semantics

Signals remain generated from Content Collections; no fake biography/project
entries are created.

In the galaxy:

- signals use a distinct cyan overlay;
- point size/opacity receive a small pulse;
- desktop hover projects the actual signal positions and shows content title
  and kind;
- touch/coarse-pointer users rely on direct picking instead of hover;
- the geometry capacity is derived from content count rather than the former
  fixed 256-entry allocation.

In a system, the existing content planet emissive + cyan wireframe halo remains
the visual language. The content card continues to be driven by the attached
entry rather than duplicated metadata.

This scales naturally when the collection grows from a handful of entries to
tens or hundreds: placement, search, hover and picking iterate the generated
placement list.

## Deep links

Destination deep links use the same resolver and executor:

```text
?destination=hero:aurora-01
?destination=personal:<content-entry-id>
?destination=star:<native-star-id>
?destination=body:<star-id>/<body-id>
?destination=exoplanet:<marker-id>:<planet-name>
?destination=blackhole:<black-hole-id>
?destination=landmark:<landmark-id>
?destination=galaxy:<galaxy-index>
?destination=observed:<marker-id>
```

Appending `&navigation=locate` requests Locate rather than Open/Travel.

Normal product navigation also mirrors the currently open cinematic world into
the existing native YEIS query identity:

```text
phase=<system|approach|orbit|atmosphere|surface>
star=<native-star-id>
body=<native-body-id>   # when a world is selected
```

This is supplementary state, not a second router. `destination` remains the
cross-scale identity for Personal Signals, observed hosts/exoplanets, galaxies,
landmarks and black holes, and wins when both contracts are present. The
`phase/star/body` form remains reloadable for native YEIS stars/worlds and is
kept in sync as the cinematic phase advances. Returning to Galaxy clears the
spatial world identity. URL mutation uses `URLSearchParams` plus the browser
History API, preserving unrelated parameters such as `engine`, diagnostics and
feature flags without introducing a client router.

## Landmarks and assets

`LandmarkSprites`, landmark image metadata, physical coordinates and
navigation semantics come from the pinned MIT boundary.

The runtime exposes diagnostics for smoke tests:

- `data-yeis-native-galaxy=ready`
- `data-yeis-landmarks=<count>`
- `data-yeis-landmark-photos=<declared-count>`
- `data-yeis-landmark-photos-requested=<atlas-request-count>`
- `data-yeis-landmark-photos-loaded=<successful-image-count>`
- `data-yeis-landmark-photos-failed=<failed-image-count>`
- `data-yeis-landmark-photos-complete=1` when the real image requests settle
- `data-yeis-picked-target=<destination-id>`

The pinned image set contains 15 deep-sky photographs. Source/license credits
remain in `public/THIRD_PARTY_ASSETS.md`; the host must not substitute assets
from current AGPL YEIS.

## Guided journeys

Journeys are deliberately orchestration, not a second navigation state machine.

The pinned MIT `src/core/TourPlayer.ts` was evaluated rather than ported
wholesale. Three core ideas are retained:

- a user-initiated navigation interrupts the running journey;
- automatic progression waits until navigation is settled, then applies a
  short destination dwell;
- step changes own and clean up only their temporary orchestration state.

Its narration manifests, TTS playback, timed cue engine, render overrides,
surface pins, comparison/pulse effects and simulation-time restoration are
specific to the upstream educational-tour product and are intentionally not
copied into Personal Universe.

The Places surface derives:

- Featured Journey
- Projects Journey
- Research Journey

from the same destination sections. Each step calls the same destination
executor used by Search/Places/canvas/deep links.

Behavior:

- manual Search/Places/Canvas navigation, Locate, Return or Stop interrupts the
  journey immediately;
- the Journey adds no extra navigation lock: Search/Places, Canvas and Return
  remain available while it is active;
- ordinary mode advances only after the current destination has physically
  settled. Product System/Approach/Orbit/Atmosphere/Surface use the existing
  camera-controls current-position/current-target acceptance; native YEIS
  spatial travel uses its existing arrived/located callback;
- the 6.5 s destination dwell begins only after that settled signal. A
  single-stop Journey therefore enters its visible completion state
  automatically after one settled dwell instead of requiring a special DONE
  click in ordinary motion;
- `prefers-reduced-motion` disables automatic advance and keeps Prev/Next
  manual controls;
- a Journey never invents content: empty Content Collection routes are hidden,
  and route cards with the exact same ordered destination sequence are
  de-duplicated. A route appears automatically once real content makes it
  non-empty and distinct.

This closes a former semantic mismatch where the React phase could switch to
`approach` or `system` before the camera had actually arrived, allowing the
dwell timer to start during flight. The implementation retains only a local
`cameraSettledPhase` latch; it does not port TourPlayer's narration/cue state
machine or create another destination executor.

## Reuse Gate

The navigation mainline retains the frozen `YEIS-FULL-PLACES-TRAVEL-001`
approval for its original protected closure. Later productization units use
independent immutable task approvals, including
`PLANET-ARRIVAL-PROGRESSIVE-BAKE-001`,
`NAVIGATOR-INTERACTION-LIFECYCLE-001`,
`PLANET-VISUAL-ARRIVAL-COMPOSITION-001`,
`NAVIGATION-FAILURE-RECOVERY-001`,
`JOURNEY-SETTLED-ORCHESTRATION-001`,
`NATIVE-BODY-ACCEPTANCE-001`,
`NAVIGATION-ENTRY-COVERAGE-001`, and
`WORLD-CAMERA-MANUAL-OVERRIDE-001`.

Do not edit an approved record after implementation merely to make it describe
new code: the gate intentionally hashes the research record at approval time.
Each new protected implementation unit must create and commit its own task and
approval metadata before its first implementation commit.

## Runtime acceptance checklist

A release candidate is accepted only after all of the following are exercised
against a production build:

- Search groups, title/summary/tag matching and keyboard behavior;
- Personal Signal Open reaches the exact attached planet;
- Places product Open, observed exoplanet Open, and native body fallback,
  including `月球` → `body:c0/moon` → native `c0/moon` travel;
- observed-host/exoplanet Locate, including a HIP-less physical point;
- star/system, body, black-hole, landmark and galaxy navigation,
  including Chinese `仙女座` → exact galaxy native travel;
- real WebGL Canvas picks route through the same destinations after native
  Locate, without a test-only picking API;
- destination deep links, including Search → `hero:aurora-01` → exact Hero
  world → cold reload of the same world identity;
- galaxy → system → planet → approach → orbit → return → galaxy;
- landmark sprite/photo counts and all 15 photograph requests;
- mobile navigator/Journey layout;
- Journey interruption, settled-before-dwell auto advance, visible completion,
  and reduced-motion manual mode;
- stable System/Orbit/Surface manual camera takeover preserves destination and
  deep-link identity while interrupting an active Journey;
- native galaxy camera persistence after returning from a product scene.

### Cloud acceptance evidence — 2026-11-23

PR #24 / GitHub Actions run `45051078091` exercised the production artifact
without a Windows workstation:

- Machine Reuse Gate: PASS;
- Astro production build: PASS;
- headless Chromium runtime smoke: PASS;
- default boot reached `data-universe-engine="yeis"`,
  `data-yeis-native-galaxy="ready"` and one generated Personal Signal;
- `?navigator=1&navq=Earth` opened the product Navigator and produced a
  non-empty Earth result set after the smoke deep-link compatibility regression
  was fixed;
- the uploaded dist artifact digest was
  `sha256:973d5a6f392dc9a6fee7996ec6148bfd28fb27c52fb88745ded37ff7f44f9855`.

The exact uploaded dist was then extracted into an independent container and
served over HTTP. Every one of the 15 pinned deep-sky atlas sources under
`/nebulae/*.jpg` returned HTTP 200, decoded as `image/jpeg`, and had a
non-zero payload; the built YEIS scene bundle also contains the
requested/loaded/failed/complete atlas diagnostics. Browser-side atlas
completion remains observable through those diagnostics rather than being
coupled to core galaxy readiness, because the photographs are intentionally a
progressive enhancement.

## Exact native body and black-hole travel

Implemented under task `EXACT-NATIVE-TRAVEL-V3-001`.

Search and Places already expose native YEIS bodies and black holes. The product
adapter now preserves those exact identities instead of degrading them to a
host-star-only destination.

The execution rule is intentionally asymmetric:

- if a native body has a matching React `PlanetDefinition`, Personal Universe
  opens the existing product system/planet scene;
- if the body exists only in the pinned YEIS runtime (for example a native
  object not represented by the current React planet model), the app keeps the
  galaxy/native renderer mounted and sends the exact `nativeId + bodyId`
  target to YEIS;
- black-hole destinations keep the pinned YEIS black-hole id and resolve its
  owning system/body inside the native runtime.

The native path reuses the pinned MIT universe and camera primitives:

1. switch the YEIS reference frame to the owning star system when necessary;
2. shift the existing native camera/controller frame by the returned delta;
3. resolve the requested native body from that same runtime;
4. call the existing YEIS camera autopilot for the exact body.

Locate remains a galaxy-scale operation, so body locate points at its owning
star and black-hole locate points at the black hole's owning system. Travel is
exact.

No second camera controller, coordinate system or cross-scale flight algorithm
is introduced. `camera-controls` was evaluated as a mature generic Three.js
alternative but rejected for this gap because it does not own YEIS astronomical
reference frames or native body identity.

If a stale/invalid body id is ever requested, the runtime records a diagnostic
fallback/error instead of silently substituting a different celestial body.

Browser acceptance now keeps this asymmetric contract explicit with the Moon:
the Chinese alias `月球` resolves through the real Navigator to
`body:c0/moon`; because moons are intentionally not mapped into
`PlanetDefinition`, the shared executor must retain native target `c0/moon`
through YEIS autopilot completion instead of opening a React product planet.

A companion entry-point acceptance unit also exercises the real WebGL surface:
Orion Nebula is first centered through the existing Locate action, then an
actual pointer click at the canvas center must be resolved by the native
landmark picker as `landmark:l-m42` and continue through the same shared
destination executor. Hero and galaxy coverage likewise use the real Navigator
and deep-link/native-travel paths rather than calling internal resolvers.
