# Agent 03 — Scale Input / Product Feel

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/scale-input-product-feel-v3`

You are not a reviewer. Own the human-input side of the full **0→5→0** journey. Modify the input path, response mapping, camera-facing scale glue, diagnostics and tests until wheel/trackpad control feels immediate, reversible and continuous.

## Synchronize first

Fetch latest main, active direct-scale/renderer/productization branches and your branch. Respect Machine Reuse Gate and reuse browser wheel semantics, the current scale coordinator, camera-controls and the native bridge before inventing machinery.

## One input authority

There must be one product owner for scale input. Keep underlying camera wheel actions disabled where the coordinator owns scale.

Do not add a second wheel state machine, custom inertia engine, hidden phase queue or time-driven movement after delivered input ends.

## Long-running implementation domain

### Device-normalized samples

Handle mouse notches, high-resolution wheels, Windows precision touchpads, Mac-style small deltas, deltaMode, burst input, inertial tails, jitter and mixed signs.

Aim for consistent perceived intent, not identical raw numeric speed.

### Response curve

Tune the full domain. Detect dead Galaxy motion, abrupt System→Approach acceleration, Orbit/Atmosphere stalls, Surface overshoot, asymmetric reverse, high-frequency backlog and swallowed tiny deltas.

Prefer the existing continuous coordinate plus a small explicit response mapping. Never regress to threshold-driven phase stepping.

### Immediate reversal

A sign change acts immediately. No stale deltas, cinematic completion, renderer settlement or old autopilot continues in the prior direction.

Repeated micro-reversal must remain bounded and deterministic.

### Delivered-input semantics

When browser samples stop, project-owned scale motion stops except damping explicitly owned by the existing camera authority and consistent with current coordinate. Do not synthesize new project inertia without formal approval.

### Reduced motion

Reduced-motion may reduce smoothing but must preserve continuous spatial control.

### Cross-segment feel

Tune perceived target growth/camera distance across physical scales. Numeric coordinate speed need not be uniform if the visual result is coherent.

## Evidence

Track scale position, direction, segment, delivered sample, response output, reversal generation, handoff state and existing projected-radius/camera-distance diagnostics. Diagnostics are not authority.

Maintain tests/traces for -4/-8/-16/-32 samples, mouse notches, 60/120/144Hz-like delivery, inertia tails, long inward/outward gestures, immediate reversal, oscillation, 0↔1/1↔2/4↔5 reversal, takeover, no post-tail motion and mobile/desktop contexts.

## Product feel

Do not stop because the state machine is continuous. Use visual/browser evidence to find places that still feel staged and tune the existing response/glue. Avoid parameter thrashing; validate each change globally forward and reverse.

## Done means

Common mouse and trackpad patterns provide predictable, immediate, non-queued 0→5→0 control across repeated journeys and current hosted release acceptance.
