# Agent 01 — Native Scale / YEIS

Repository: `Su-long-ai/personal-universe`

Preferred long-lived branch: `agent/native-scale-yeis-v3`

If already assigned an existing Native Scale long-lived branch, continue it instead of creating a duplicate.

You are not a reviewer. Continuously implement, test, push, and productize **Galaxy=0 → System=1 → Galaxy=0** using the existing native YEIS path.

## Start of every session

Fetch latest `origin/main`, your branch, and active continuous-scale integration/release branches. Consume accepted newer work instead of rebuilding it. Use merge-based synchronization when schema-3 ancestry matters.

Before a new protected implementation unit, confirm existing reuse approval covers it or create formal reuse research + approval first.

## Fixed authority

Reuse pinned MIT YEIS commit `e52056897364e060fbd6d00951628f163b57d7a1`:

- Universe
- CameraController
- gotoPoint/native travel
- floating/reference-frame behavior
- StarPoints / BodyRenderer / BodyPoints / OrbitLines
- native system identity

Also reuse the existing product continuous-scale coordinator and destination identity.

Do not add another Galaxy camera, tween/RAF engine, transition-only star/system renderer, duplicate star database, second wheel owner, or duplicate scale state machine. Do not hide discontinuities with fade-to-black.

## Long-running implementation domain

### Direct native progress

The product scale coordinate must directly scrub native camera motion. Elapsed time must not advance a scale-owned trajectory. Native Search/Places/click travel must remain normally time-driven when scale does not own the path.

### Stable physical path

A gesture captures one stable target and retains:

- destination/star/system identity
- physical target and reference frame
- start camera state
- native logarithmic path
- entry quaternion/view direction
- System endpoint

Do not reselect because LOD changed, React rerendered, renderer mounted, or phase changed.

### Reference-frame continuity

Keep Universe.switchTo/frame shifts/floating origin continuous. Absolute camera position, quaternion, view direction and target must not jump. Reversal from any intermediate coordinate must retrace the same physical path.

### Native LOD continuity

The same object should read as far point → focused star → native system → product System endpoint without pop, duplication, drift or wrong-origin frames.

### Authority takeover

Search, Places, Journey, deep links and pointer/touch manual takeover must freeze or supersede partial scale cleanly. No stale native autopilot may resume later.

### Endpoint matching

Coordinate 1 must match the product System frame in apparent center, projected scale, direction, quaternion and target identity. Reverse must use the same endpoint.

## Performance

High-frequency input must not allocate new vectors/cameras/renderers/geometries/native systems per sample. Keep hot motion imperative/ref-based; React state is for semantic boundaries/diagnostics, not per-frame camera authority.

## Acceptance

Maintain real E2E for tiny deltas, mouse notches, 0.2/0.5/0.8 positions, multiple reversal points, rapid sign changes, 60/120/144Hz-like delivery, inertia tails, boundary reversal, Search/Journey/manual takeover, same target identity, no stale completion, one Canvas, and exact return to coordinate 0.

Expose only narrow diagnostics needed to prove behavior.

## Done means

Not “works once.” Continue until repeated forward/reverse cycles, takeover, high-frequency input, native LOD and renderer handoff are robust on current main and hosted CI. Push meaningful implementation continuously and keep the branch synchronized.
