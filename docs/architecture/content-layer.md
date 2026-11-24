# Personal Universe Content Layer

**Status:** accepted and implemented in the first vertical slice on 2026-11-22.

## Decision

Use Astro Content Collections as the canonical personal-content source and
keep the astronomical universe separate from authored biography/project data.

The universe remains mostly astronomical/procedural. Real personal entries are
sparse **signals** attached to stable YEIS stellar addresses and then to one
existing world inside the selected system.

This avoids two failure modes:

1. inventing biography text just to make every generated planet look populated;
2. turning a CMS or content database into the universe engine.

## Authoring model

Content files live under `src/content/portfolio/` and are validated by
`src/content.config.ts` using Astro's built-in Content Collections and Zod
schema.

Current fields:

- `title`, `summary`, `kind`, `status`;
- `importance` and `featured` for future presentation ranking;
- `tags`;
- `placement: auto | hero | pinned`;
- optional `placementKey` to keep an automatic spatial identity stable when a
  source file is renamed or moved;
- `starId` for pinned entries; schema validation requires it only when
  `placement: pinned`;
- optional `href`;
- `draft`.

The first real entry is the Personal Universe project itself. No synthetic
projects or experiences are generated.

## Placement model

`src/lib/universe/content/placement.ts` is a narrow deterministic adapter.

- `hero` entries attach to the handcrafted Hero system.
- `pinned` entries resolve an explicit stable YEIS `starId`. If that
  destination is unavailable, the signal is deliberately left unresolved
  rather than silently drifting to another star.
- `auto` entries use identity-based Rendezvous / Highest Random Weight (HRW)
  ranking over eligible non-Hero YEIS markers. Marker array order does not
  affect the result, and adding/removing a star only remaps entries that
  genuinely prefer the changed destination instead of modulo-remapping most
  content.
- collision resolution keeps different entries on different native star
  identities while capacity remains available; after capacity is exhausted the
  normal HRW winner is reused.
- `placementKey` decouples spatial identity from Astro's content file id.
  Keeping that key stable preserves both the selected star and the generated
  planet slot when content files are renamed.
- inside a selected system, the same placement key deterministically chooses
  one of the system's already-generated planets.

The content layer never changes YEIS star/planet physics or observed NASA data.

## Rendering

- Galaxy: a separate additive point overlay marks personal signals.
- System: a signal-bearing planet gets a cyan emissive/wireframe treatment.
- Travel/orbit: a small content card presents the entry metadata.
- Ordinary unassigned worlds remain untouched.

## Why no CMS yet

Astro already provides the loader, schema validation and typed query layer
needed for this stage. Keystatic, TinaCMS and Decap CMS were evaluated as
full editor solutions.

Keystatic is the preferred future editor if direct file authoring becomes
annoying because it can manage repository content while Astro continues to
query the same files. Adding it now would add packages and an admin surface
without improving the visitor experience.

## Extension points

The runtime consumes plain `UniverseContentEntry[]`, so future sources can be
added without changing placement/rendering semantics:

- Keystatic-managed local/Git files;
- a GitHub repository loader;
- an Obsidian/content-vault loader;
- a remote Astro content loader.

The source layer may expand; the universe-facing adapter stays the same.

## First vertical-slice validation

Validated against a clean production build and `astro preview` on 2026-11-22.

- Astro content sync accepted the collection schema and the real `personal-universe`
  entry.
- Default YEIS runtime reported `data-personal-content="1"` and
  `data-personal-signals="1"`.
- The established Personal Universe address is native YEIS star `c59669`.
  Content Placement v2 now pins that address explicitly so future catalog or
  placement-algorithm changes cannot move the flagship project.
- Native galaxy runtime reported `data-personal-signal-overlay="1"`.
- Deep-linking to `?phase=system&star=c59669` displayed the Personal Universe
  signal and reported one linked personal signal in that system.
- Deep-linking to `?phase=orbit&star=c59669&freeze=1` selected the
  signal-bearing world (`Spica d`) and rendered the WORLD SIGNAL project card.
- Visual inspection at 1440x900 confirmed the content card does not obstruct
  the planet, HUD, or orbit caption.


## Placement v2 stability contract

The original v1 auto placement used `hash(contentId) % markerCount`. That is
simple but highly disruptive: inserting or removing an eligible marker changes
the modulus and can move most signals at once.

Placement v2 reuses Rendezvous / Highest Random Weight semantics. Each
content-key/star-identity pair gets a deterministic score and the highest
ranked available star wins. The product keeps only a narrow local scoring
adapter; no new runtime hashing package is required.

Repository tests cover the intended invariants:

- reversing the marker array produces identical mappings;
- adding one marker to a 64-star / 24-signal fixture moves only the signal that
  prefers the new destination;
- changing a content file id while preserving `placementKey` preserves its
  star and planet seed;
- pinned entries always resolve the requested native star;
- a missing pinned destination never falls back to an unrelated automatic
  address.

This contract makes authored content portable across future catalog refreshes
without turning placement into a hand-maintained lookup table.

## Signal overlay capacity

Personal Signal rendering no longer carries a fixed 256-signal ceiling.

The galaxy overlay follows Three.js buffer lifecycle rules:

- preallocate a small power-of-two capacity (minimum 32);
- reuse the same typed buffer while the authored signal count remains within
  capacity;
- when capacity is exceeded, allocate the next power-of-two
  `BufferGeometry`, swap it onto the existing `Points` object, and dispose
  the superseded geometry;
- expose the active capacity as `data-personal-signal-capacity` for runtime
  diagnostics.

This keeps sparse portfolios cheap while allowing content collections to grow
well beyond the original fixed limit without rebuilding GPU buffers for every
incremental content addition.

## Personal Signal hover discovery

Implemented under task `PERSONAL-SIGNAL-HOVER-V3-001`.

Desktop discovery reuses the same Personal Signal placements and YEIS star
positions already used by the native galaxy overlay. The active Three.js camera
projects those authoritative 3D directions into screen coordinates; the Canvas
pointer surface then selects the nearest signal within a small screen-space
radius.

This intentionally does not create a second raycast scene or duplicate signal
geometry. R3F's pointer-event framework was evaluated, but the hosted YEIS
`Points` objects are imperative renderer objects rather than declarative JSX
interaction nodes. Floating UI virtual elements were also evaluated; they solve
DOM floating-element positioning after an anchor is already known, while the
actual problem here is identifying the hovered WebGL signal.

Pointer movement is coalesced with `requestAnimationFrame`, so hover hit tests
run at most once per rendered frame rather than once per raw pointer event.
Coarse/touch input continues to use direct signal picking instead of hover.

The hover card is non-interactive and exposes only real Content Collection
metadata (title and kind). It never fabricates content or becomes a second
navigation authority.

## Authoring pipeline v1

Personal content now has an explicit canonical identity and a small repository
workflow instead of relying on Astro's source filename as product identity.

The canonical source is still the existing Astro `portfolio` Content
Collection. Canonical records are JSON. Raw Markdown/MDX, YAML, CSV, exports,
or manually curated batches may be future/import inputs, but the durable
collection output is one deterministic JSON record per content identity. This
keeps Astro schema validation and the authoring CLI looking at the exact same
record set, so no source format can bypass cross-record ID, relation, media,
destination, migration, or alias integrity checks.

### Stable identity and compatibility

Every item stores `contentId` explicitly. Astro's `glob.generateId` also
uses that persisted value, so framework collection identity and product
identity cannot drift apart. Runtime `UniverseContentEntry.id`,
`personal:<id>` navigation destinations, relations, aliases, and generated
indexes all derive from the same value.

Therefore changing a filename, source ordering, display title, localized copy,
ranking, or Surface placement does not change canonical identity. Intentional
ID changes retain previous IDs in `legacyIds`, which the authoring resolver
continues to accept for old content references. Migrations are versioned with
`schemaVersion`; unsupported future/old versions fail instead of being
silently reinterpreted.

### One bilingual item

English and Chinese copy live on the same item under `i18n`. The base
`title` and `summary` remain the deterministic fallback, while explicit
English localized copy may override them. Discovery aliases may be authored in
both languages without cloning the content record.

Catalog linting rejects ambiguous explicit aliases across different canonical
items so Search does not gain multiple silent owners for the same authored
alias.

### Universe metadata

The authoring schema contains only renderer-independent product hints:

- `placement`, `placementKey`, and optional pinned `starId`;
- semantic `surface` hints such as region, anchor category, cluster, order,
  and featured behavior;
- Personal Signal visibility/importance/featured state;
- explicit related-content references;
- authored/generated/observed provenance;
- optional journey membership, media, and external links.

It does not store Surface coordinates or create another destination graph.
The existing placement adapter, Agent 07 discovery model, Agent 06 Surface
profile, and YEIS destination identities remain authoritative.

### Commands

The repository exposes one thin Node CLI with no new runtime dependency:

```text
npm run content:new -- --title "Project" --summary "..." --kind project
npm run content:import -- ./batch.json --dry-run
npm run content:migrate -- ./old-record.json
npm run content:migrate -- ./old-record.json --write
npm run content:validate
npm run content:preview -- --id personal-universe
npm run content:index
```

`content:new` persists a stable ID. Supplying `--id` is supported for
intentional public identities; otherwise the generated ID combines a readable
slug with a UUID fragment, so identity is not derived solely from mutable
display text.

`content:import` accepts a JSON object, array, or `{ "items": [...] }`
batch, rejects unknown fields (including unknown batch-envelope fields) and
duplicate/colliding IDs, normalizes defaults, then stages the whole batch before
renaming any file. A write failure removes the staged/committed files from that
batch. `--dry-run` performs the same normalization without writes.

`content:migrate` is non-destructive by default and prints the migrated
record. `--write` is explicit. Version 0 records that used `id` migrate to
version 1 `contentId` deterministically.

`content:validate` checks duplicate/legacy identities, relations, aliases,
date ranges, provenance, local public-media existence, and native YEIS pinned
IDs against the frozen `stars.bin` catalogue header/count. Astro itself remains
the schema authority for every collection record, and the production page also
validates pinned destinations against the canonical galaxy/native-star
authority before rendering.

`content:preview` reports canonical identity, shareable Personal Signal
destination, discovery copy/aliases, destination mapping and Surface hints
without building a second preview site. `content:index` emits a deterministic
derived identity/reference/alias index and never asks developers to edit a
generated file.

### Build enforcement

`npm run build` now runs the repository reuse gate, content validation, and
content unit tests before Astro builds. The normal CI build therefore catches
bad authored content before production while keeping the mandatory checks
local, deterministic, and fast. The 5,000-item validation fixture guards
against accidental quadratic catalog checks as authored content grows.

The original `personal-universe` source was mechanically normalized from
Markdown frontmatter into the canonical JSON format while retaining canonical
ID `personal-universe`,
placement key `personal-universe`, and native YEIS star `c59669`. Its
Chinese metadata and semantic Surface hints now exercise the richer contract
without changing the established product destination.

Keystatic remains the preferred optional future editor if repository authoring
itself becomes the bottleneck. It would sit over the same collection files;
it would not replace this canonical schema or create a second CMS/database.

