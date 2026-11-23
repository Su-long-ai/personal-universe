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
operable on narrow/mobile layouts.

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
representations. For Approach and Orbit, the existing cinematic shot direction
and transition timing are retained, while the final camera distance comes from
`CameraControls.getDistanceToFitSphere(PLANET_RENDER_RADIUS)` multiplied by a
small phase-specific breathing-room factor.

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
- camera controls remain available;
- ordinary mode advances only after navigation has settled and the
  current product phase remains stable for the journey dwell;
- `prefers-reduced-motion` disables automatic advance and keeps Prev/Next
  manual controls;
- a Journey never invents content: if the relevant Content Collection group is
  empty, the corresponding journey is disabled.

## Reuse Gate

The navigation mainline retains the frozen `YEIS-FULL-PLACES-TRAVEL-001`
approval for its original protected closure. Later productization units use
independent immutable task approvals, including
`PLANET-ARRIVAL-PROGRESSIVE-BAKE-001`,
`NAVIGATOR-INTERACTION-LIFECYCLE-001`, and
`PLANET-VISUAL-ARRIVAL-COMPOSITION-001`.

Do not edit an approved record after implementation merely to make it describe
new code: the gate intentionally hashes the research record at approval time.
Each new protected implementation unit must create and commit its own task and
approval metadata before its first implementation commit.

## Runtime acceptance checklist

A release candidate is accepted only after all of the following are exercised
against a production build:

- Search groups, title/summary/tag matching and keyboard behavior;
- Personal Signal Open reaches the exact attached planet;
- Places product Open, observed exoplanet Open, and native body fallback;
- observed-host/exoplanet Locate, including a HIP-less physical point;
- star/system, body, black-hole, landmark and galaxy navigation;
- Canvas picks route through the same destinations;
- destination deep links;
- galaxy → system → planet → approach → orbit → return → galaxy;
- landmark sprite/photo counts and all 15 photograph requests;
- mobile navigator/Journey layout;
- Journey interruption and reduced-motion manual mode;
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
