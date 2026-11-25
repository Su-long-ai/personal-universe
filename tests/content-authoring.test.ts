import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  authoringRecordToUniverseContentEntry,
  buildUniverseContentIndex,
  derivePersonalSignalMetadata,
  localizeUniverseContent,
  migrateContentRecord,
  normalizeImportedContentBatch,
  normalizeImportedContentRecord,
  resolveUniverseContentReference,
  universeContentSearchAliases,
  validateUniverseContentCatalog,
  validateUniverseContentDestinations,
  validateUniverseContentMediaPresence,
} from "../src/lib/universe/content/authoring.ts";
import { placementForContentReference } from "../src/lib/universe/content/placement.ts";
import type {
  UniverseContentEntry,
  UniverseContentPlacement,
} from "../src/lib/universe/content/types.ts";

function entry(
  overrides: Partial<UniverseContentEntry> = {},
): UniverseContentEntry {
  return {
    id: "alpha",
    title: "Alpha",
    summary: "Alpha summary",
    kind: "project",
    status: "active",
    importance: 3,
    tags: [],
    featured: false,
    placement: "auto",
    ...overrides,
  };
}

test("canonical ids survive filename/order/localization changes", () => {
  const before = [
    entry({ id: "stable-project", title: "Old title" }),
    entry({ id: "other", title: "Other" }),
  ];
  const after = [
    entry({ id: "other", title: "Other" }),
    entry({
      id: "stable-project",
      title: "Renamed title",
      i18n: { zh: { title: "重命名" } },
    }),
  ];

  assert.equal(
    resolveUniverseContentReference(before, "personal:stable-project")?.id,
    "stable-project",
  );
  assert.equal(
    resolveUniverseContentReference(after, "personal:stable-project")?.id,
    "stable-project",
  );
  assert.deepEqual(
    buildUniverseContentIndex(before).ids.sort(),
    buildUniverseContentIndex(after).ids.sort(),
  );
});

test("duplicate ids and legacy references are rejected", () => {
  const issues = validateUniverseContentCatalog([
    entry({ id: "alpha" }),
    entry({ id: "beta", legacyIds: ["alpha"] }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "duplicate_reference"));
});

test("two records cannot claim the same canonical ID", () => {
  const original = entry({ id: "stable" });
  const duplicate = entry({ id: "stable", title: "A second source" });
  assert.ok(
    validateUniverseContentCatalog([original, duplicate]).some(
      (issue) => issue.code === "duplicate_reference" && issue.path === "id",
    ),
  );
});

test("content CLI rejects filename-independent identity collisions before writes", () => {
  const root = mkdtempSync(join(tmpdir(), "universe-content-id-"));
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    for (const path of [
      "scripts/content-author.mjs",
      "src/lib/universe/content/authoring.ts",
    ]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(new URL("../" + path, import.meta.url), target);
    }
    const portfolio = join(root, "src", "content", "portfolio");
    mkdirSync(portfolio, { recursive: true });
    const record = {
      contentId: "stable",
      title: "Stable",
      summary: "Stable project",
      kind: "project",
      legacyIds: ["former-id"],
    };
    const movedFile = "renamed-source.json";
    writeFileSync(join(portfolio, movedFile), JSON.stringify(record));
    writeFileSync(
      join(root, "batch.json"),
      JSON.stringify([{ ...record, contentId: "fresh", legacyIds: [] }, record]),
    );

    const run = (...args: string[]) => spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/content-author.mjs", ...args],
      { cwd: root, encoding: "utf8" },
    );
    const rejects = (message: RegExp, ...args: string[]) => {
      const result = run(...args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
      assert.deepEqual(readdirSync(portfolio), [movedFile]);
    };

    assert.equal(run("validate").status, 0);
    for (const flags of [[], ["--dry-run"]]) {
      rejects(
        /Content reference "stable" is already owned/,
        "import", "batch.json", ...flags,
      );
    }
    rejects(
      /Content reference "former-id" is already owned/,
      "new", "--id", "former-id", "--title", "Former",
      "--summary", "Former project", "--kind", "project",
    );
    writeFileSync(join(portfolio, "second-source.json"), JSON.stringify(record));
    const validation = run("validate");
    assert.equal(validation.status, 1);
    assert.match(validation.stderr, /Content reference "stable" is already owned/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("bilingual copy falls back without duplicating identity", () => {
  const value = entry({
    id: "bilingual",
    title: "English title",
    summary: "English summary",
    i18n: { zh: { title: "中文标题" } },
  });
  assert.deepEqual(localizeUniverseContent(value, "zh"), {
    title: "中文标题",
    summary: "English summary",
  });
  assert.equal(value.id, "bilingual");
});

test("explicit aliases cannot become ambiguous across content", () => {
  const issues = validateUniverseContentCatalog([
    entry({ id: "alpha", aliases: { en: ["shared"] } }),
    entry({ id: "beta", aliases: { zh: ["Shared"] } }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "ambiguous_alias"));
});

test("broken relations fail before product data is emitted", () => {
  const issues = validateUniverseContentCatalog([
    entry({
      id: "alpha",
      relations: [{ type: "related", targetId: "missing" }],
    }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "broken_relation"));
});

test("legacy ids resolve old deep-link identities", () => {
  const value = entry({ id: "new-id", legacyIds: ["old-id"] });
  assert.equal(
    resolveUniverseContentReference([value], "personal:old-id")?.id,
    "new-id",
  );
});

test("placement lookup canonicalizes legacy Personal deep-link ids", () => {
  const canonical = entry({
    id: "current-id",
    legacyIds: ["old-id"],
  });
  const placement: UniverseContentPlacement = {
    entry: canonical,
    markerId: "marker-1",
    nativeId: "c1",
    planetSlotSeed: 1,
  };

  assert.equal(
    placementForContentReference([placement], "personal:current-id")?.entry.id,
    "current-id",
  );
  assert.equal(
    placementForContentReference([placement], "personal:old-id")?.entry.id,
    "current-id",
  );
  assert.equal(
    placementForContentReference([placement], "personal:missing"),
    undefined,
  );
});

test("schema v0 records migrate deterministically", () => {
  const legacy = {
    id: "legacy-project",
    title: "Legacy",
    summary: "Legacy summary",
    kind: "project",
    placement: "auto",
  };
  assert.deepEqual(migrateContentRecord(legacy), {
    title: "Legacy",
    summary: "Legacy summary",
    kind: "project",
    placement: "auto",
    contentId: "legacy-project",
    schemaVersion: 1,
  });
  assert.equal(
    normalizeImportedContentRecord(legacy).contentId,
    "legacy-project",
  );
});

test("imports reject unknown fields rather than silently dropping them", () => {
  assert.throws(
    () =>
      normalizeImportedContentRecord({
        schemaVersion: 1,
        contentId: "bad",
        title: "Bad",
        summary: "Bad",
        kind: "project",
        unexpected: true,
      }),
    /unknown field/,
  );
});

test("batch import normalizes deterministically and preserves import provenance", () => {
  const batch = normalizeImportedContentBatch(
    [
      {
        schemaVersion: 1,
        contentId: "z-item",
        title: "Z",
        summary: "Z summary",
        kind: "note",
      },
      {
        schemaVersion: 1,
        contentId: "a-item",
        title: "A",
        summary: "A summary",
        kind: "project",
      },
    ],
    { source: "import:fixture.json" },
  );
  assert.deepEqual(
    batch.map((item) => item.contentId),
    ["a-item", "z-item"],
  );
  assert.deepEqual(batch[0]?.provenance, {
    kind: "authored",
    source: "import:fixture.json",
  });
  assert.throws(
    () =>
      normalizeImportedContentBatch([
        {
          contentId: "same",
          title: "One",
          summary: "One",
          kind: "note",
        },
        {
          contentId: "same",
          title: "Two",
          summary: "Two",
          kind: "note",
        },
      ]),
    /duplicate contentId/,
  );
  assert.throws(
    () =>
      normalizeImportedContentBatch({
        items: [],
        unexpectedEnvelopeField: true,
      }),
    /batch envelope contains unknown field/,
  );
});

test("authoring normalization rejects invalid URLs", () => {
  assert.throws(
    () =>
      normalizeImportedContentRecord({
        contentId: "bad-link",
        title: "Bad link",
        summary: "Bad link",
        kind: "note",
        links: [{ label: "bad", url: "not-a-url" }],
      }),
    /absolute URL/,
  );
});

test("media type and existence validation is actionable", () => {
  const value = entry({
    id: "with-media",
    media: [
      {
        src: "/content/missing.exe",
        alt: "missing",
        kind: "image",
      },
    ],
  });
  const catalogIssues = validateUniverseContentCatalog([value]);
  assert.ok(
    catalogIssues.some((issue) => issue.code === "unsupported_media_type"),
  );
  const presenceIssues = validateUniverseContentMediaPresence(
    [value],
    () => false,
  );
  assert.deepEqual(
    presenceIssues.map((issue) => issue.code),
    ["missing_media_asset"],
  );
});

test("pinned destinations are checked against canonical markers", () => {
  const pinned = entry({
    id: "pinned",
    placement: "pinned",
    starId: "c1",
  });
  assert.equal(
    validateUniverseContentDestinations(
      [pinned],
      [
        {
          id: "marker-c1",
          nativeId: "c1",
          name: "C1",
          position: [0, 0, 0],
          seed: "c1",
          source: "catalog",
          engine: "yeis",
        },
      ],
    ).length,
    0,
  );
  assert.ok(
    validateUniverseContentDestinations([pinned], []).some(
      (issue) => issue.code === "unknown_destination",
    ),
  );
  assert.equal(
    validateUniverseContentDestinations(
      [pinned],
      [],
      (starId) => starId === "c1",
    ).length,
    0,
  );
});

test("Personal Signal metadata is derived from canonical content", () => {
  const value = entry({
    id: "signal",
    title: "Signal",
    summary: "Signal summary",
    placement: "pinned",
    starId: "c59669",
    featured: true,
    importance: 5,
    aliases: { zh: ["信号"] },
    surface: { anchorCategory: "project", cluster: "core" },
    provenance: { kind: "authored" },
  });
  const signal = derivePersonalSignalMetadata(value, "en");
  assert.equal(signal.id, "personal:signal");
  assert.equal(signal.destinationId, "star:c59669");
  assert.equal(signal.surface?.cluster, "core");
  assert.deepEqual(signal.aliases, ["Signal", "信号"]);
});

test("Personal destination search aliases combine authored copy with existing tags", () => {
  const value = entry({
    title: "Signal",
    tags: ["engineering", "Shared"],
    i18n: { zh: { title: "项目标题" } },
    aliases: { en: ["Shared", "Project Beacon"], zh: ["项目信号"] },
  });

  const result = universeContentSearchAliases(value);
  assert.deepEqual(result.slice(0, 2), ["engineering", "Shared"]);
  assert.deepEqual(
    [...result].sort(),
    ["engineering", "Shared", "Signal", "Project Beacon", "项目标题", "项目信号"].sort(),
  );
  assert.deepEqual(value.tags, ["engineering", "Shared"]);
});

test("derived indexes are deterministic across input ordering", () => {
  const a = entry({ id: "a", aliases: { en: ["Alpha"] } });
  const b = entry({ id: "b", aliases: { en: ["Beta"] } });
  assert.deepEqual(
    buildUniverseContentIndex([a, b]),
    buildUniverseContentIndex([b, a]),
  );
});

test("normalized records become runtime entries with stable ids", () => {
  const runtime = authoringRecordToUniverseContentEntry({
    schemaVersion: 1,
    contentId: "runtime-entry",
    title: "Runtime",
    summary: "Runtime summary",
    kind: "artifact",
    placement: "auto",
  });
  assert.equal(runtime.id, "runtime-entry");
  assert.equal(runtime.provenance?.kind, "authored");
  assert.equal(runtime.signalVisible, true);
});

test("large catalogs validate in linear-time practice", () => {
  const catalog = Array.from({ length: 5000 }, (_, index) =>
    entry({
      id: "item-" + index,
      title: "Item " + index,
      aliases: { en: ["alias-" + index] },
      relations:
        index === 0
          ? []
          : [{ type: "related", targetId: "item-" + (index - 1) }],
    }),
  );
  const started = performance.now();
  const issues = validateUniverseContentCatalog(catalog);
  const elapsed = performance.now() - started;
  assert.equal(issues.length, 0);
  assert.ok(elapsed < 1500, "5000-entry validation took " + elapsed + "ms");
});
