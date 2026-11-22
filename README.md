# Personal Universe

A desktop-first cinematic personal-universe prototype built with Astro, React, Three.js and React Three Fiber.

## Current vertical slice

The current milestone proves one complete experience chain:

`Galaxy -> System -> Approach -> Orbit -> Atmosphere -> Surface -> Return`

The default astronomical backbone is the pinned MIT YEIS core with the local
NASA Exoplanet Archive snapshot layered observation-first. Personal content is
still intentionally sparse while navigation, scale continuity and performance
are stabilized.

## Run

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

### Engine rollback

YEIS is the default engine. For regression comparison or emergency rollback,
open the site with `?engine=v2`. If YEIS initialization fails at runtime, the
app automatically switches the active renderer to V2.

Regenerate the lightweight local test assets:

```bash
python scripts/generate_textures.py
python scripts/generate_ambient.py
```

The ambient generator uses the installed FFmpeg to emit a small looping OGG. The browser never generates textures or audio on the first frame; V0 serves prebuilt assets from `public/`. This keeps the rendering path responsive and mirrors the later NASA/KTX2/media asset pipeline.

## Architecture

- `src/components/universe`: runtime experience and world scenes
- `src/lib/universe`: shared world definitions and state types
- `docs/vertical-slice-v0.md`: product/experience constraints

The long-term scene hierarchy is:

`Galaxy -> System -> Orbit -> Atmosphere -> Surface`

World interiors are deliberately modular so each important planet can become a completely different visual and interaction style.

## Reuse policy

Commodity infrastructure should be reused instead of rebuilt: Astro, R3F/Three.js, Drei, postprocessing, camera-controls, GSAP, Howler and Theatre.js are installed as the foundation. Experimental procedural-planet/nebula projects should only be introduced behind adapters after local benchmarking.


## Personal content

Real portfolio entries live in `src/content/portfolio/` and are validated by
Astro Content Collections. The runtime maps them deterministically onto stable
YEIS stellar addresses and then onto an existing world in that system.

The galaxy is intentionally sparse: unassigned stars and planets stay
astronomical/procedural instead of receiving fabricated personal content.

See `docs/architecture/content-layer.md` for the placement model and future CMS
extension path.

## Navigation

The default YEIS path exposes a shared universe navigator for Personal Signals
and astronomical destinations. Use `SEARCH / PLACES`, `Ctrl+K` / `Cmd+K`, or
`/` to open it. Personal content is searched alongside the pinned MIT YEIS star,
black-hole and landmark indexes rather than through a duplicate catalogue.

See `docs/architecture/navigation.md`.
