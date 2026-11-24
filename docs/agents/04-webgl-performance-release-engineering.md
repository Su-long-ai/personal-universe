# Agent 04 — WebGL / Performance / Release Engineering

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/webgl-performance-release-v3`

You are not a reviewer. Directly modify WebGL lifecycle, resource ownership, performance hot paths, workflows and tests until the existing renderer stack is stable on browser hardware-like paths and GitHub hosted SwiftShader.

## Synchronize first

Fetch latest main, current release candidate, renderer-continuity branch and your branch. Respect Machine Reuse Gate. Reuse Three/R3F lifecycle, ProceduralPlanets, ProceduralTerrains, Playwright and existing Actions caches/shards/artifacts.

Do not change product navigation semantics or create another renderer/camera authority.

## Long-running implementation domain

### Resource lifecycle

Track/fix context creation, context loss/recovery, renderer disposal, pagehide, stale timers after BrowserContext close, material/program/texture/geometry lifetime, composer/pass allocation, terrain lifetime and repeated mount/unmount.

Repeated 0→5→0 cycles must not leak a new resource world each time.

### Hot paths

Remove avoidable per-frame/per-wheel allocations, React high-frequency state churn, geometry/material reconstruction, redundant framebuffer reads and final-boundary heavy work. Prefer stable refs and scratch objects.

### Quality modes

HIGH preserves intended live visuals where supported. AUTO makes a bounded capability choice. LOW/software remains readable and responsive without pretending to be HIGH.

Do not weaken product behavior merely to make SwiftShader green.

### Hosted stability

Differentiate real product race, readiness issue, excessive renderer cost, SwiftShader behavior and workflow/artifact failure. Fix causes rather than inflate timeouts.

### Context-loss correctness

Forced loss/recovery must leave known state and permit a fresh BrowserContext. Avoid late forced-loss tasks racing document destruction.

### Runtime evidence

Keep useful bounded metrics: calls, programs, textures, geometries, renderer identity, screenshot readiness, context lifecycle and repeated-cycle deltas. Evidence itself must not significantly distort runtime.

## Performance acceptance

Cover first load, Galaxy idle, System, close-world phases, repeated Surface cycles, quality switching, software WebGL, forced loss, fresh context and absence of progressive resource growth/shader churn.

You may improve GitHub Actions when it directly improves release reliability. Prefer current sharding/caches/artifacts; do not build a new CI framework.

## Done means

Not one green heavy test. Continue until repeated full journeys and hosted release jobs are stable, bounded and reproducible with no recurring WebGL lifecycle blocker.
