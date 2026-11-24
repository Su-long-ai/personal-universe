# Agent 06 — Surface / World Productization

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/surface-world-productization-v3`

You are not a reviewer. Directly implement and productize the late Atmosphere/landing/Surface experience, world-local content placement and scalable secondary-world generation.

## Synchronize first

Fetch latest main, active renderer/productization branches and your branch. Before protected implementation, use existing reuse approval or perform formal reuse research + approval.

## Reuse-first stack

Prefer existing ProceduralPlanets, ProceduralTerrains/Infinite World fallback path, terrain/surface camera anchor, Three/R3F, content collections, destination model, Personal Signal/Places/Journey primitives and compatible external techniques.

Do not build a second terrain engine, CMS, navigation system or independent Surface app.

## Product direction

Surface may read as a slightly curved, near-planar 2.5D world viewed above/obliquely. Borrow useful spatial ideas—subtle curvature/elevation, terrain regions, landmarks, paths/clusters, scale-aware content and parallax—without requiring literal Civilization-style hex gameplay.

Keep the design evidence-driven and automation-friendly.

## Long-running implementation domain

### Landing continuity

Keep terrain anchor, camera up, view direction, lighting, selected world identity and content location intent continuous through 4→5 and reverse.

### Surface camera/exploration

Support useful limited pointer/touch exploration within the approved camera authority. Wheel remains owned by continuous scale and must cleanly leave Surface.

### Spatial content placement

Build a reusable model using landmarks, districts/regions, paths, clustered signals, terrain anchors and layered labels/cards. Content must remain understandable without learning a game UI and must work on mobile.

### Automatic secondary worlds

Create deterministic reusable world archetypes using stable identity/seed:

- terrain/biome palette
- atmosphere
- lighting
- landmark density
- content density
- metadata/naming
- fallback texture

Secondary worlds should not require hand-authoring. Deep links/screenshots must remain reproducible.

### Primary vs filler worlds

The main personal world can be richer/authored. Other worlds should use scalable procedural templates while preserving one destination/content model.

### Readability

Continuously test text/card legibility, occlusion, camera angle, contrast, scale, narrow/tablet/mobile layouts, landmark visibility and reduced motion.

### Performance/fallback

Do not improve Surface by adding final-boundary stalls. Keep software/LOW readable and bounded. Heavy detail may arrive after stable landing when the current lifecycle supports it.

### Reverse departure

Surface is not a dead-end page. Reverse scale must lift cleanly back through the same world/system path without needless destruction or loss of useful state.

## Acceptance

Maintain visual/browser evidence for landing, stable Surface, readable content, tablet/mobile, reverse departure, repeated land/leave cycles, generated secondary worlds, software fallback and absence of duplicate renderer/camera authority.

## Done means

Not one pretty screenshot. Continue until Surface is a coherent product destination, content placement is reusable, secondary worlds can be generated automatically, reverse travel is clean and the experience remains maintainable inside the adopted renderer stack.
