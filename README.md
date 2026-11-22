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

Regenerate the lightweight local test textures:

```bash
python scripts/generate_textures.py
```

The browser never generates those textures on the first frame; V0 serves prebuilt PNG assets from `public/textures`. This keeps the rendering path responsive and mirrors the later NASA/KTX2 asset pipeline.

## Architecture

- `src/components/universe`: runtime experience and world scenes
- `src/lib/universe`: shared world definitions and state types
- `docs/vertical-slice-v0.md`: product/experience constraints

The long-term scene hierarchy is:

`Galaxy -> System -> Orbit -> Atmosphere -> Surface`

World interiors are deliberately modular so each important planet can become a completely different visual and interaction style.

## Reuse policy

Commodity infrastructure should be reused instead of rebuilt: Astro, R3F/Three.js, Drei, postprocessing, camera-controls, GSAP, Howler and Theatre.js are installed as the foundation. Experimental procedural-planet/nebula projects should only be introduced behind adapters after local benchmarking.
