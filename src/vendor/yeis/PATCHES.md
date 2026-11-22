# Vendored YEIS core

Upstream: https://github.com/berkcomba/youreyesinspace  
Pinned source commit: `e52056897364e060fbd6d00951628f163b57d7a1`  
Vendored subset: 24 TypeScript files forming the dependency closure of
`Universe`, `StarSystem`, `CelestialBody`, and `StarCatalog`.

This directory intentionally does **not** track the upstream default branch.
Later upstream revisions are AGPL-3.0-or-later and are outside the approved
source boundary.

## Host patches

The vendored code is kept structurally close to upstream. There are three
intentional Personal Universe adaptations:

1. `core/Universe.ts`
   - Adds `registerExtraSystem(system)`.
   - This exposes the upstream private `ExtraSystem` mechanism so Hero systems
     can be registered without changing normal real/procedural generation.

2. `data/StarCatalog.ts`
   - Replaces the upstream Vite-injected `__BUILD_ID__` cache key with the
     pinned source identifier `e520568`.
   - Data format and parsing are unchanged.

3. `i18n/index.ts`
   - Restores the exact pinned-MIT YEIS runtime translator after visual smoke
     exposed Turkish source labels leaking through the earlier identity shim.
   - Vendors only `locales/en/data.json` and `locales/en/ui.json`; the host
     calls `initI18n("en")` before constructing `Universe`.
   - Translation lookup and source keys remain upstream behavior; Personal
     Universe does not maintain a parallel body-name alias table.

No model, orbital, catalogue, procedural-generation, galaxy, black-hole, or
stellar algorithms were rewritten in this migration.

## Data

`/public/vendor/yeis/data/stars.bin` and `star-names.json` are copied from
the same pinned snapshot. The binary contains 109,401 HYG-derived stars.

See `UPSTREAM_NOTICE.md` for third-party attribution and licensing, including
the CC BY-SA 4.0 HYG-derived catalogue terms.


4. `input/Input.ts`
   - Adds an explicit `dispose()` lifecycle method and stable handler references.
   - Upstream owns the whole application lifetime; Personal Universe mounts/unmounts
     the native camera inside React, so window/document listeners must be removed.

5. `render/StarPoints.ts`, `render/ProcStarPoints.ts`,
   `render/GalaxySprites.ts`
   - Add explicit `dispose(scene)` methods that remove their Three objects and free
     geometry/material GPU resources.
   - `GalaxyCloud` already had upstream disposal support.

The camera, picking, magnitude, galaxy sampling and shader algorithms remain
upstream logic. These lifecycle patches only adapt ownership to React Three
Fiber.

6. `render/LandmarkSprites.ts`
   - Adds `dispose(scene)` so the R3F host can remove the instanced landmark
     mesh and release its geometry, shader material, and photo atlas texture.
   - Rendering, coordinate, LOD, atlas, and picking logic remain the exact
     pinned MIT implementation.

## Deep-sky landmark imagery

`data/landmarkImages.ts` and the 15 files under `/public/nebulae/` are copied
from the same pinned snapshot. Upstream metadata records the photographs as
NASA/ESA/STScI public-domain material or ESO / ESA-Hubble CC BY 4.0 assets.
The exact per-image credit lines are retained in `landmarkImages.ts` and in
`public/THIRD_PARTY_ASSETS.md`.

## Native system renderer closure

Vendored verbatim from the fixed MIT boundary
`e52056897364e060fbd6d00951628f163b57d7a1`:

- `src/render/BodyRenderer.ts` → `render/BodyRenderer.ts`
- `src/render/BodyPoints.ts` → `render/BodyPoints.ts`
- `src/render/OrbitLines.ts` → `render/OrbitLines.ts`
- `src/render/RingParticles.ts` → `render/RingParticles.ts`
- `src/render/TileGlobe.ts` → `render/TileGlobe.ts`
- `src/render/ProceduralShips.ts` → `render/ProceduralShips.ts`
- `src/data/imagery.ts` → `data/imagery.ts`

These files are the pinned-MIT renderer closure selected by
`YEIS-NATIVE-SYSTEM-RENDERER-V3-001`. No code from the current AGPL
upstream main is included. Project-specific host adaptation must remain
outside this closure where possible; any necessary vendor patch must be
listed below before release.

