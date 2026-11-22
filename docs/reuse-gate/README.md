# Reuse-first implementation gate v3

Personal Universe uses a machine-enforced, whole-solution-first reuse workflow.

The important change in v3 is that enforcement is no longer limited to a dirty local checkout. GitHub CI evaluates the actual protected files changed by a pull request or push and requires those files to be covered by valid, pre-existing task approvals.

## Search order

Research must move top-down:

```
full solution
  -> framework / engine / platform
    -> subsystem
      -> component / asset / algorithm / data
        -> custom implementation
```

A lower-level solution may still win when total value is better. The gate requires the broader alternatives and their tradeoffs to be recorded instead of silently ignored.

## Persistent registry

`docs/reuse-gate/registry.json` is the reusable-solution catalog.

Statuses:

- `adopt` — proven default
- `trial` — validated but still bounded
- `assess` — promising; evaluate before adoption
- `hold` — unavailable for new selection

The registry is shared knowledge. New tasks should reuse it before starting external research from zero.

## Task-scoped records

New work must not use one global mutable approval token.

Each task gets:

```
docs/reuse-gate/tasks/<TASK_ID>.json
docs/reuse-gate/approvals/<TASK_ID>.json
```

This allows multiple agents to work in parallel without overwriting one another's research/approval state.

Legacy `current.json` and `approval.json` are still readable for existing v2 work, but are not the normal v3 workflow.

## Required task record

Each task declares `scope.level` as:

- `architecture`
- `subsystem`
- `implementation`

Every record includes:

- external sources;
- the four-level search ladder;
- registry-backed candidates;
- multidimensional evaluations;
- exact `planned_files`;
- explicit selected candidate IDs;
- higher-level tradeoffs.

Architecture and subsystem tasks also require a capability `coverage_matrix`.

Candidate dimensions remain:

- coverage;
- integration cost;
- license fit;
- maintenance health;
- performance fit;
- customization fit;
- maturity.

The score makes global value visible. It does not blindly pick the numerically highest option; higher-scoring rejected candidates require an explicit override reason.

## Approval workflow

Before protected implementation:

1. Update the registry if needed.
2. Create/update `docs/reuse-gate/tasks/<TASK_ID>.json`.
3. Lint:
   `node scripts/reuse-gate.mjs lint docs/reuse-gate/tasks/<TASK_ID>.json`
4. While protected implementation files are still clean:
   `npm run reuse:approve:task -- docs/reuse-gate/tasks/<TASK_ID>.json`
5. Commit the task record, registry research and generated approval token.
6. Only after that commit, implement protected files.
7. Run:
   `npm run gate:reuse`
   and
   `npm run gate:reuse:staged`
8. Push/open the PR.

The separate approval commit is deliberate: Git history lets the CI gate prove that machine approval existed before the first protected implementation commit.

## What schema 3 freezes

A schema-3 approval freezes:

- task-record SHA-256;
- approval baseline commit;
- planned implementation paths;
- selected candidates;
- calculated global scores;
- hashes of only the registry entries referenced by that task.

Freezing referenced entries instead of the entire registry is important for parallel work. Agent A can add an unrelated candidate without invalidating Agent B's approval. If a registry entry that B actually relied on changes, B must re-evaluate/re-approve.

## GitHub PR/push enforcement

`.github/workflows/ci.yml` runs a dedicated **Machine Reuse Gate** before build.

The runner checks the actual commit range:

- PR: base SHA -> PR head SHA
- push: previous SHA -> pushed SHA
- manual run: previous commit fallback

For every protected changed file the gate finds at least one valid approval whose `planned_files` cover that path.

For schema-3 approvals it also verifies:

- the approval baseline is an ancestor of the evaluated head;
- the task record is frozen at the approval-metadata commit;
- referenced registry entries are frozen at that same approval-metadata commit;
- policy files use an architecture-level `policy_change: true` task;
- the approval-token commit precedes the first implementation commit for the covered file.

A protected change without coverage blocks CI.

## Merge-history requirement

Schema-3 approvals intentionally use Git history as machine evidence that approval preceded implementation. Until the gate gains a provenance mode that survives history rewriting, PRs containing schema-3 work must use **merge commits**.

Do not use squash merge or rebase merge for schema-3 task PRs. Squash collapses the approval and implementation commits; rebase rewrites their commit IDs. Either destroys the ancestry evidence stored in the approval token.

## Current GitHub plan boundary

This repository is private and its current GitHub plan does not expose repository Rulesets/required-status-check enforcement. The API returns an upgrade/public-repository requirement.

As a result, v3 can machine-block every downstream CI/build/preview/artifact path when the gate fails, but GitHub itself cannot currently make the Merge button unavailable. Contributors and agents must treat a successful `Machine Reuse Gate` as a mandatory merge precondition.

If the repository becomes public or GitHub Pro is enabled, configure `Machine Reuse Gate` as a required status check so even repository UI/API merges cannot bypass it.

## Protected implementation

Protected implementation includes the product/runtime surface such as:

- `src/**`
- `public/**`
- `scripts/**`
- `package.json` / `package-lock.json`
- Astro/TypeScript config

Gate metadata itself is not treated as implementation, so research/approval can be prepared first.

## Protected policy

Executable policy is protected more strictly:

- `scripts/reuse-gate.mjs`
- `AGENTS.md`
- this README
- `.githooks/**`
- `.github/workflows/**`
- `.github/actions/**`

These paths require:

- `scope.level = architecture`
- `policy_change = true`

The gate may be improved, but not bypassed by deleting a workflow, converting failures to warnings, excluding a protected path, or weakening checks without an approved architecture-level policy task.

## Local vs cloud enforcement

Local checks remain useful:

- `npm run gate:reuse` — working tree
- `npm run gate:reuse:staged` — staged changes

GitHub's PR-range check is authoritative for cloud development:

- `npm run gate:reuse:ci`

This makes GitHub connector/agent development subject to the same policy even when no local Git hook ever runs.

## Why the runtime stays Node

OPA/Conftest remains a valid escalation option, but v3 deliberately extends the existing Node implementation first.

The current policy is repository-specific, small enough to audit, and already integrated into npm/Git. Adding Rego and another policy runtime would duplicate ownership without increasing current coverage.

If the policy grows substantially beyond repository-local file/research rules, the structured v3 task records are suitable inputs for a future OPA migration.

## Parallel-agent rule

Each agent should create a separate task ID and approval token for its own substantial work. Agents may share an approval only when they are genuinely implementing the same researched task and file scope.

Do not create two competing generic subsystems when the registry or another active task already provides one.

## License boundary

YEIS source reuse remains pinned to:

`e52056897364e060fbd6d00951628f163b57d7a1`

That verified snapshot is the allowed MIT code boundary. Current AGPL YEIS can be inspected for design ideas but newer AGPL code must not be copied into Personal Universe.
