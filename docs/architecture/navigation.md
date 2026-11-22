# Universe Navigation

**Status:** pinned-MIT YEIS Search/Places semantics restored on 2026-11-22.

## Decision

The Personal Universe navigator does not maintain a second astronomical search
index.

The pinned MIT YEIS commit already contains:

- search UX across stars, bodies, black holes, landmarks and galaxies;
- a grouped Places model with stable destination refs;
- `StarCatalog.search()` and `Universe` domain search helpers;
- native camera autopilot primitives for later spatial fly-to.

The current React shell therefore stays thin. It presents results and keyboard
interaction while the YEIS runtime resolves astronomical destinations.

## Current destination classes

The first restored slice supports:

- Personal Signals from Astro Content Collections / content placement;
- catalogue stars through `StarCatalog.search()`;
- black-hole systems through `Universe.searchBlackHoles()`;
- star-like landmarks through `Universe.searchLandmarks()`;
- a small featured-places subset using the stable star refs from the pinned MIT
  `src/ui/places.ts`.

Non-system deep-sky landmarks and galaxy-centre navigation remain candidates
for the native-camera fly-to layer because the current product phase model
enters star systems rather than arbitrary points in space.

## Interaction

- HUD button: `SEARCH / PLACES`;
- keyboard: `Ctrl+K` / `Cmd+K`, or `/` when not typing;
- arrow keys select results;
- Enter opens the selected destination;
- Shift+Enter locates the selected destination in the native galaxy view;
- Escape closes the navigator.

When no query is present, Personal Signals are listed first followed by featured
YEIS places. Search keeps personal results and astronomical results in the same
destination model.

## Runtime validation

Production-preview/CDP validation on 2026-11-22:

- `Ctrl+K` opened the navigator and exposed seven browse destinations with the
  current one-entry portfolio;
- searching `Personal Universe` returned exactly the Personal Signal result and
  Enter navigated to native YEIS star `c59669` / Spica;
- the resulting Spica system preserved its attached project signal;
- searching `Sirius` returned the YEIS catalogue result `A0 · 8.6 LY`;
- Enter navigated to native YEIS star `c29786` / Sirius System.

This demonstrates that project discovery and astronomical discovery share the
same navigator while astronomy still comes from YEIS rather than a duplicated
search index.

## Next layer

The existing `CameraController.centerOnDirection()` and `goToPoint()` methods
can provide a spatial **Locate** action before entering a system. That should be
added as a separate navigation enhancement rather than replacing direct Open.


Browser regression after the correction:

- typing the literal letter `l` in the focused search input produced `Pol` and did
  not create a locate request;
- `Shift+Enter` on Sirius still completed native Locate at `c29786` with the
  measured `0.269212 rad` quaternion change;
- reopening the navigator and pressing plain Enter still opened Sirius System.

Generic search packages remain fallback tools:

- cmdk/Fuse.js: useful if result UX or fuzzy matching later needs more;
- Pagefind: useful for future long-form document/article search, not for spatial
  universe destinations.

## Native Locate

`LOCATE` is now a second action beside `OPEN`.

- `OPEN` keeps the existing behavior and enters the resolved star system.
- `LOCATE` stays in `GALACTIC OVERVIEW` and sends a focus request to the
  hosted YEIS `CameraController`.
- the native controller uses `centerOnDirection()` and its built-in autopilot;
  the R3F PerspectiveCamera is not animated independently.
- locate requests are retained until the native scene is ready and are consumed
  from the render loop, so returning from a system and locating immediately is
  safe.

Production-preview/CDP validation:

- searching `Sirius` exposed both OPEN and LOCATE;
- LOCATE resolved to `c29786` and kept the current layer at GALACTIC OVERVIEW;
- the native autopilot completed on `c29786`;
- measured quaternion rotation from start to completion was `0.269212 rad`
  (about 15.4 degrees), proving that the camera actually reoriented;
- the on-screen caption reported `LOCATED // Sirius`;
- reopening the navigator and pressing Enter on `Personal Universe` still
  entered Spica / `c59669`, proving the direct-open path remained intact.

Full physical `goToPoint()` flight remains deliberately deferred until
cross-frame arrival/switch semantics are integrated and validated.

### Locate keyboard correction

The initial Locate slice briefly used the plain `L` key while focus remained in
the editable search input. That conflicts with ordinary queries containing the
letter `l`. The binding is corrected to `Shift+Enter` for Locate while plain
`Enter` remains Open. Printable search characters are never intercepted by
result actions, and the explicit LOCATE button remains available for pointer
users.

## Navigation lazy-load boundary

Search/Locate must not make the navigator a second eager path into the heavy YEIS
runtime. The navigator shell and destination types remain in the static React graph,
while `loadYeisCore()` and YEIS query normalization are imported only when an
async navigation operation executes.

Production validation on 2026-11-22:

- the previous Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning is gone;
- the production build keeps separate `Universe` / `yeis` / `YeisGalaxyScene`
  chunks rather than folding the core through `navigation.ts`;
- a fresh Chrome profile still searched Sirius, located `c29786`, completed the
  same `0.269212 rad` native-camera turn, and opened Sirius System;
- printable `l` input still remained ordinary search text.

This is a module-graph change only; destination ranking and spatial semantics still
come from the pinned MIT YEIS implementation.

## Full pinned-MIT Places / Travel completion

Completed on 2026-11-23.

The navigator now restores the supported curated destination set from the
pinned MIT YEIS `src/ui/places.ts` instead of keeping the earlier small sample:

- 10 curated stars;
- 10 black-hole systems;
- 20 pulsar / nebula / cluster / record-star landmarks;
- 11 galaxies;
- Personal Signals from Astro content placement.

The catalogue refs and spatial semantics remain YEIS-owned. Personal Universe
only supplies English-facing presentation for the curated galaxy names.
Solar-System spacecraft / moon entries are intentionally not advertised in the
browse list because the current R3F product renderer does not yet render those
body classes as first-class travel targets.

Search also restores YEIS body discovery for directly renderable worlds:
current-system and foreign-system planets/dwarfs are returned as `body`
destinations. Opening one resolves its native YEIS star/system and enters the
matching existing planet rather than creating a parallel body model. Locate for
a body remains a galactic locate of its host star, so YEIS is still the only
physical-coordinate authority.

### GitHub-only browser validation

The repository CI now runs a real headless Chrome pass after the production
build. The navigation integration was validated in GitHub Actions without a
local browser:

- default route hydrated with `data-universe-engine="yeis"`;
- native galaxy reached `data-yeis-native-galaxy="ready"`;
- personal signal hydration remained present;
- `?navigator=1&navq=Earth` opened the Universe Navigator;
- the hydrated navigator reported a non-zero result count;
- the rendered DOM contained the `Earth` destination.

This browser smoke is now part of the branch CI, in addition to Reuse Gate and
the Astro production build.

## Navigator discovery grouping

Implemented under task `NAVIGATOR-DISCOVERY-002`.

The navigator still consumes one flat array of destinations resolved by the
pinned MIT YEIS search/Places model, so keyboard selection and Open/Locate
semantics remain unchanged. Presentation now adds stable groups:

1. Personal Signals
2. Worlds
3. Stars + Systems
4. Black Holes
5. Landmarks
6. Galaxies

Browse uses the same grouping over the curated Places set. Search keeps the
group order stable and ranks matches *within each group* by exact title,
title prefix, token prefix, title substring and detail substring. This keeps
Personal Signals visibly first-class without introducing a second fuzzy-search
index or dependency.

Generic search packages remain escalation options rather than parallel
authorities: cmdk/Fuse can later enhance palette ergonomics, while Pagefind
remains reserved for document/article search.

## Shareable star and world links

Implemented under task `SHAREABLE-NAV-LINKS-002`.

The existing debug URL contract is promoted into a stable single-page deep-link
contract rather than introducing a router:

- `phase=<phase>`
- `star=<native YEIS star id>`
- optional `body=<native YEIS body id>`

On initial load, `body` is resolved inside the requested native YEIS system
before the content/Hero/first-world fallback, so an exact shared world wins.
Opening a star or world through normal navigation updates the same query
parameters with the browser History API. Returning to the galactic overview
removes only `phase`, `star` and `body`.

Unrelated query state such as `engine`, `diagnostic`, `freeze`,
`navigator` and `navq` is preserved because URL mutation starts from the
current `window.location`.

The serialized identity remains YEIS-owned; Personal Universe does not create a
second slug or route identity for astronomical objects.

## Guided journeys

Implemented under task `GUIDED-JOURNEYS-V3-001`.

Journeys are deliberately orchestration over the existing destination model, not
a second navigation state machine.

The pinned MIT YEIS `src/core/TourPlayer.ts` was evaluated directly. Personal
Universe reuses three of its spatial-tour semantics:

- user-initiated navigation interrupts the running journey;
- automatic progression waits until navigation has settled, then applies a
  short destination dwell;
- step changes own and clean up only their temporary orchestration state.

The upstream narration manifests, TTS playback, timed cue engine, render
overrides, comparison/pulse effects, surface pins and simulation-time ownership
are specific to YEIS's educational-tour product and are intentionally not
ported.

The Navigator derives three journeys from the same real Personal Signal
destinations already generated from Astro Content Collections:

- Featured Journey;
- Projects Journey;
- Research Journey.

No second handwritten content list is maintained. Empty groups remain disabled
instead of inventing portfolio entries.

The journey coordinator stays inside the existing React runtime and calls the
same `handleNavigateDestination` path used by Search and Places. A journey
therefore cannot create an alternate star/body identity or camera authority.

Behavior:

- manual Search navigation cancels the current journey;
- Locate cancels the current journey;
- Canvas system/planet selection cancels the current journey;
- Return and Stop cancel it explicitly;
- Prev/Next reuse the same destination executor;
- normal mode auto-advances only after navigation is no longer traveling or
  locating and the product is at a stable system/approach/orbit/surface phase;
- `prefers-reduced-motion` disables automatic progression while keeping
  Prev/Next/Done available;
- camera controls remain outside the journey coordinator.

React Joyride and XState were both evaluated before implementation. Joyride is a
mature DOM-target onboarding product, but it would not replace spatial
destination resolution or camera travel. XState is a mature general state
machine framework, but the current journey state is intentionally tiny and
subordinate to the existing navigation state. Neither is introduced as a new
runtime dependency at this stage. If journeys later gain branching,
persistence, resumability or parallel invoked work, XState should be
re-evaluated before expanding the local coordinator.

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

