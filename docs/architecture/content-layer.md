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
- `placement: auto | hero`;
- optional `href`;
- `draft`.

The first real entry is the Personal Universe project itself. No synthetic
projects or experiences are generated.

## Placement model

`src/lib/universe/content/placement.ts` is a narrow deterministic adapter.

- `hero` entries attach to the handcrafted Hero system.
- `auto` entries choose from stable non-Hero YEIS markers.
- collision resolution keeps different entries on different stars while slots
  remain available.
- inside a selected system, the same entry deterministically chooses one of the
  system's already-generated planets.

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
- The deterministic placement target for the current snapshot is native YEIS
  star `c59669`.
- Native galaxy runtime reported `data-personal-signal-overlay="1"`.
- Deep-linking to `?phase=system&star=c59669` displayed the Personal Universe
  signal and reported one linked personal signal in that system.
- Deep-linking to `?phase=orbit&star=c59669&freeze=1` selected the
  signal-bearing world (`Spica d`) and rendered the WORLD SIGNAL project card.
- Visual inspection at 1440x900 confirmed the content card does not obstruct
  the planet, HUD, or orbit caption.
