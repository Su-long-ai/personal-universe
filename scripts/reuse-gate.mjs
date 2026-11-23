import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = process.cwd();
const LEGACY_APPROVAL_PATH = resolve(ROOT, "docs/reuse-gate/approval.json");
const APPROVAL_DIR = resolve(ROOT, "docs/reuse-gate/approvals");
const TASK_DIR = resolve(ROOT, "docs/reuse-gate/tasks");
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

function gitRaw(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    die("git " + args.join(" ") + " failed: " + error.message);
  }
}

function gitBytes(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT });
  } catch (error) {
    die("git " + args.join(" ") + " failed: " + error.message);
  }
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sha256GitPath(ref, path) {
  const rel = normalize(relative(ROOT, path));
  return createHash("sha256").update(gitBytes(["show", ref + ":" + rel])).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function safeTaskFileName(taskId) {
  requiredText(taskId, "task_id");
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) {
    die("task_id may contain only letters, digits, dot, underscore and hyphen.");
  }
  return taskId + ".json";
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

function isGateMetadata(path) {
  const p = normalize(path);
  return (
    p === "docs/reuse-gate/current.json" ||
    p === "docs/reuse-gate/approval.json" ||
    p === "docs/reuse-gate/registry.json" ||
    p.startsWith("docs/reuse-gate/tasks/") ||
    p.startsWith("docs/reuse-gate/approvals/")
  );
}

function isPolicyFile(path) {
  const p = normalize(path);
  return (
    POLICY_FILES.has(p) ||
    p.startsWith(".githooks/") ||
    p.startsWith(".github/workflows/") ||
    p.startsWith(".github/actions/")
  );
}

function protectedImplementation(path) {
  const p = normalize(path);
  if (isGateMetadata(p)) return false;
  return (
    isPolicyFile(p) ||
    p.startsWith("src/") ||
    p.startsWith("public/") ||
    p.startsWith("scripts/") ||
    p === "package.json" ||
    p === "package-lock.json" ||
    p === "astro.config.mjs" ||
    p === "tsconfig.json"
  );
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
    for (const key of ["id", "name", "level", "source", "license", "decision", "reason"]) {
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

    if (candidate.decision !== "reject") {
      requiredText(candidate.registry_id, "candidate " + candidate.id + ".registry_id");
    }
    if (candidate.registry_id) {
      const registryEntry = registryIndex.get(candidate.registry_id);
      if (!registryEntry) {
        die("candidate references unknown registry_id: " + candidate.id + " -> " + candidate.registry_id);
      }
      if (registryEntry.status === "hold" && candidate.decision !== "reject") {
        die("registry candidate on HOLD cannot be selected/partially reused: " + candidate.registry_id);
      }
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

function effectiveRangeBase(baseArg, head) {
  let base = baseArg || "";
  if (!base || /^0+$/.test(base)) {
    base = gitOk(["rev-parse", head + "^"]) ? git(["rev-parse", head + "^"]) : git(["rev-list", "--max-parents=0", head]);
  }
  if (gitOk(["merge-base", "--is-ancestor", base, head])) return base;
  const mergeBase = git(["merge-base", base, head]);
  if (!mergeBase) die("cannot determine merge-base for " + base.slice(0, 12) + " and " + head.slice(0, 12) + ".");
  return mergeBase;
}

function changedFiles(mode, baseArg, headArg) {
  if (mode === "staged") {
    const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
    return out ? out.split(/\r?\n/).map(normalize) : [];
  }

  if (mode === "range" || mode === "ci") {
    const head = headArg || process.env.REUSE_GATE_HEAD_SHA || "HEAD";
    const base = effectiveRangeBase(baseArg || process.env.REUSE_GATE_BASE_SHA || "", head);
    const out = git(["diff", "--name-only", "--diff-filter=ACMR", base + "..." + head]);
    return out ? out.split(/\r?\n/).map(normalize).filter(Boolean) : [];
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

function referencedRegistryIds(record) {
  const ids = new Set();
  for (const candidate of record.candidates || []) {
    if (candidate.registry_id) ids.add(candidate.registry_id);
  }
  for (const step of record.search_ladder || []) {
    for (const id of step.registry_refs || []) ids.add(id);
  }
  return [...ids].sort();
}

function registryEntryHashes(record, registryIndex) {
  return Object.fromEntries(
    referencedRegistryIds(record).map((id) => {
      const entry = registryIndex.get(id);
      if (!entry) die("approval references missing registry entry: " + id);
      return [id, sha256Text(JSON.stringify(entry))];
    })
  );
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
    die(
      "reuse research must be approved BEFORE implementation changes.\n" +
      "Protected files are already dirty:\n  - " +
      dirtyImplementation.join("\n  - ") +
      "\nRevert/stash them, approve the research, commit the task + approval metadata, then implement."
    );
  }

  const approval = {
    schema: 3,
    task_id: record.task_id,
    approved_at: new Date().toISOString(),
    baseline_commit: git(["rev-parse", "HEAD"]),
    record_path: normalize(relative(ROOT, recordPath)),
    record_sha256: sha256GitPath("HEAD", recordPath),
    registry_path: normalize(relative(ROOT, REGISTRY_PATH)),
    registry_entry_hashes: registryEntryHashes(record, registryIndex),
    scope: record.scope,
    policy_change: record.policy_change === true,
    planned_files: record.planned_files,
    selected_ids: validation.selectedIds,
    candidate_scores: validation.scores,
  };

  mkdirSync(APPROVAL_DIR, { recursive: true });
  const approvalPath = resolve(APPROVAL_DIR, safeTaskFileName(record.task_id));
  writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n", "utf8");
  console.log("[REUSE-GATE] APPROVED " + record.task_id);
  console.log("[REUSE-GATE] baseline " + approval.baseline_commit.slice(0, 12));
  console.log("[REUSE-GATE] token " + normalize(relative(ROOT, approvalPath)));
  console.log("[REUSE-GATE] commit the task/approval metadata BEFORE protected implementation.");
  printSummary(record, registryIndex, validation);
}

function approvalSources() {
  const paths = [];
  if (existsSync(APPROVAL_DIR)) {
    for (const name of readdirSync(APPROVAL_DIR).filter((name) => name.endsWith(".json")).sort()) {
      paths.push(resolve(APPROVAL_DIR, name));
    }
  }
  if (existsSync(LEGACY_APPROVAL_PATH)) paths.push(LEGACY_APPROVAL_PATH);
  return paths;
}

class ApprovalTokenValidationError extends Error {}

function rejectApproval(message) {
  throw new ApprovalTokenValidationError(message);
}

function validateApprovalToken(approvalPath, registry, registryIndex, head) {
  const approval = readJson(approvalPath, "approval token");
  if (approval.schema !== 2 && approval.schema !== 3) {
    rejectApproval("approval token must use schema 2 or 3: " + normalize(relative(ROOT, approvalPath)));
  }

  const recordPath = resolve(ROOT, approval.record_path || "");
  const record = readJson(recordPath, "approved research record");
  const validation = validateRecord(record, registryIndex);

  if (approval.task_id !== record.task_id) {
    rejectApproval("approval task_id does not match research record: " + approval.task_id);
  }
  if (approval.record_sha256 !== sha256GitPath(head, recordPath)) {
    rejectApproval("research record changed after approval: " + approval.task_id);
  }
  if (!gitOk(["merge-base", "--is-ancestor", approval.baseline_commit, head])) {
    rejectApproval("approval baseline is not an ancestor of HEAD: " + approval.task_id);
  }

  const tokenCommit = approvalCommit(head, approvalPath);
  if (!tokenCommit) {
    rejectApproval("approval token is not committed in Git history: " + approval.task_id);
  }

  if (approval.schema === 2) {
    if (approval.registry_sha256 !== sha256GitPath(head, REGISTRY_PATH)) {
      const tokenRegistry = JSON.parse(
        gitRaw(["show", tokenCommit + ":" + normalize(relative(ROOT, REGISTRY_PATH))])
      );
      const tokenIndex = validateRegistry(tokenRegistry);
      const actual = registryEntryHashes(record, registryIndex);
      const tokenHashes = registryEntryHashes(record, tokenIndex);
      for (const id of Object.keys(actual)) {
        if (tokenHashes[id] !== actual[id]) {
          rejectApproval("legacy approval referenced registry entry changed after approval: " + approval.task_id + " -> " + id);
        }
      }
    }
  } else {
    if (!gitOk(["merge-base", "--is-ancestor", approval.baseline_commit, tokenCommit])) {
      rejectApproval("schema-3 approval token precedes its declared baseline: " + approval.task_id);
    }

    const tokenRecord = gitRaw(["show", tokenCommit + ":" + normalize(approval.record_path)]);
    if (sha256Text(tokenRecord) !== approval.record_sha256) {
      rejectApproval("approved research record was not frozen in the approval metadata commit: " + approval.task_id);
    }

    const expected = approval.registry_entry_hashes || {};
    const actual = registryEntryHashes(record, registryIndex);
    for (const id of Object.keys(actual)) {
      if (expected[id] !== actual[id]) {
        rejectApproval("registry entry changed after approval: " + approval.task_id + " -> " + id);
      }
    }

    const tokenRegistry = JSON.parse(
      gitRaw(["show", tokenCommit + ":" + normalize(relative(ROOT, REGISTRY_PATH))])
    );
    const tokenIndex = validateRegistry(tokenRegistry);
    const tokenHashes = registryEntryHashes(record, tokenIndex);
    for (const id of Object.keys(actual)) {
      if (tokenHashes[id] !== expected[id]) {
        rejectApproval("registry entry was not frozen in the approval metadata commit: " + approval.task_id + " -> " + id);
      }
    }
  }

  if (JSON.stringify(approval.planned_files) !== JSON.stringify(record.planned_files)) {
    rejectApproval("approval planned_files do not match research record: " + approval.task_id);
  }
  if (JSON.stringify(approval.selected_ids) !== JSON.stringify(validation.selectedIds)) {
    rejectApproval("approval selected_ids do not match research record: " + approval.task_id);
  }
  if (JSON.stringify(approval.scope) !== JSON.stringify(record.scope)) {
    rejectApproval("approval scope does not match research record: " + approval.task_id);
  }
  if (Boolean(approval.policy_change) !== Boolean(record.policy_change)) {
    rejectApproval("approval policy_change does not match research record: " + approval.task_id);
  }
  for (const [id, score] of Object.entries(validation.scores)) {
    if (approval.candidate_scores?.[id] !== score) {
      rejectApproval("approval candidate score does not match research record: " + approval.task_id + " -> " + id);
    }
  }

  return {
    approvalPath,
    approval,
    record,
    validation,
  };
}

function firstChangeCommit(base, head, path) {
  const out = git(["log", "--reverse", "--format=%H", base + ".." + head, "--", path]);
  return out ? out.split(/\r?\n/)[0] : null;
}

function approvalCommit(head, path) {
  const rel = normalize(relative(ROOT, path));
  const out = git(["log", "-1", "--format=%H", head, "--", rel]);
  return out || null;
}

function check(mode, baseArg, headArg) {
  const files = changedFiles(mode, baseArg, headArg);
  const implementation = files.filter(protectedImplementation);
  if (implementation.length === 0) {
    console.log("[REUSE-GATE] PASS: no " + mode + " protected implementation changes.");
    return;
  }

  const head = headArg || process.env.REUSE_GATE_HEAD_SHA || git(["rev-parse", "HEAD"]);
  let rangeBase = baseArg || process.env.REUSE_GATE_BASE_SHA || "";
  if (mode === "range" || mode === "ci") {
    rangeBase = effectiveRangeBase(rangeBase, head);
  }

  const registry = readJson(REGISTRY_PATH, "reuse registry");
  const registryIndex = validateRegistry(registry);
  const relevantApprovalPaths = approvalSources().filter((path) => {
    const token = readJson(path, "approval token");
    const planned = Array.isArray(token.planned_files) ? token.planned_files : [];
    return implementation.some((file) => planned.some((pattern) => matchPlanned(file, pattern)));
  });
  const approvals = [];
  const rejectedApprovals = [];
  for (const path of relevantApprovalPaths) {
    try {
      approvals.push(validateApprovalToken(path, registry, registryIndex, head));
    } catch (error) {
      if (!(error instanceof ApprovalTokenValidationError)) throw error;
      rejectedApprovals.push({
        path: normalize(relative(ROOT, path)),
        reason: error.message,
      });
    }
  }
  if (approvals.length === 0) {
    const details = rejectedApprovals.length
      ? "\nRejected candidate approvals:\n  - " +
        rejectedApprovals.map(({ path, reason }) => path + ": " + reason).join("\n  - ")
      : "";
    die("protected implementation changed but no valid relevant reuse approval tokens exist." + details);
  }

  const uncovered = [];
  const coverage = new Map();

  for (const path of implementation) {
    const candidates = approvals.filter(({ record }) => {
      if (!record.planned_files.some((pattern) => matchPlanned(path, pattern))) return false;
      if (isPolicyFile(path) && !(record.policy_change && record.scope.level === "architecture")) return false;
      return true;
    });

    const valid = candidates.filter(({ approvalPath, approval }) => {
      if (mode !== "range" && mode !== "ci") return true;
      if (approval.schema < 3) return true;
      const changedAt = firstChangeCommit(rangeBase, head, path);
      if (!changedAt) return false;
      const approvedAt = approvalCommit(head, approvalPath);
      if (!approvedAt || approvedAt === changedAt) return false;
      return gitOk(["merge-base", "--is-ancestor", approvedAt, changedAt]);
    });

    if (valid.length === 0) {
      uncovered.push(path);
    } else {
      coverage.set(path, valid.map(({ record }) => record.task_id));
    }
  }

  if (uncovered.length > 0) {
    die(
      "protected changes are not covered by a prior machine approval:\n  - " +
      uncovered.join("\n  - ") +
      "\nFor schema-3 tasks, commit task + approval metadata in an earlier commit before implementation."
    );
  }

  for (const { path, reason } of rejectedApprovals) {
    console.warn("[REUSE-GATE] IGNORE invalid approval candidate " + path + ": " + reason);
  }

  const taskIds = [...new Set([...coverage.values()].flat())].sort();
  console.log(
    "[REUSE-GATE] PASS " +
    implementation.length +
    " protected file(s) covered by " +
    taskIds.length +
    " task approval(s): " +
    taskIds.join(",")
  );
  for (const [path, ids] of coverage) {
    console.log("[REUSE-GATE] COVER " + path + " <- " + ids.join(","));
  }
}

const args = process.argv.slice(2);
const command = args[0] || "check";
const arg = args[1];

if (command === "approve") approve(arg);
else if (command === "lint") lint(arg);
else if (command === "check") {
  const mode = ["working", "staged", "range", "ci"].includes(arg) ? arg : "working";
  check(mode, args[2], args[3]);
} else {
  die(
    "usage: node scripts/reuse-gate.mjs " +
    "lint [record.json] | approve [record.json] | check [working|staged|range <base> [head]|ci]"
  );
}
