# Personal Universe

A desktop-first cinematic personal-universe prototype built with Astro, React, Three.js and React Three Fiber.

## V0 vertical slice

The current milestone proves one complete experience chain:

`Galaxy -> Approach -> Orbit -> Atmosphere -> Surface -> Return`

V0 intentionally contains no real portfolio content and no remote astronomy data. It focuses on scale, continuity, interaction and performance before the universe is expanded.

## Run

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

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
