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

