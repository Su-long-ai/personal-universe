# Mandatory machine-enforced reuse gate

All agents and human contributors are subject to the same repository policy. Prompt instructions are not the enforcement boundary; GitHub CI is.

Before editing any protected implementation path, search from the largest reusable solution downward:

1. **Full solution / existing product**
2. **Framework / engine / platform**
3. **Subsystem**
4. **Component / asset / algorithm / data**
5. **Custom implementation** only after the upper levels were checked or explicitly ruled out

A lower-level choice may still win when its global value is better. Do not reject a candidate merely because one local metric regresses.

## New task workflow (v3)

New work must use task-scoped records so parallel agents do not overwrite one global token.

1. Search `docs/reuse-gate/registry.json` first and refresh/add reusable candidates when needed.
2. Create/update:
   `docs/reuse-gate/tasks/<TASK_ID>.json`
3. Lint it:
   `node scripts/reuse-gate.mjs lint docs/reuse-gate/tasks/<TASK_ID>.json`
4. While protected implementation paths are still clean, approve it:
   `npm run reuse:approve:task -- docs/reuse-gate/tasks/<TASK_ID>.json`
5. Commit the task record, any registry research, and:
   `docs/reuse-gate/approvals/<TASK_ID>.json`
   **before** the first protected implementation commit.
6. Implement the approved scope.
7. Before each stable commit run:
   `npm run gate:reuse`
   and
   `npm run gate:reuse:staged`
8. Push/open a PR. GitHub runs the authoritative PR-range machine gate.

The legacy `current.json` / `approval.json` pair remains readable for existing work only. Do not start new parallel tasks with the legacy singleton.

## What the machine gate enforces

The CI gate evaluates the actual protected files changed between the PR base and head. Every protected file must be covered by at least one valid task approval.

For schema-3 approvals the machine verifies:

- research record structure and candidate evaluation;
- top-down search ladder;
- referenced registry entries;
- task record hash;
- referenced registry-entry hashes;
- approval baseline ancestry;
- that the research record and referenced registry state existed at the approval baseline;
- planned-file coverage;
- architecture-level approval for policy changes;
- that the task/approval metadata was committed before the protected implementation commit.

Unrelated registry additions do not invalidate another agent's schema-3 approval.

## Protected policy

The gate itself is protected. Changes to any of the following require an architecture-level record with `policy_change: true`:

- `scripts/reuse-gate.mjs`
- `AGENTS.md`
- `docs/reuse-gate/README.md`
- `.githooks/**`
- `.github/workflows/**`
- `.github/actions/**`

Do not bypass, weaken, skip, remove, or convert the machine gate into a warning. Do not split a larger task into artificial tiny changes to evade reuse research.

## Reuse principles

- Prefer mature external capability for generic infrastructure.
- Keep project code focused on Personal Universe-specific semantics.
- Reuse the smallest necessary dependency closure; choosing an upstream project does not justify copying the whole project.
- License and asset provenance are hard constraints.
- YEIS code reuse is pinned to the verified MIT boundary:
  `e52056897364e060fbd6d00951628f163b57d7a1`
  Current AGPL YEIS may be studied for ideas but its newer code must not be copied.
- Reuse Gate exists to accelerate implementation, not replace it. Once a direction is approved, continue writing code/tests and shipping milestones.

## Development

When starting the Astro dev server locally, use background mode:

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Normal development is GitHub-first. A local checkout is only required for device-specific, Windows-specific, local-file, or GPU validation.

## Documentation

Full Astro documentation: https://docs.astro.build
