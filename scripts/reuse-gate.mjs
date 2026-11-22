import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = process.cwd();
const APPROVAL_PATH = resolve(ROOT, "docs/reuse-gate/approval.json");
const DEFAULT_RECORD = resolve(ROOT, "docs/reuse-gate/current.json");
const REGISTRY_PATH = resolve(ROOT, "docs/reuse-gate/registry.json");

const SEARCH_LEVELS = [
  "full_solution",
  "framework_engine",
  "subsystem",
  "component_asset",
];
const LEVEL_RANK = new Map(SEARCH_LEVELS.map((level, index) => [level, SEARCH_LEVELS.length - index]));
const SCOPE_LEVELS = ["architecture", "subsystem", "implementation"];
const SEARCH_STATUSES = ["found", "none", "not_applicable"];
const REGISTRY_STATUSES = ["adopt", "trial", "assess", "hold"];
const IMPORTANCE = ["high", "medium", "low"];
const POLICY_FILES = new Set([
  "scripts/reuse-gate.mjs",
  "AGENTS.md",
  "docs/reuse-gate/README.md",
]);

function die(message) {
  console.error("\n[REUSE-GATE] BLOCKED");
  console.error(message);
  process.exit(2);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    die("git " + args.join(" ") + " failed: " + error.message);
  }
}

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path, label) {
  if (!existsSync(path)) die(label + " missing: " + relative(ROOT, path));
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(label + " is invalid JSON: " + error.message);
  }
}

function requiredText(value, label, minLength = 1) {
  if (typeof value !== "string" || value.trim().length < minLength) {
    die(label + " must be a non-empty string" + (minLength > 1 ? " (>= " + minLength + " chars)" : "") + ".");
  }
}

function protectedImplementation(path) {
  const p = normalize(path);
  if (
    p === "docs/reuse-gate/current.json" ||
    p === "docs/reuse-gate/approval.json" ||
    p === "docs/reuse-gate/registry.json"
  ) {
    return false;
  }
  return (
    POLICY_FILES.has(p) ||
    p.startsWith(".githooks/") ||
    p.startsWith("src/") ||
    p.startsWith("public/") ||
    p.startsWith("scripts/") ||
    p === "package.json" ||
    p === "package-lock.json" ||
    p === "astro.config.mjs" ||
    p === "tsconfig.json"
  );
}

function isPolicyFile(path) {
  const p = normalize(path);
  return POLICY_FILES.has(p) || p.startsWith(".githooks/");
}

function matchPlanned(path, pattern) {
  const p = normalize(path);
  const q = normalize(pattern);
  if (q.endsWith("/**")) return p.startsWith(q.slice(0, -3));
  if (q.endsWith("/*")) {
    const prefix = q.slice(0, -2);
    if (!p.startsWith(prefix + "/")) return false;
    return !p.slice(prefix.length + 1).includes("/");
  }
  return p === q;
}

function validateRegistry(registry) {
  if (!registry || registry.schema !== 1) {
    die("reuse registry must use schema: 1.");
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    die("reuse registry must contain a non-empty entries array.");
  }

  const ids = new Set();
  for (const entry of registry.entries) {
    for (const key of ["id", "name", "url", "level", "license", "status", "last_checked"]) {
      requiredText(entry[key], "registry entry " + (entry.id || "<unknown>") + "." + key);
    }
    if (ids.has(entry.id)) die("duplicate registry id: " + entry.id);
    ids.add(entry.id);
    if (!/^https?:\/\//.test(entry.url)) {
      die("registry entry URL must be http(s): " + entry.id);
    }
    if (!SEARCH_LEVELS.includes(entry.level)) {
      die("registry entry has invalid level: " + entry.id + " -> " + entry.level);
    }
    if (!REGISTRY_STATUSES.includes(entry.status)) {
      die("registry entry has invalid status: " + entry.id + " -> " + entry.status);
    }
    if (!Array.isArray(entry.covers) || entry.covers.length === 0) {
      die("registry entry must list covered capabilities: " + entry.id);
    }
  }

  return new Map(registry.entries.map((entry) => [entry.id, entry]));
}

function validateEvaluation(candidate) {
  const evaluation = candidate.evaluation;
  if (!evaluation || typeof evaluation !== "object") {
    die("candidate missing evaluation object: " + candidate.id);
  }
  const fields = [
    "coverage",
    "integration_cost",
    "license_fit",
    "maintenance_health",
    "performance_fit",
    "customization_fit",
    "maturity",
  ];
  for (const field of fields) {
    const value = evaluation[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) {
      die("candidate evaluation." + field + " must be a number from 0..5: " + candidate.id);
    }
  }
}

function globalValue(candidate) {
  const e = candidate.evaluation;
  return (
    e.coverage * 4 +
    e.license_fit * 2 +
    e.maintenance_health * 2 +
    e.performance_fit +
    e.customization_fit * 2 +
    e.maturity -
    e.integration_cost * 3
  );
}

function validateRecord(record, registryIndex) {
  if (!record || record.schema !== 2) {
    die("research record must use schema: 2. See docs/reuse-gate/README.md.");
  }

  const required = [
    "task_id",
    "title",
    "scope",
    "researched_at",
    "research_summary",
    "planned_files",
    "sources",
    "search_ladder",
    "candidates",
    "decision",
  ];
  for (const key of required) {
    if (record[key] === undefined || record[key] === null || record[key] === "") {
      die("research record missing required field: " + key);
    }
  }

  requiredText(record.task_id, "task_id");
  requiredText(record.title, "title");
  requiredText(record.research_summary, "research_summary", 40);

  if (!record.scope || !SCOPE_LEVELS.includes(record.scope.level)) {
    die("scope.level must be architecture|subsystem|implementation.");
  }
  requiredText(record.scope.subject, "scope.subject");

  if (record.policy_change) {
    if (record.scope.level !== "architecture") {
      die("policy_change=true requires scope.level=architecture.");
    }
    const hasPolicyPath = record.planned_files?.some((path) => isPolicyFile(path));
    if (!hasPolicyPath) {
      die("policy_change=true must plan at least one protected policy file.");
    }
  }

  if (!Array.isArray(record.planned_files) || record.planned_files.length === 0) {
    die("planned_files must list exact files/patterns the task intends to change.");
  }

  if (!Array.isArray(record.sources) || record.sources.length < 2) {
    die("external research must include at least 2 sources.");
  }
  for (const [index, source] of record.sources.entries()) {
    if (!source.url || !/^https?:\/\//.test(source.url) || !source.finding) {
      die("source[" + index + "] needs {url, finding}; URL must be http(s).");
    }
  }

  if (!Array.isArray(record.search_ladder) || record.search_ladder.length !== SEARCH_LEVELS.length) {
    die("search_ladder must contain exactly: " + SEARCH_LEVELS.join(" -> ") + ".");
  }
  for (let index = 0; index < SEARCH_LEVELS.length; index += 1) {
    const step = record.search_ladder[index];
    const expected = SEARCH_LEVELS[index];
    if (!step || step.level !== expected) {
      die("search_ladder must be top-down; expected " + expected + " at index " + index + ".");
    }
    if (!SEARCH_STATUSES.includes(step.status)) {
      die("search_ladder " + expected + " status must be found|none|not_applicable.");
    }
    requiredText(step.conclusion, "search_ladder " + expected + ".conclusion", 20);

    const sourceRefs = Array.isArray(step.source_refs) ? step.source_refs : [];
    const registryRefs = Array.isArray(step.registry_refs) ? step.registry_refs : [];
    for (const sourceIndex of sourceRefs) {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= record.sources.length) {
        die("search_ladder " + expected + " has invalid source_refs index: " + sourceIndex);
      }
    }
    for (const registryId of registryRefs) {
      if (!registryIndex.has(registryId)) {
        die("search_ladder " + expected + " references unknown registry id: " + registryId);
      }
    }

    if (step.status === "found" && sourceRefs.length === 0 && registryRefs.length === 0) {
      die("search_ladder " + expected + " status=found needs source_refs and/or registry_refs.");
    }
    if (step.status === "none" && sourceRefs.length === 0) {
      die("search_ladder " + expected + " status=none needs at least one external source_ref proving the search.");
    }
    if (
      (record.scope.level === "architecture" || record.scope.level === "subsystem") &&
      (expected === "full_solution" || expected === "framework_engine") &&
      step.status === "not_applicable"
    ) {
      die(record.scope.level + " tasks may not skip " + expected + " research as not_applicable.");
    }
  }

  const minCandidates = record.scope.level === "implementation" ? 2 : 3;
  if (!Array.isArray(record.candidates) || record.candidates.length < minCandidates) {
    die(record.scope.level + " research must compare at least " + minCandidates + " candidates.");
  }

  const candidateIds = new Set();
  const candidatesById = new Map();
  for (const candidate of record.candidates) {
    for (const key of ["id", "name", "level", "registry_id", "source", "license", "decision", "reason"]) {
      requiredText(candidate[key], "candidate " + (candidate.id || "<unknown>") + "." + key);
    }
    if (candidateIds.has(candidate.id)) die("duplicate candidate id: " + candidate.id);
    candidateIds.add(candidate.id);
    candidatesById.set(candidate.id, candidate);

    if (!SEARCH_LEVELS.includes(candidate.level)) {
      die("candidate level must be one of " + SEARCH_LEVELS.join("|") + ": " + candidate.id);
    }
    if (!["reuse", "partial", "reject"].includes(candidate.decision)) {
      die("candidate decision must be reuse|partial|reject: " + candidate.id);
    }

    const registryEntry = registryIndex.get(candidate.registry_id);
    if (!registryEntry) {
      die("candidate references unknown registry_id: " + candidate.id + " -> " + candidate.registry_id);
    }
    if (registryEntry.status === "hold" && candidate.decision !== "reject") {
      die("registry candidate on HOLD cannot be selected/partially reused: " + candidate.registry_id);
    }

    validateEvaluation(candidate);
  }

  const reused = record.candidates.some((candidate) =>
    candidate.decision === "reuse" || candidate.decision === "partial"
  );
  if (!reused && !record.no_reuse_found) {
    die("at least one candidate must be reuse/partial, or set no_reuse_found=true with a reason.");
  }
  if (!reused) requiredText(record.no_reuse_reason, "no_reuse_reason", 20);

  if (record.scope.level !== "implementation") {
    if (!Array.isArray(record.coverage_matrix) || record.coverage_matrix.length < 2) {
      die("architecture/subsystem tasks require coverage_matrix with at least 2 capabilities.");
    }
    for (const row of record.coverage_matrix) {
      requiredText(row.capability, "coverage_matrix.capability");
      if (!IMPORTANCE.includes(row.importance)) {
        die("coverage_matrix importance must be high|medium|low: " + row.capability);
      }
      if (!row.coverage || typeof row.coverage !== "object") {
        die("coverage_matrix row missing coverage object: " + row.capability);
      }
      const coveredIds = Object.keys(row.coverage);
      if (coveredIds.length < 2) {
        die("coverage_matrix row must compare at least 2 candidates: " + row.capability);
      }
      for (const candidateId of coveredIds) {
        if (!candidateIds.has(candidateId)) {
          die("coverage_matrix references unknown candidate: " + candidateId);
        }
        if (!["full", "partial", "none"].includes(row.coverage[candidateId])) {
          die("coverage_matrix values must be full|partial|none: " + row.capability + " / " + candidateId);
        }
      }
      requiredText(row.decision, "coverage_matrix row decision", 20);
    }
  }

  const decision = record.decision;
  if (!["reuse", "partial", "new"].includes(decision.mode)) {
    die("decision.mode must be reuse|partial|new.");
  }
  requiredText(decision.rationale, "decision.rationale", 40);

  const selectedIds = Array.isArray(decision.selected_ids) ? decision.selected_ids : [];
  if (decision.mode !== "new" && selectedIds.length === 0) {
    die("decision.selected_ids must list the reused candidates.");
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    die("decision.selected_ids contains duplicates.");
  }
  for (const candidateId of selectedIds) {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) die("decision.selected_ids references unknown candidate: " + candidateId);
    if (candidate.decision === "reject") {
      die("decision cannot select a rejected candidate: " + candidateId);
    }
    const registryEntry = registryIndex.get(candidate.registry_id);
    if (registryEntry?.status === "hold") {
      die("decision cannot select a registry entry on HOLD: " + candidate.registry_id);
    }
  }

  if (selectedIds.length > 0) {
    const maxSelectedRank = Math.max(...selectedIds.map((id) => LEVEL_RANK.get(candidatesById.get(id).level)));
    const tradeoffs = new Map(
      (Array.isArray(decision.higher_level_tradeoffs) ? decision.higher_level_tradeoffs : [])
        .map((item) => [item.candidate_id, item])
    );

    for (const candidate of record.candidates) {
      const rank = LEVEL_RANK.get(candidate.level);
      if (rank > maxSelectedRank && !selectedIds.includes(candidate.id)) {
        const tradeoff = tradeoffs.get(candidate.id);
        if (!tradeoff) {
          die(
            "selected solution is lower-level than " + candidate.id +
            "; decision.higher_level_tradeoffs must explain why the broader candidate loses globally."
          );
        }
        requiredText(tradeoff.reason, "higher_level_tradeoffs[" + candidate.id + "].reason", 40);
      }
    }

    const selectedScore = Math.max(...selectedIds.map((id) => globalValue(candidatesById.get(id))));
    const scoreOverrides = new Map(
      (Array.isArray(decision.score_overrides) ? decision.score_overrides : [])
        .map((item) => [item.candidate_id, item])
    );
    for (const candidate of record.candidates) {
      if (candidate.decision !== "reject") continue;
      const score = globalValue(candidate);
      if (score >= selectedScore) {
        const override = scoreOverrides.get(candidate.id);
        if (!override) {
          die(
            "rejected candidate " + candidate.id + " has global value " + score +
            " >= selected best " + selectedScore +
            "; add decision.score_overrides with the global reason."
          );
        }
        requiredText(override.reason, "score_overrides[" + candidate.id + "].reason", 40);
      }
    }
  }

  return {
    candidatesById,
    selectedIds,
    scores: Object.fromEntries(
      record.candidates.map((candidate) => [candidate.id, globalValue(candidate)])
    ),
  };
}

function changedFiles(mode) {
  if (mode === "staged") {
    const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
    return out ? out.split(/\r?\n/).map(normalize) : [];
  }
  const tracked = git(["diff", "HEAD", "--name-only", "--diff-filter=ACMR"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(
    [tracked, untracked]
      .filter(Boolean)
      .flatMap((value) => value.split(/\r?\n/))
      .map(normalize)
      .filter(Boolean)
  )];
}

function loadValidated(recordPathArg) {
  const recordPath = resolve(ROOT, recordPathArg || relative(ROOT, DEFAULT_RECORD));
  const registry = readJson(REGISTRY_PATH, "reuse registry");
  const registryIndex = validateRegistry(registry);
  const record = readJson(recordPath, "research record");
  const validation = validateRecord(record, registryIndex);
  return { recordPath, record, registry, registryIndex, validation };
}

function printSummary(record, registryIndex, validation) {
  console.log("[REUSE-GATE] LINT PASS " + record.task_id);
  console.log("[REUSE-GATE] scope " + record.scope.level + " // " + record.scope.subject);
  console.log("[REUSE-GATE] search " + record.search_ladder.map((step) => step.level + ":" + step.status).join(" -> "));

  const rows = record.candidates
    .map((candidate) => ({
      id: candidate.id,
      level: candidate.level,
      status: registryIndex.get(candidate.registry_id)?.status,
      decision: candidate.decision,
      score: validation.scores[candidate.id],
      selected: validation.selectedIds.includes(candidate.id),
    }))
    .sort((a, b) => b.score - a.score);

  for (const row of rows) {
    console.log(
      "[REUSE-GATE] " +
      String(row.score).padStart(3, " ") +
      " " +
      (row.selected ? "*" : " ") +
      " " +
      row.level.padEnd(16, " ") +
      " " +
      row.decision.padEnd(7, " ") +
      " " +
      String(row.status).padEnd(6, " ") +
      " " +
      row.id
    );
  }
}

function lint(recordPathArg) {
  const { record, registryIndex, validation } = loadValidated(recordPathArg);
  printSummary(record, registryIndex, validation);
}

function approve(recordPathArg) {
  const { recordPath, record, registryIndex, validation } = loadValidated(recordPathArg);

  const dirtyImplementation = changedFiles("working").filter(protectedImplementation);
  if (dirtyImplementation.length > 0) {
    const policyUpgradeAllowed =
      record.policy_change === true &&
      record.scope.level === "architecture" &&
      dirtyImplementation.every(
        (path) =>
          isPolicyFile(path) &&
          record.planned_files.some((pattern) => matchPlanned(path, pattern))
      );

    if (!policyUpgradeAllowed) {
      die(
        "reuse research must be approved BEFORE implementation changes.\n" +
        "Protected files are already dirty:\n  - " +
        dirtyImplementation.join("\n  - ") +
        "\nRevert/stash them, approve the research, then implement. " +
        "Policy changes require scope.level=architecture and policy_change=true."
      );
    }
  }

  const approval = {
    schema: 2,
    task_id: record.task_id,
    approved_at: new Date().toISOString(),
    baseline_commit: git(["rev-parse", "HEAD"]),
    record_path: normalize(relative(ROOT, recordPath)),
    record_sha256: sha256(recordPath),
    registry_path: normalize(relative(ROOT, REGISTRY_PATH)),
    registry_sha256: sha256(REGISTRY_PATH),
    scope: record.scope,
    policy_change: record.policy_change === true,
    planned_files: record.planned_files,
    selected_ids: validation.selectedIds,
    candidate_scores: validation.scores,
  };

  writeFileSync(APPROVAL_PATH, JSON.stringify(approval, null, 2) + "\n", "utf8");
  console.log("[REUSE-GATE] APPROVED " + record.task_id);
  console.log("[REUSE-GATE] baseline " + approval.baseline_commit.slice(0, 12));
  console.log("[REUSE-GATE] registry " + approval.registry_sha256.slice(0, 12));
  console.log("[REUSE-GATE] implementation may begin.");
  printSummary(record, registryIndex, validation);
}

function check(mode) {
  const files = changedFiles(mode);
  const implementation = files.filter(protectedImplementation);
  if (implementation.length === 0) {
    console.log("[REUSE-GATE] PASS: no " + mode + " protected implementation changes.");
    return;
  }

  const approval = readJson(APPROVAL_PATH, "approval token");
  if (approval.schema !== 2) {
    die("approval token is from reuse-gate v1. Run reuse:approve with the v2 record before implementation.");
  }

  const recordPath = resolve(ROOT, approval.record_path || "");
  const record = readJson(recordPath, "approved research record");
  const registry = readJson(REGISTRY_PATH, "reuse registry");
  const registryIndex = validateRegistry(registry);
  const validation = validateRecord(record, registryIndex);

  if (approval.task_id !== record.task_id) {
    die("approval task_id does not match research record.");
  }
  if (approval.record_sha256 !== sha256(recordPath)) {
    die("research record changed after approval. Run reuse:approve again BEFORE implementation.");
  }
  if (approval.registry_sha256 !== sha256(REGISTRY_PATH)) {
    die("reuse registry changed after approval. Re-run research/approval before implementation.");
  }

  const head = git(["rev-parse", "HEAD"]);
  if (approval.baseline_commit !== head) {
    die(
      "approval was issued from baseline " + approval.baseline_commit.slice(0, 12) +
      ", but HEAD is " + head.slice(0, 12) + ". Start/approve a fresh implementation task."
    );
  }

  const uncovered = implementation.filter(
    (path) => !record.planned_files.some((pattern) => matchPlanned(path, pattern))
  );
  if (uncovered.length > 0) {
    die(
      "implementation changed files outside researched planned_files:\n  - " +
      uncovered.join("\n  - ")
    );
  }

  const policyChanges = implementation.filter(isPolicyFile);
  if (policyChanges.length > 0 && !(record.policy_change && record.scope.level === "architecture")) {
    die(
      "gate/policy files changed without an architecture-level policy_change approval:\n  - " +
      policyChanges.join("\n  - ")
    );
  }

  console.log(
    "[REUSE-GATE] PASS " +
    record.task_id +
    ": " +
    implementation.length +
    " protected file(s) covered; selected=" +
    validation.selectedIds.join(",")
  );
}

const args = process.argv.slice(2);
const command = args[0] || "check";
const arg = args[1];

if (command === "approve") approve(arg);
else if (command === "lint") lint(arg);
else if (command === "check") check(arg === "staged" ? "staged" : "working");
else {
  die(
    "usage: node scripts/reuse-gate.mjs " +
    "lint [record.json] | approve [record.json] | check [working|staged]"
  );
}
