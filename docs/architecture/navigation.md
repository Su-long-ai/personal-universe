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
