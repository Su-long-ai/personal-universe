import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authoringRecordToUniverseContentEntry,
  buildUniverseContentIndex,
  derivePersonalSignalMetadata,
  migrateContentRecord,
  normalizeImportedContentRecord,
  resolveUniverseContentReference,
  validateUniverseContentCatalog,
} from "../src/lib/universe/content/authoring.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = resolve(ROOT, "src/content/portfolio");
const PUBLIC_DIR = resolve(ROOT, "public");

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = new Map();
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const key = token.slice(2, equal >= 0 ? equal : undefined);
    let value = equal >= 0 ? token.slice(equal + 1) : true;
    if (
      equal < 0 &&
      index + 1 < argv.length &&
      !argv[index + 1].startsWith("--")
    ) {
      value = argv[++index];
    }
    const current = options.get(key);
    if (current === undefined) options.set(key, value);
    else if (Array.isArray(current)) current.push(value);
    else options.set(key, [current, value]);
  }
  return { options, positionals };
}

function option(args, name) {
  const value = args.options.get(name);
  return Array.isArray(value) ? value.at(-1) : value;
}

function optionStrings(args, name) {
  const value = args.options.get(name);
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function hasFlag(args, name) {
  return args.options.has(name);
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (typeof value !== "string" || !value.trim()) {
    fail("--" + name + " is required.");
  }
  return value.trim();
}

function slugFragment(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "content";
}

function generatedContentId(title) {
  return slugFragment(title) + "-" + randomUUID().slice(0, 8);
}

function contentPath(contentId) {
  return resolve(CONTENT_DIR, contentId + ".json");
}

function writeRecord(record, dryRun = false) {
  const target = contentPath(record.contentId);
  if (existsSync(target)) {
    fail('Content file already exists for "' + record.contentId + '": ' + target);
  }
  const text = JSON.stringify(record, null, 2) + "\n";
  if (!dryRun) {
    mkdirSync(CONTENT_DIR, { recursive: true });
    writeFileSync(target, text, "utf8");
  }
  return { target, text };
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function readJson(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(path + ": invalid JSON: " + error.message);
  }
  return value;
}

function loadJsonContentRecords() {
  const entries = [];
  const sources = new Map();
  const failures = [];
  const files = walkFiles(CONTENT_DIR);
  for (const path of files) {
    if (extname(path).toLowerCase() !== ".json") continue;
    try {
      const entry = authoringRecordToUniverseContentEntry(readJson(path));
      entries.push(entry);
      sources.set(entry.id, path);
    } catch (error) {
      failures.push(path + ": " + error.message);
    }
  }
  return { entries, sources, failures, files };
}

function mediaFailures(entries, sources) {
  const failures = [];
  for (const entry of entries) {
    for (const media of entry.media ?? []) {
      if (!media.src.startsWith("/")) continue;
      const clean = decodeURIComponent(media.src.split(/[?#]/, 1)[0]);
      const target = resolve(PUBLIC_DIR, "." + clean);
      const publicPrefix = PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep;
      if (target !== PUBLIC_DIR && !target.startsWith(publicPrefix)) {
        failures.push(
          (sources.get(entry.id) ?? entry.id) +
            ': media path escapes public/: "' +
            media.src +
            '".',
        );
        continue;
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        failures.push(
          (sources.get(entry.id) ?? entry.id) +
            ': media asset does not exist: "' +
            media.src +
            '".',
        );
      }
    }
  }
  return failures;
}

function allValidationFailures() {
  const { entries, sources, failures, files } = loadJsonContentRecords();
  for (const issue of validateUniverseContentCatalog(entries)) {
    failures.push(
      (issue.entryId ? sources.get(issue.entryId) ?? issue.entryId : "catalog") +
        ": " +
        issue.message,
    );
  }
  failures.push(...mediaFailures(entries, sources));

  const nonJson = files.filter((path) =>
    [".md", ".mdx"].includes(extname(path).toLowerCase()),
  );
  return { entries, failures, nonJson };
}

function commandNew(args) {
  const title = requiredOption(args, "title");
  const summary = requiredOption(args, "summary");
  const contentId =
    typeof option(args, "id") === "string"
      ? String(option(args, "id")).trim()
      : generatedContentId(title);
  const placement =
    typeof option(args, "placement") === "string"
      ? String(option(args, "placement"))
      : option(args, "star")
        ? "pinned"
        : "auto";

  const record = normalizeImportedContentRecord({
    schemaVersion: 1,
    contentId,
    title,
    summary,
    i18n:
      option(args, "title-zh") || option(args, "summary-zh")
        ? {
            zh: {
              ...(option(args, "title-zh")
                ? { title: String(option(args, "title-zh")) }
                : {}),
              ...(option(args, "summary-zh")
                ? { summary: String(option(args, "summary-zh")) }
                : {}),
            },
          }
        : {},
    aliases: { en: [], zh: [] },
    kind: requiredOption(args, "kind"),
    status: "active",
    importance: 3,
    tags: optionStrings(args, "tag"),
    featured: false,
    signalVisible: true,
    placement,
    ...(placement === "pinned"
      ? { starId: requiredOption(args, "star") }
      : {}),
    links: [],
    media: [],
    provenance: { kind: "authored" },
    relations: [],
    journeys: [],
    legacyIds: [],
    draft: hasFlag(args, "draft"),
  });

  const { target, text } = writeRecord(record, hasFlag(args, "dry-run"));
  process.stdout.write(
    (hasFlag(args, "dry-run") ? "[dry-run] " : "") +
      "created " +
      target +
      "\n" +
      text,
  );
}

function importItems(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return value.items;
  }
  return [value];
}

function commandImport(args) {
  const sourceArg = args.positionals[0];
  if (!sourceArg) fail("content:import requires a JSON file path.");
  const source = resolve(process.cwd(), sourceArg);
  const normalized = importItems(readJson(source)).map((item, index) => {
    try {
      return normalizeImportedContentRecord(item);
    } catch (error) {
      fail(source + " item " + index + ": " + error.message);
    }
  });

  const ids = new Set();
  for (const record of normalized) {
    if (ids.has(record.contentId)) {
      fail(source + ': duplicate contentId "' + record.contentId + '".');
    }
    ids.add(record.contentId);
    if (existsSync(contentPath(record.contentId))) {
      fail(
        source +
          ': destination already exists for contentId "' +
          record.contentId +
          '".',
      );
    }
  }

  const dryRun = hasFlag(args, "dry-run");
  for (const record of normalized.sort((a, b) =>
    String(a.contentId).localeCompare(String(b.contentId)),
  )) {
    const { target } = writeRecord(record, dryRun);
    process.stdout.write((dryRun ? "[dry-run] " : "") + "imported " + target + "\n");
  }
  process.stdout.write("normalized " + normalized.length + " content item(s).\n");
}

function commandMigrate(args) {
  const sourceArg = args.positionals[0];
  if (!sourceArg) fail("content:migrate requires one JSON file path.");
  const source = resolve(process.cwd(), sourceArg);
  const migrated = normalizeImportedContentRecord(
    migrateContentRecord(readJson(source)),
  );
  const text = JSON.stringify(migrated, null, 2) + "\n";
  if (hasFlag(args, "write")) {
    writeFileSync(source, text, "utf8");
    process.stdout.write("migrated " + source + "\n");
  } else {
    process.stdout.write(text);
  }
}

function commandValidate() {
  const { entries, failures, nonJson } = allValidationFailures();
  if (failures.length > 0) {
    fail(
      "Personal content validation failed:\n" +
        failures.map((failure) => "- " + failure).join("\n"),
    );
  }
  process.stdout.write(
    "[CONTENT] valid " +
      entries.length +
      " JSON item(s)" +
      (nonJson.length
        ? "; " +
          nonJson.length +
          " Markdown/MDX item(s) remain covered by Astro collection/build validation"
        : "") +
      ".\n",
  );
}

function commandPreview(args) {
  const reference =
    typeof option(args, "id") === "string"
      ? String(option(args, "id"))
      : args.positionals[0];
  if (!reference) fail("content:preview requires --id <content-id>.");
  const { entries, failures } = allValidationFailures();
  if (failures.length > 0) {
    fail(
      "Cannot preview an invalid content catalog:\n" +
        failures.map((failure) => "- " + failure).join("\n"),
    );
  }
  const entry = resolveUniverseContentReference(entries, reference);
  if (!entry) fail('Unknown content reference "' + reference + '".');

  const signal = derivePersonalSignalMetadata(entry, "en");
  const query = new URLSearchParams({
    destination: "personal:" + entry.id,
  }).toString();
  process.stdout.write(
    JSON.stringify(
      {
        canonicalId: entry.id,
        legacyIds: entry.legacyIds ?? [],
        sharePath: "?" + query,
        placement: {
          mode: entry.placement,
          placementKey: entry.placementKey ?? entry.id,
          starId: entry.starId ?? null,
        },
        discovery: {
          title: signal.title,
          summary: signal.summary,
          aliases: signal.aliases,
          importance: signal.importance,
          featured: signal.featured,
        },
        personalSignal: signal,
        surface: entry.surface ?? null,
        provenance: entry.provenance ?? { kind: "authored" },
      },
      null,
      2,
    ) + "\n",
  );
}

function commandIndex() {
  const { entries, failures } = allValidationFailures();
  if (failures.length > 0) {
    fail(
      "Cannot derive index from invalid content:\n" +
        failures.map((failure) => "- " + failure).join("\n"),
    );
  }
  process.stdout.write(
    JSON.stringify(buildUniverseContentIndex(entries), null, 2) + "\n",
  );
}

function usage() {
  process.stdout.write(`Personal Universe content authoring

Commands:
  new --title <text> --summary <text> --kind <kind> [--id <stable-id>]
      [--title-zh <text>] [--summary-zh <text>] [--tag <tag>]...
      [--placement auto|hero|pinned] [--star <native-id>] [--draft] [--dry-run]
  import <batch.json> [--dry-run]
  migrate <record.json> [--write]
  validate
  preview --id <canonical-or-legacy-id>
  index

The canonical identity is the persisted contentId, never the filename or title.
`);
}

try {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case "new":
      commandNew(args);
      break;
    case "import":
      commandImport(args);
      break;
    case "migrate":
      commandMigrate(args);
      break;
    case "validate":
      commandValidate();
      break;
    case "preview":
      commandPreview(args);
      break;
    case "index":
      commandIndex(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      fail('Unknown command "' + command + '". Run with --help.');
  }
} catch (error) {
  process.stderr.write("[CONTENT] " + error.message + "\n");
  process.exitCode = 1;
}
