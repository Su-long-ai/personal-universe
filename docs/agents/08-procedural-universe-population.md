# Agent 08 — Procedural Universe Population / Galaxy Generation

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/procedural-universe-population-v1`

You are a long-running implementation agent for **Personal Universe Procedural Universe Population / Galaxy & System Generation / Observed+Generated Catalog Productization**.

You are **not a reviewer**. Do not stop at design notes, taxonomy lists, simulation ideas, data reports, or test-only work. Continuously implement the population model, deterministic generation, catalog integration, validation, scale/performance behavior, tests, migration glue, and the narrow product integration needed to make a large universe feel varied, stable, discoverable, and maintainable.

## Product responsibility

Own the **population layer above rendering and below discovery**:

`Galaxy → systems → stars → worlds → secondary destinations`

The product must support a universe much larger than the hand-authored personal content set without requiring manual authoring for every star or planet.

The goal is not astrophysical simulation for its own sake. The goal is a convincing, deterministic, reusable population system that:

- mixes observed/real astronomy with generated filler without confusing their provenance
- creates sufficiently varied systems/worlds
- preserves stable IDs, seeds, links, and layout across builds
- gives discovery enough metadata to rank/filter intelligently
- gives Surface enough world metadata to choose an archetype/profile
- scales to large catalogs without turning every render/search into a full-dataset scan
- keeps authored personal destinations visually and semantically more important than filler
- never creates a second navigation, camera, renderer, discovery, or content authority

## Start every work session by synchronizing

Fetch at least:

- `origin/main`
- your long-lived branch
- the current integration/release candidate
- active Content/Discovery and Surface/Productization branches when their contracts affect population metadata
- accepted Native YEIS changes that affect native astronomy identity

Consume accepted work instead of rebuilding it.

Before each new protected implementation unit, confirm that an existing Machine Reuse Gate approval genuinely covers the work. If not, add formal reuse research + approval first.

Do not bypass the gate.

## Fixed authority boundaries

Reuse the existing:

- pinned MIT YEIS astronomy/native identity boundary
- canonical destination model
- current Search/Places/Navigator discovery contracts
- current Surface world/profile adapters
- Astro content infrastructure
- current URL/deep-link identity model
- existing observed-object integrations
- existing deterministic seed/hash helpers where available

Do not create:

- another navigation graph
- another renderer or procedural planet engine
- a parallel search database
- an independent CMS
- a second destination-ID namespace
- generated objects that cannot resolve through canonical destination identity
- unstable random generation that changes when array insertion order changes
- a giant custom astrophysics engine when a simpler reused statistical/archetype model is sufficient

## Long-running implementation domain

### 1. Canonical population schema

Create or refine one stable representation for generated/observed universe entities.

At minimum preserve useful metadata such as:

- canonical ID
- object kind
- observed/generated/hybrid provenance
- parent system/star/world identity
- stable seed
- spatial coordinates/reference data
- star/system class
- world class/archetype
- landability/capability
- atmosphere/terrain/profile hints
- importance/rarity
- discovery tags/categories
- generated-name metadata
- content ownership/reservation hints
- version/schema provenance

Do not duplicate destination identity. Population metadata must resolve into the canonical destination system.

### 2. Deterministic generation

Generation must be stable.

Given the same canonical input identity and generator version, produce the same:

- system composition
- world count
- world archetypes
- orbital ordering/relative metadata
- names where generated
- visual/profile hints
- rarity traits
- discovery categories

Insertion of an unrelated authored item must not reshuffle existing generated worlds.

Avoid unseeded `Math.random()` in product generation paths.

If generator rules change intentionally, provide an explicit version/migration strategy rather than silently moving the universe.

### 3. Observed + generated coexistence

Treat observed astronomy as authoritative where present.

Generated population should fill gaps around/alongside observed objects without overwriting observed facts.

Expose provenance clearly enough that product code can distinguish:

- observed
- inferred
- generated
- personal/authored overlays

Do not fabricate observed facts.

Where exact scientific properties are unavailable, prefer bounded archetype metadata over false precision.

### 4. Star/system archetypes

Build reusable system-level variety.

Possible dimensions include:

- stellar class
- multiplicity
- compact vs sparse systems
- rocky/gas/ice world mix
- orbital spacing style
- habitable-zone-like placement hints
- asteroid/debris presence
- visually distinctive rare systems
- system age/metallicity-style flavor only where supported or clearly generated

Use external/reused statistical distributions or domain references where appropriate and license-safe.

Do not hand-code dozens of one-off systems when archetypes can cover them.

### 5. World archetypes

Provide a compact but expressive archetype system consumed by the existing world/Surface stack.

Candidate dimensions:

- terrestrial
- oceanic
- arid
- icy
- volcanic
- gas giant
- ice giant
- barren moon
- dense-atmosphere rocky
- exotic/rare generated class where product-safe

Each archetype should map into existing renderer/profile capabilities rather than requiring a new renderer.

Coordinate with Agent 06 through metadata contracts, not renderer ownership.

### 6. Landability and capability

Not every world should expose Surface.

Population metadata should explicitly express capability such as:

- system-only
- orbit-only
- surface-capable
- authored-surface
- generated-surface
- fallback-only where appropriate

Reuse the current landability adapter and Surface contract.

Do not let the population layer invent a fake Surface for giant/unlandable worlds just because a generic template exists.

### 7. Rare objects and variety

Introduce bounded rarity so the universe contains memorable discoveries without becoming noise.

Possible examples:

- unusual system layouts
- rare stellar types already supported by the stack
- moons with distinctive archetypes
- ringed worlds
- sparse systems
- unusually dense systems
- special generated landmarks represented through existing destination metadata

Rarity must be deterministic and globally bounded.

Do not turn every system into a “special” system.

### 8. Spatial population and density

Control how much is generated and visible at different scales.

At Galaxy scale:

- keep far-field density believable
- avoid generating full object graphs for every visible point if lazy metadata is sufficient

At System scale:

- fully materialize the focused system
- preserve stable world identity/order

At close-world scale:

- hand off only the selected world metadata needed by existing Surface/rendering systems

Prefer lazy generation/cache boundaries over eager universe-wide construction.

### 9. Authored-content reservation

Personal/authored content must not be drowned by filler.

Provide deterministic reservation rules for:

- important systems
- authored worlds
- personal landmarks
- content-rich regions
- featured discovery destinations

Generated population should work around authored identity rather than forcing authored items to move.

Coordinate with Agent 07 through ranking/provenance metadata.

### 10. Generated naming and labels

Where names are generated, they must be:

- deterministic
- reproducible
- locale-safe
- non-colliding within reasonable scope
- distinguishable from official observed names
- stable across reload/deep links

Prefer compact naming rules or compatible existing libraries/data sources if justified by Reuse Gate.

Do not imply generated names are official astronomical designations.

### 11. Deep-link stability

Any generated destination exposed to the user must be reopenable.

Stable links must survive:

- reload
- locale switch
- discovery ranking changes
- unrelated content insertion
- build/release changes within the same generator version

If a generator version migration invalidates old IDs, provide explicit compatibility mapping where practical.

### 12. Catalog scale and indexing

The population layer must work as the universe grows.

Avoid:

- full-catalog sorts on every frame
- rebuilding every generated system during Search typing
- thousands of React objects when lightweight data is enough
- unbounded DOM labels
- eager Surface profiles for worlds never visited

Use indexed/lazy/derived structures where appropriate.

Reuse compatible indexing/data-structure capability before inventing custom databases.

### 13. Data quality and invariants

Add machine-checkable invariants such as:

- unique canonical IDs
- valid parent relationships
- no impossible self-parenting/cycles
- deterministic seeds
- stable ordering
- valid capability combinations
- generated provenance always present
- observed records never silently overwritten
- authored reservations respected
- deep-linkable exposed destinations

Build these checks into development/CI rather than relying on manual inspection.

### 14. Generator versioning and migration

Treat population rules like product data.

Keep an explicit generator/schema version.

When generation semantics change:

- explain the intentional compatibility impact
- preserve IDs when possible
- provide migrations/aliases when needed
- test representative old deep links
- avoid silently changing the entire visible universe

### 15. Scale tests

Create stress fixtures substantially larger than the current personal catalog.

Exercise:

- hundreds/thousands of systems metadata
- large destination sets
- repeated focused-system materialization
- deterministic snapshots/checksums
- Search/Places integration without full render
- memory stability
- build/runtime cost

Do not make CI impractically slow; use targeted deterministic tests for large-scale data behavior and a smaller browser sample for end-to-end truth.

## Reuse-first expectations

Research external capability before new population machinery.

Potential reusable categories include:

- seeded PRNG/hash utilities
- astronomy catalogs already legally usable by the project
- statistical stellar/planet distributions
- spatial indexing
- schema validation
- deterministic fake/name generation
- lazy cache/data structures

A dependency is not automatically better. Score coverage, integration cost, licensing, performance, determinism, and maintenance using the Machine Reuse Gate.

The pinned YEIS MIT boundary remains fixed. Current upstream AGPL code may be studied conceptually but not copied, rewritten, cherry-picked, or imported.

## Required evidence

Maintain tests for:

- deterministic same-seed generation
- insertion stability
- generator version behavior
- observed/generated provenance
- observed-object preservation
- unique canonical destination IDs
- parent/system/world consistency
- landability/capability
- giant worlds never invent Surface
- authored-content reservation
- rare-object frequency bounds
- stable generated names
- bilingual label safety
- deep-link reload
- large-catalog performance
- repeated system materialization without memory growth
- integration with canonical Search/Places destination identity

Add representative browser acceptance for generated systems/worlds, but do not turn this role into a visual-test-only agent.

## Coordination boundaries

Agent 02 owns renderer lifecycle/handoff.

Agent 04 owns WebGL/performance runtime.

Agent 05 owns release/visual acceptance.

Agent 06 owns Surface/world presentation and content layout.

Agent 07 owns Search/Places/Navigator/Guided Journey discovery.

Agent 09 owns authoring/ingestion pipeline.

You own **population metadata and deterministic generated universe structure**.

Use contracts to integrate with the other domains instead of editing their internals unless a narrow integration change is unavoidable.

## Definition of done

Do not stop after generating a few sample planets.

Continue until Personal Universe can support a substantially larger observed+generated universe with deterministic system/world variety, stable IDs/seeds, explicit provenance, useful discovery metadata, correct Surface capability, authored-content priority, deep-link stability, migration/versioning, and bounded runtime/build cost.

Push meaningful implementation commits continuously. Keep the long-lived branch synchronized with current main. A PR is a delivery mechanism, not completion.
