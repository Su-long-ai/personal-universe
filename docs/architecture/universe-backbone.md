# Universe Backbone Decision

**Status:** Accepted  
**Decision ID:** `UNIVERSE-BACKBONE-DECISION-001`  
**Date:** 2026-11-22

## Decision

Use **Your Eyes In Space commit `e52056897364e060fbd6d00951628f163b57d7a1`** as the reusable universe core, while preserving Personal Universe's Astro/React shell, content system, reuse gate and Hero-world boundary.

Do **not** fork the complete YEIS product UI. Do **not** use current YEIS main code: upstream switched to AGPL after the verified MIT boundary. Keep `procedural-planets` as an optional Hero/fallback renderer rather than the global universe backbone.

## Why

The verified MIT snapshot already contains the expensive infrastructure the local V2 would otherwise have to rebuild:

- hierarchical galaxy → star → system coordinates;
- real HYG-derived nearby stars plus deterministic procedural fill;
- deterministic procedural planetary systems;
- Solar System data and orbital mechanics;
- floating-origin / camera-relative travel and logarithmic-depth rendering;
- procedural planets, atmospheres and clouds;
- streamed real Earth / Moon / Mars imagery;
- Milky Way, galaxies, landmarks, nebulae and far-universe layers;
- black holes and other exotic objects;
- hand-made `ExtraSystem` exceptions.

The last item is decisive for this project. A local research-copy patch added a narrow `registerExtraSystem()` method and injected **HELION + AURORA-01**. The unmodified system/camera/body render pipeline accepted it, calculated orbital/physical information, and rendered the Hero planet at close range. No second galaxy/system/planet engine was needed.

## Verified source boundary

Permissive source is pinned to:

`e52056897364e060fbd6d00951628f163b57d7a1`

At that commit:

- `LICENSE` is MIT;
- `package.json` declares MIT;
- `npm ci && npm run build` passes;
- the production build boots in a headless browser.

The repository's current license text refers to a `mit-final` tag, but that tag is not currently exposed by the remote. It is therefore **not** an acceptable reproducibility anchor. The exact commit SHA above is the source boundary.

Later upstream revisions are AGPL-3.0-or-later and must not be copied into the MIT-derived core without a separate license decision.

## Third-party data/assets

The upstream `NOTICE.md` remains authoritative for copied material.

Important boundaries:

- HYG-derived star catalogue: CC BY-SA 4.0;
- NASA/JPL data and NASA 3D resources: retain upstream notices/usage guidance;
- remove upstream name/logo/branding from the Personal Universe product.

The source snapshot looks large only because optional editorial media dominates it:

- lessons: ~286 MB;
- tours: ~103 MB;
- models: ~22 MB;
- astronomy data: ~2.7 MB.

Lessons, tours and their media are outside our product scope and should not be vendored.

## Candidate results

| Candidate | Gate score | Result |
|---|---:|---|
| YEIS MIT core + Personal Universe shell | **45.5** | **Selected** |
| Full YEIS product fork/reskin | 43.0 | Reject |
| Cosmos engine + Personal Universe shell | 41.5 | Reject as mother; keep as donor |
| Solar Wanderer scale/travel backbone | 37.5 | Reject as mother; keep as donor |
| SpaceKit orbital subsystem | 37.0 | Hold for gaps |
| Continue current V2 composite as mother | 35.5 | Reject |
| ProceduralPlanets | 43.0 | Retain as optional subsystem |

Cosmos remains particularly valuable as a future donor for camera-relative utilities, scale-regime state machines, tile streaming and test patterns. Its current main is not selected as mother because the repo-wide TypeScript build currently fails in `SearchPanel`, full star-tile behavior expects backend manifests, and Hero-system registration would need a new abstraction.

## Migration strategy

Migration is incremental and reversible.

1. Vendor only the required files from the exact MIT commit and preserve LICENSE/NOTICE provenance.
2. Add a narrow Personal Universe adapter rather than exposing upstream product UI.
3. Run YEIS and current V2 in parallel behind a temporary engine switch.
4. Prove Galaxy → System → ordinary planet → Hero planet → return navigation.
5. Only after visual/performance regression checks switch YEIS core to default.
6. Remove duplicated V2 universe-generation/rendering infrastructure only after the new path is stable.
7. Keep Hero-world renderers pluggable; a Hero world may still use ProceduralPlanets, authored Blender scenes, data surfaces or other specialized renderers.

## Non-goals

This decision does not freeze final art direction, Hero surface technology, or UI styling. It selects the astronomical/cross-scale **backbone**, not the product's visual identity.


## Observation precedence

The verified MIT YEIS snapshot does not contain the general confirmed-planet
catalogue used by current NASA Exoplanet Archive data. For ordinary catalogue
stars it synthesizes deterministic planetary systems from stellar parameters.

Personal Universe therefore uses an **observation-first** model order:

1. NASA Exoplanet Archive snapshot for confirmed nearby host systems;
2. YEIS hand-made/real HYG systems and deterministic system generation for
   stars without an observed-system override;
3. YEIS procedural stars/systems outside the real HYG neighbourhood;
4. Personal Universe Hero `ExtraSystem` overrides where explicitly registered.

This prevents a broader reused engine from reducing astronomical correctness.
During migration the YEIS model path is available behind `?engine=yeis`; V2
remains the rollback path until camera/render parity is established.
