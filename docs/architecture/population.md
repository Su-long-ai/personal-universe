# Population architecture

Personal Universe keeps one population layer between native astronomy/rendering
and discovery. It extends the existing deterministic generators and observed
catalog adapters; it is not a second universe, router, renderer, or search
database.

## Version contract

Population metadata uses schema version `1` and generator version
`pu-population-v1`. Canonical marker/system/world/moon IDs and their existing
seed strings remain authoritative. Population metadata attaches to those
entities rather than introducing another identity namespace.

Changing statistical rules is allowed only with an explicit generator-version
change and compatibility decision. Unrelated content insertion must not alter
existing generated IDs, seeds, names, or fingerprints.

## Provenance

Every materialized population entity records provenance:

- `observed`: supplied by the authoritative catalog;
- `inferred`: derived because an observed value was unavailable;
- `hybrid`: a real observed object with explicit inferred fallback fields;
- `generated`: deterministic filler from the seeded generator;
- `authored`: product-owned personal/hero identity.

NASA Exoplanet Archive values remain authoritative. Derived equilibrium,
mass/radius fallbacks, archetypes, periods, and other unavailable properties are
listed under `inferredFields` instead of being presented as observations.

## Capability contract

Population describes what a world is capable of; Agent 06 remains responsible
for the actual Surface renderer/profile.

Gas and ice giants are always `orbit-only`. Non-giant generated/observed
worlds may be `surface-capable`. Explicit authored hero worlds may be
`authored-surface`. This metadata does not automatically enable a renderer or
change the existing `surfaceMode`; it is the stable contract Surface can
consume.

## Determinism and rarity

The existing Helios-derived `SeededRng` and `hashSeed` remain the generation
authority. Rarity is derived independently from stable entity seed plus the
generator version, so adding an unrelated entity cannot reshuffle existing
rarity. Rare and uncommon thresholds are bounded and deterministic.

Generated names remain the existing seed-driven names. Observed names are never
replaced by generated names.

## Lazy materialization

Galaxy markers are lightweight. A full generated or observed system is created
only when `resolveSystem()` focuses it. Materialized systems use a fixed-size
LRU-style cache (64 entries). The cache key includes generator version and
canonical marker identity, so repeated focus reuses one system object while
large browsing sessions remain bounded.

The NASA host snapshot also has one module-level hostname index. Search/focus
must not scan the complete observed catalog on each materialization.

## Invariants

Every canonical materialization is checked before entering the cache:

- entity IDs are unique within a system;
- metadata schema/generator versions match;
- metadata stable seed equals the canonical entity seed;
- star/world/moon parent IDs are correct;
- giant worlds remain orbit-only and never expose Surface;
- procedural systems have generated provenance;
- observed catalog systems preserve observed/hybrid provenance;
- hero systems preserve authored provenance.

These checks fail loudly during development rather than silently corrupting
deep links or destination identity.

## Coordination

Agent 08 owns these population structures and metadata. Discovery consumes
provenance/tags/capabilities without rebuilding generated systems. Surface
consumes the world capability/archetype contract without moving population
identity into renderer code. Native YEIS identity remains the fixed astronomy
boundary, and authored personal content reservations always outrank generated
filler.
