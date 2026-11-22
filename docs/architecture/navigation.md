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
