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

The approved Reuse Gate record for this implementation is
`YEIS-FULL-PLACES-TRAVEL-001`. Its frozen approval already lists every protected
file touched by this navigation mainline.

Do not edit the approved record after implementation merely to make it describe
new code: the gate intentionally hashes the research record at approval time.
A future task that changes the reuse boundary must create/approve a new gate
task before protected implementation changes.

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

