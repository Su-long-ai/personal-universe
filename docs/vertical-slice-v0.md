# Vertical Slice V0

## Goal

Prove one complete cinematic journey before building the portfolio content:

Galaxy -> select a star system -> approach a planet -> orbital close-up -> atmosphere transition -> surface/world placeholder -> return to space.

The prototype is judged on:
1. scale / awe
2. continuity
3. interaction
4. runtime performance

## Experience rules

- The galaxy is not a menu of evenly spaced glowing balls.
- Favor mixed scale: sparse distant structure, then a planet or star can dominate the frame.
- Outer-space navigation is click + scroll. Planet interiors may use completely different interaction models.
- Direct navigation remains available and can collapse.
- Travel is optional experience, not a usability gate.
- Known space should feel physically plausible; unknown/personal worlds may become imaginative.
- Sound is part of the experience, with a clear mute control.
- Mobile is not a V0 priority.

## Scene architecture

Galaxy -> System -> Orbit -> Atmosphere -> Surface

These are logical scene layers, not one huge coordinate space.
Transitions may hide asset/scene swaps using clouds, exposure, bloom, darkness, or motion blur.

## Reuse policy

Use mature external capabilities for commodity problems:
- Astro: site shell
- Three.js + React Three Fiber: realtime rendering
- Drei: common 3D helpers
- camera-controls: exploration camera
- Theatre.js: authored cinematic camera beats
- GSAP: DOM/UI transitions
- Howler: sound
- postprocessing: bloom/tone/effects
- glTF/KTX2/Meshopt/Draco: asset pipeline

Experimental planet/nebula libraries must sit behind adapters and must not define core architecture.

## V0 scope

Include:
- procedural star field with depth/parallax
- stylized Milky Way band/core
- one selectable test planet
- cinematic approach
- atmospheric shell
- transition to a surface placeholder
- return to orbit/galaxy
- collapsible navigation HUD
- quality preset stub
- mute state stub

Exclude:
- real portfolio content
- full procedural terrain
- real astronomy dataset ingestion
- mobile optimization
- multiplayer/game physics
