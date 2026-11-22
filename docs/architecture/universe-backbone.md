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


## Cross-catalog identity

Observed exoplanet hosts and the native YEIS/HYG star field are joined by
**HIP identifier**, not by fuzzy display names.

The NASA Exoplanet Archive snapshot now stores `hip_name`, `hd_name` and
`gaia_dr3_id` alongside each host. When `hip_name` is present, its numeric
HIP value is matched against the `StarCatalog.hips` field already preserved
inside the vendored HYG-derived binary.

Validation on 2026-11-22:

- nearest observed hosts in local snapshot: 64;
- hosts with HIP identity: 51;
- exact HIP matches in YEIS/HYG: **51 / 51**;
- first 32 hosts exposed by the current bridge: 27 with HIP, **27 / 27** matched.

A matched observed marker keeps `engine: "v2"` because its planetary data
must still resolve from NASA, but also carries the native YEIS star id
(`c<catalogIndex>`). This lets the future native YEIS star renderer route a
click on the physical HYG star directly to the NASA observed-system override.

HIP-less observed hosts remain independent observed markers. HD/Gaia IDs are
retained as metadata for future explicit crossmatch work; fuzzy names are not
an identity authority.

## Hero-system composition

Hero systems remain exceptions only where authorship is valuable. Their surrounding
ordinary astronomy should still come from the selected mother engine.

For **HELION / AURORA**, Personal Universe asks the vendored YEIS
`SystemGenerator` for a normal deterministic HELION system, replaces the generated
planet whose orbit is nearest AURORA's authored 1.08 AU orbit with `AURORA-01`,
and retains the remaining YEIS-generated planets unchanged. Generated moons that
belonged to the replaced planet are discarded so no orphaned hierarchy survives.

This keeps AURORA fully authored while preventing a sparse one-world flagship system
and, importantly, avoids reviving the retired V2 system generator merely as filler.



## Native R3F galaxy renderer

The selected YEIS renderer does not require its upstream product application
or a second canvas. A compatibility PoC and the migration path host the exact
MIT renderer classes inside the existing React Three Fiber Canvas:

- `StarPoints`: 109,401 real HYG-derived stars, magnitude/color shader and pick;
- `ProcStarPoints`: deterministic procedural star tiers and pick;
- `GalaxyCloud`: analytic Milky Way near/inside representation;
- `GalaxySprites`: far-galaxy representation;
- `CameraController`: absolute-km state with the Three camera kept at the
  floating origin.

The Canvas enables `logarithmicDepthBuffer` on the YEIS engine path. The
website initializes `CameraController` in its existing fixed-point orbit mode
around the Milky Way centre, so drag rotates the view and wheel changes
distance; free-flight remains available as an engine capability rather than
the homepage default interaction.

Native catalog/procedural star clicks use the upstream `pick()` methods.
A picked catalog id first resolves through the HIP crosswalk, so a physical
HYG star with a confirmed NASA system enters the observed-system override.
The old V2 galaxy remains the default/fallback until native Hero/HIP-less
observed overlays and return-state persistence reach parity.

### Native renderer validation

Validated on 2026-11-22 against the production build on the local RTX 4060
Laptop GPU:

- Reuse Gate covers 47 renderer/camera/picking files and passes.
- Clean Astro build passes with the native renderer closure.
- Browser runtime reaches `data-yeis-native-galaxy="ready"` and renders the
  native Milky Way cloud plus the 109,401-star catalogue in the existing R3F
  Canvas.
- Projected Hero picking enters `AURORA SYSTEM` with all six worlds intact.
- After zooming from the galaxy overview into the stellar regime, 2,532
  procedural stars met the native pick brightness threshold in the tested
  view; clicking one entered its generated 9-world YEIS system.
- Three isolated production-browser runs measured native-renderer ready time
  at a 1.42 s median versus 0.24 s for V2. The added cost is concentrated in
  initial catalogue/renderer setup; steady frame pacing showed no regression
  in the same headless GPU test.

The two product-semantic cutover blockers are now closed.

### Native parity completion

Validated on 2026-11-22 against a clean production build:

- all five observed hosts in the exposed bridge that lack HIP identity render
  as a lightweight overlay at NASA RA/Dec/distance transformed into the exact
  pinned YEIS/HYG scene frame;
- the runtime reports data-yeis-hipless-observed=5 while the native galaxy
  remains ready, so the overlay does not replace or duplicate HIP-matched stars;
- native camera position/quaternion persist in a UniverseCanvas-owned ref
  across renderer remounts;
- an automated Chrome test changed native orbit distance, switched quality
  (forcing the native renderer effect to clean up and rebuild), and observed
  restored=1 with the post-input camera distance rather than the opening
  overview distance;
- Reuse Gate and a clean Astro production build both pass after the parity
  changes.

V2 is therefore no longer required for native-galaxy semantic parity. The next
migration step is the default-engine cutover plus a rollback switch; removal of
duplicated V2 infrastructure remains a later cleanup after the default path has
soaked.

