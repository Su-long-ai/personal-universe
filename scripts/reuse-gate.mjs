import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = process.cwd();
const APPROVAL_PATH = resolve(ROOT, "docs/reuse-gate/approval.json");
const DEFAULT_RECORD = resolve(ROOT, "docs/reuse-gate/current.json");

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

function protectedImplementation(path) {
  const p = normalize(path);
  if (p === "scripts/reuse-gate.mjs") return false;
  return (
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

function validateRecord(record) {
  const required = ["task_id", "title", "researched_at", "research_summary", "planned_files", "sources", "candidates", "decision"];
  for (const key of required) {
    if (record[key] === undefined || record[key] === null || record[key] === "") {
      die("research record missing required field: " + key);
    }
  }
  if (!Array.isArray(record.planned_files) || record.planned_files.length === 0) {
    die("planned_files must list the exact files/patterns the task intends to change.");
  }
  if (!Array.isArray(record.sources) || record.sources.length < 2) {
    die("external research must include at least 2 source URLs.");
  }
  for (const source of record.sources) {
    if (!source.url || !/^https?:\/\//.test(source.url) || !source.finding) {
      die("each source needs {url, finding}; URL must be http(s).");
    }
  }
  if (!Array.isArray(record.candidates) || record.candidates.length < 2) {
    die("research must compare at least 2 reuse candidates/approaches.");
  }
  for (const candidate of record.candidates) {
    for (const key of ["name", "source", "license", "decision", "reason"]) {
      if (!candidate[key]) die("candidate missing " + key);
    }
    if (!["reuse", "partial", "reject"].includes(candidate.decision)) {
      die("candidate decision must be reuse|partial|reject: " + candidate.name);
    }
  }
  const reused = record.candidates.some((x) => x.decision === "reuse" || x.decision === "partial");
  if (!reused && !record.no_reuse_found) {
    die("at least one candidate must be reuse/partial, or set no_reuse_found=true with a reason.");
  }
  if (!reused && !record.no_reuse_reason) {
    die("no_reuse_found requires no_reuse_reason.");
  }
  if (!record.decision.mode || !["reuse", "partial", "new"].includes(record.decision.mode)) {
    die("decision.mode must be reuse|partial|new.");
  }
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
      .flatMap((x) => x.split(/\r?\n/))
      .map(normalize)
      .filter(Boolean)
  )];
}

function approve(recordPathArg) {
  const recordPath = resolve(ROOT, recordPathArg || relative(ROOT, DEFAULT_RECORD));
  const record = readJson(recordPath, "research record");
  validateRecord(record);

  const dirtyImplementation = changedFiles("working").filter(protectedImplementation);
  if (dirtyImplementation.length > 0) {
    die(
      "reuse research must be approved BEFORE implementation changes.\n" +
      "Implementation files are already dirty:\n  - " +
      dirtyImplementation.join("\n  - ") +
      "\nRevert/stash them, approve the research, then implement."
    );
  }

  const approval = {
    schema: 1,
    task_id: record.task_id,
    approved_at: new Date().toISOString(),
    baseline_commit: git(["rev-parse", "HEAD"]),
    record_path: normalize(relative(ROOT, recordPath)),
    record_sha256: sha256(recordPath),
    planned_files: record.planned_files
  };

  writeFileSync(APPROVAL_PATH, JSON.stringify(approval, null, 2) + "\n", "utf8");
  console.log("[REUSE-GATE] APPROVED " + record.task_id);
  console.log("[REUSE-GATE] baseline " + approval.baseline_commit.slice(0, 12));
  console.log("[REUSE-GATE] implementation may begin.");
}

function check(mode) {
  const files = changedFiles(mode);
  const implementation = files.filter(protectedImplementation);
  if (implementation.length === 0) {
    console.log("[REUSE-GATE] PASS: no " + mode + " implementation changes.");
    return;
  }

  const approval = readJson(APPROVAL_PATH, "approval token");
  const recordPath = resolve(ROOT, approval.record_path || "");
  const record = readJson(recordPath, "approved research record");
  validateRecord(record);

  if (approval.task_id !== record.task_id) die("approval task_id does not match research record.");
  if (approval.record_sha256 !== sha256(recordPath)) {
    die("research record changed after approval. Run reuse:approve again BEFORE implementation.");
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

  console.log("[REUSE-GATE] PASS " + record.task_id + ": " + implementation.length + " implementation file(s) covered.");
}

const args = process.argv.slice(2);
const command = args[0] || "check";
const arg = args[1];
if (command === "approve") approve(arg);
else if (command === "check") check(arg === "staged" ? "staged" : "working");
else die("usage: node scripts/reuse-gate.mjs approve [record.json] | check [working|staged]");
