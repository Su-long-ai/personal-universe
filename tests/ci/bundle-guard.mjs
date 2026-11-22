import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const MiB = 1024 * 1024;

if (!existsSync(DIST)) {
  console.error("[bundle-guard] dist/ is missing; run the production build first.");
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST).map((full) => ({
  path: relative(DIST, full).replaceAll("\\", "/"),
  bytes: statSync(full).size,
  ext: extname(full).toLowerCase(),
}));
const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);
const js = files.filter((file) => [".js", ".mjs"].includes(file.ext));
const css = files.filter((file) => file.ext === ".css");
const images = files.filter((file) =>
  [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"].includes(file.ext),
);
const stars = files.find((file) => file.path === "vendor/yeis/data/stars.bin");
const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
const largestJs = [...js].sort((a, b) => b.bytes - a.bytes)[0];

const metrics = {
  fileCount: files.length,
  distBytes: sum(files),
  jsBytes: sum(js),
  cssBytes: sum(css),
  imageBytes: sum(images),
  largestJsBytes: largestJs?.bytes ?? 0,
  largestJsPath: largestJs?.path ?? null,
  starsBinBytes: stars?.bytes ?? 0,
  largestAssets: largest.map(({ path, bytes }) => ({ path, bytes })),
};

const limits = {
  fileCount: 400,
  distBytes: 30 * MiB,
  jsBytes: 10 * MiB,
  cssBytes: 1.5 * MiB,
  imageBytes: 10 * MiB,
  largestJsBytes: 4.5 * MiB,
  starsBinBytes: 3 * MiB,
  anyAssetBytes: 8 * MiB,
};

const failures = [];
if (metrics.fileCount > limits.fileCount)
  failures.push(`file count ${metrics.fileCount} > ${limits.fileCount}`);
if (metrics.distBytes > limits.distBytes)
  failures.push(`dist ${metrics.distBytes} > ${limits.distBytes}`);
if (metrics.jsBytes > limits.jsBytes)
  failures.push(`JS total ${metrics.jsBytes} > ${limits.jsBytes}`);
if (metrics.cssBytes > limits.cssBytes)
  failures.push(`CSS total ${metrics.cssBytes} > ${limits.cssBytes}`);
if (metrics.imageBytes > limits.imageBytes)
  failures.push(`images ${metrics.imageBytes} > ${limits.imageBytes}`);
if (metrics.largestJsBytes > limits.largestJsBytes)
  failures.push(
    `largest JS ${metrics.largestJsPath} is ${metrics.largestJsBytes} bytes > ${limits.largestJsBytes}`,
  );
if (!stars)
  failures.push("vendor/yeis/data/stars.bin missing from dist");
else if (metrics.starsBinBytes > limits.starsBinBytes)
  failures.push(`stars.bin ${metrics.starsBinBytes} > ${limits.starsBinBytes}`);
for (const file of files) {
  if (file.bytes > limits.anyAssetBytes) {
    failures.push(`asset ${file.path} is ${file.bytes} bytes > ${limits.anyAssetBytes}`);
  }
}

const fmt = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;
const summary = [
  "## Bundle / asset regression guard",
  "",
  "| Metric | Current | Guard |",
  "| --- | ---: | ---: |",
  `| dist total | ${fmt(metrics.distBytes)} | ${fmt(limits.distBytes)} |`,
  `| JS total | ${fmt(metrics.jsBytes)} | ${fmt(limits.jsBytes)} |`,
  `| largest JS | ${fmt(metrics.largestJsBytes)} | ${fmt(limits.largestJsBytes)} |`,
  `| images | ${fmt(metrics.imageBytes)} | ${fmt(limits.imageBytes)} |`,
  `| stars.bin | ${fmt(metrics.starsBinBytes)} | ${fmt(limits.starsBinBytes)} |`,
  `| output files | ${metrics.fileCount} | ${limits.fileCount} |`,
  "",
  "Largest assets:",
  ...largest.map((file) => `- \`${file.path}\` — ${fmt(file.bytes)}`),
  "",
  failures.length === 0
    ? "Result: **PASS** — broad guards only; normal small bundle movement is allowed."
    : `Result: **FAIL** — ${failures.join("; ")}`,
  "",
].join("\n");

mkdirSync(join(ROOT, "ci-artifacts"), { recursive: true });
writeFileSync(
  join(ROOT, "ci-artifacts", "build-metrics.json"),
  JSON.stringify({ metrics, limits, failures }, null, 2) + "\n",
);
writeFileSync(join(ROOT, "ci-artifacts", "bundle-summary.md"), summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
console.log(summary);

if (failures.length > 0) process.exit(1);
