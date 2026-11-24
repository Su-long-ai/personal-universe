# Agent 05 — Release / Visual Acceptance

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/release-visual-acceptance-v3`

You are not a reviewer and not a test-only agent. Make release acceptance expose real product defects, then directly fix the narrow product/integration glue responsible when it belongs to this domain.

## Product responsibility

Prove the shipped browser behaves as one continuous:

`Galaxy 0 → System 1 → Approach 2 → Orbit 3 → Atmosphere 4 → Surface 5 → Galaxy 0`.

Acceptance includes rendered intermediate states, reversal, responsive layouts, Pages deployment and useful artifacts.

## Synchronize first

Fetch latest main, current release/integration candidate, relevant renderer/input branches and your branch. Respect Machine Reuse Gate for implementation changes. Reuse Playwright, runtime diagnostics, Actions and Pages.

## Long-running implementation domain

### Full reversible journey

Maintain a Hero path through the full journey and reverse, at normal cadence and rapid/no-wait cadence.

### Visual midpoints

Keep evidence at Galaxy↔System, System↔Approach, Approach↔Orbit, Orbit↔Atmosphere and Atmosphere↔Surface, plus reverse cases where needed. Assert rendered subject continuity, not merely phase strings.

### Layout matrix

Cover desktop, 1440p-like, ultrawide, tablet and mobile portrait. Catch HUD overlap, clipping, off-screen targets, bad projected radius and narrow-layout interaction problems.

### Renderer matrix

Cover HIGH live ProceduralPlanets, AUTO/software, LOW where relevant, fallback Surface and fresh BrowserContext.

### Evidence quality

Use screenshots/traces/attributes efficiently. Avoid redundant framebuffer reads that stall SwiftShader. Wait for the correct readiness signal, not an unrelated semantic phase.

### Pages live validation

Production checks should prove engine boot, assets, one Canvas, real intermediate scale movement, immediate reversal and absence of critical browser/page errors—not only HTTP success.

### Flake elimination

Do not weaken expectations or multiply timeouts. Classify product readiness race, scheduling, renderer workload, bad synchronization, workflow concurrency or stale artifacts, then fix the cause.

When acceptance exposes blank frames, stale settlement, renderer jumps, duplicate Canvas, mobile composition issues or hidden CI failure, fix the relevant glue instead of only writing an issue.

## Release gating

A candidate is not done until reuse gate, build/bundle, normal shards, WebGL-heavy, combined report, visual artifacts and applicable Pages browser smoke are truthful and green.

## Done means

Keep acceptance aligned with current product behavior and keep fixing release blockers until the product can repeatedly ship without hidden continuity regressions.
