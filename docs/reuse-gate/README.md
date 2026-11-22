# Reuse-first implementation gate v2

This project uses a machine-enforced **whole-solution-first** reuse workflow.

## Why v2 exists

The original gate prevented local reinvention but could still miss a larger existing product that covered several planned subsystems at once. v2 forces research to move top-down before implementation:

```
full solution
  -> framework / engine / platform
    -> subsystem
      -> component / asset / algorithm / data
        -> custom code
```

A lower-level solution may still be selected when it has better total value. It just cannot win by silently ignoring a broader candidate.

## Records

- `current.json` — the active decision record.
- `approval.json` — immutable-for-the-task approval token containing Git baseline and hashes.
- `registry.json` — persistent reusable-solution catalog.

The registry borrows the lightweight lifecycle idea of Technology Radar:

- `adopt` — proven default.
- `trial` — validated but still limited.
- `assess` — promising, requires evaluation.
- `hold` — do not use for new implementation.

## Required record structure

Every task declares `scope.level` as `architecture`, `subsystem`, or `implementation`.

Every record must include:

- external sources;
- the four-level `search_ladder`;
- registry-backed candidates;
- multidimensional candidate evaluations;
- exact `planned_files`;
- explicit selected candidate IDs;
- explicit tradeoffs for higher-level candidates.

Architecture and subsystem tasks additionally require a capability `coverage_matrix`.

Candidate evaluation is intentionally multidimensional:

- coverage;
- integration cost;
- license fit;
- maintenance health;
- performance fit;
- customization fit;
- maturity.

The gate calculates a global-value score to make broad benefit visible. It does **not** blindly auto-pick the highest number. If a higher-scoring candidate is rejected, the decision must explicitly record why.

## Workflow

1. Check `registry.json` first.
2. Research full solutions before smaller parts.
3. Update the registry and `current.json`.
4. Run:
   `node scripts/reuse-gate.mjs lint`
5. While protected files are still clean, run:
   `npm run reuse:approve`
6. Implement.
7. `npm run dev`, `npm run build` and pre-commit re-check the approval.

Approval freezes:

- research-record SHA-256;
- reuse-registry SHA-256;
- Git HEAD baseline;
- planned implementation paths;
- selected candidates and calculated global scores.

If the research or registry changes after approval, the task is blocked until it is re-approved.

## Protected policy

The gate itself, `AGENTS.md`, the gate README and registry are protected by the same mechanism. A policy change must use an architecture-level record with `policy_change: true`.

The enforcement runtime intentionally stays small and reuses Git hooks and npm lifecycle hooks. OPA/Conftest remains the escalation path if this policy ever grows beyond a repository-local Node script.
