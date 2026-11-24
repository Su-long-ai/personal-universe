# Agent 02 — World Renderer Continuity

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/world-renderer-continuity-v3`

You are not a reviewer. Directly implement **System=1 → Approach=2 → Orbit=3 → Atmosphere=4 → Surface=5 → System/Galaxy reverse** renderer continuity and resource lifecycle until release-grade.

## Synchronize first

Fetch latest main, active release/integration branches and your branch. Reuse accepted work. Confirm Machine Reuse Gate coverage before protected implementation.

## Fixed stack

Retain one R3F Canvas, Three.js lifecycle, camera-controls as product close-world camera authority, pinned MIT YEIS System identity, ProceduralPlanets Planet/PlanetPass, ProceduralTerrains/existing Surface fallback, current scale coordinate and selected destination.

Do not create a second Canvas, renderer manager, camera tween engine, transition globe, terrain engine, or masking fade.

## Long-running implementation domain

### System→Approach

Keep System visible until a matched world frame has actually painted. Preserve projected radius, center, view direction/quaternion and identity. No black frame, duplicate planet, or old System-space camera leakage. Reverse uses the same endpoint.

### Stable world lifetime

Approach→Surface should retain the same world renderer/resources where capability permits. Avoid phase-driven destruction/recreation of Planet, PlanetPass/composer, materials, textures, geometry, terrain runtime or expensive bake state.

### Readiness contract

Keep distinct:

- mounted
- capability selected
- first paint
- camera reached requested frame
- screenshot/pipeline fully converged

Do not make camera settlement wait on unrelated expensive screenshot readiness, and do not hand off before the concrete renderer has painted.

Resolve races around quality changes, software WebGL, HIGH live worlds, Surface camera frames and renderer replacement.

### Atmosphere→Surface

Capable live worlds should descend continuously toward the terrain-derived Surface frame. AUTO/software/LOW should preserve the canonical globe through 4→5 and hand final coordinate 5 to the existing retained terrain/fallback. Reverse must be equally continuous.

### Fallback lifecycle

Prepare/park/reuse fallback terrain instead of rebuilding it repeatedly. Keep software rendering bounded and readable; avoid expensive bake work where accepted cheaper capability exists.

### Lighting/composition

Keep Orbit/Atmosphere/Surface on a coherent hemisphere and orientation. Avoid terminator flips, sudden roll, target jumps or landing-side changes.

## Performance

Reduce resource churn, shader/material recompiles, texture/geometry rebuilds, composer/pass reallocations, mount storms and SwiftShader stalls. Reuse scratch state on hot paths.

## Acceptance

Cover all segment midpoints, HIGH live path, AUTO/software, LOW where relevant, desktop/tablet/mobile/ultrawide, rapid reversal around each renderer boundary, one Canvas, stable allocation counters, no blank frame, same world identity, Surface park/resume, and repeated 0→5→0 cycles.

Hosted WebGL failure means diagnose the real readiness/lifecycle/performance cause; do not inflate timeouts.

## Done means

Renderer ownership and resources stay stable under repeated full journeys, quality changes and hosted release CI with no obvious visual stage break. Keep implementing beyond one fixed handoff.
