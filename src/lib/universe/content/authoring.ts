import type { GalaxyMarker } from "../types";
import type {
  UniverseContentEntry,
  UniverseContentKind,
  UniverseContentLocale,
  UniverseContentLocalizedCopy,
  UniverseContentMedia,
  UniverseContentPlacementMode,
  UniverseContentProvenance,
  UniverseContentRelation,
  UniverseContentStatus,
} from "./types";

export const CURRENT_CONTENT_SCHEMA_VERSION = 1;
export const CONTENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const CONTENT_AUTHORING_FIELDS = [
  "schemaVersion",
  "contentId",
  "title",
  "summary",
  "body",
  "i18n",
  "aliases",
  "kind",
  "status",
  "dateStart",
  "dateEnd",
  "importance",
  "tags",
  "featured",
  "signalVisible",
  "placement",
  "placementKey",
  "starId",
  "href",
  "links",
  "media",
  "surface",
  "provenance",
  "relations",
  "journeys",
  "legacyIds",
  "draft",
] as const;

const CONTENT_KINDS = new Set<UniverseContentKind>([
  "project",
  "experience",
  "research",
  "artifact",
  "note",
]);
const CONTENT_STATUSES = new Set<UniverseContentStatus>([
  "active",
  "complete",
  "archived",
]);
const CONTENT_PLACEMENTS = new Set<UniverseContentPlacementMode>([
  "auto",
  "hero",
  "pinned",
]);

export interface UniverseContentValidationIssue {
  code: string;
  message: string;
  entryId?: string;
  path?: string;
}

export interface UniverseContentIndex {
  ids: string[];
  references: Record<string, string>;
  aliases: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " must be a non-empty string.");
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return nonEmptyString(value, field);
}

function absoluteUrl(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  try {
    new URL(text);
  } catch {
    throw new Error(field + " must be an absolute URL.");
  }
  return text;
}

function httpUrl(value: unknown, field: string): string {
  const text = absoluteUrl(value, field);
  const protocol = new URL(text).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(field + " must use http(s).");
  }
  return text;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(field + " must be an array.");
  return value.map((item, index) =>
    nonEmptyString(item, field + "[" + index + "]"),
  );
}

function booleanValue(
  value: unknown,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(field + " must be boolean.");
  return value;
}

function integerValue(
  value: unknown,
  fallback: number,
  field: string,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(
      field + " must be an integer from " + min + " through " + max + ".",
    );
  }
  return Number(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      field + " contains unknown field(s): " + unknown.join(", ") + ".",
    );
  }
}

function normalizeLocaleBlock(
  value: unknown,
  field: string,
): UniverseContentLocalizedCopy | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(field + " must be an object.");
  rejectUnknownKeys(value, ["title", "summary", "body"], field);
  const title = optionalString(value.title, field + ".title");
  const summary = optionalString(value.summary, field + ".summary");
  const body = optionalString(value.body, field + ".body");
  if (!title && !summary && !body) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(body ? { body } : {}),
  };
}

function normalizeI18n(
  value: unknown,
): Partial<Record<UniverseContentLocale, UniverseContentLocalizedCopy>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("i18n must be an object.");
  rejectUnknownKeys(value, ["en", "zh"], "i18n");
  const en = normalizeLocaleBlock(value.en, "i18n.en");
  const zh = normalizeLocaleBlock(value.zh, "i18n.zh");
  return {
    ...(en ? { en } : {}),
    ...(zh ? { zh } : {}),
  };
}

function normalizeAliases(
  value: unknown,
): Partial<Record<UniverseContentLocale, string[]>> {
  if (value === undefined) return { en: [], zh: [] };
  if (!isRecord(value)) throw new Error("aliases must be an object.");
  rejectUnknownKeys(value, ["en", "zh"], "aliases");
  return {
    en: stringArray(value.en, "aliases.en"),
    zh: stringArray(value.zh, "aliases.zh"),
  };
}

function normalizeProvenance(value: unknown): UniverseContentProvenance {
  if (value === undefined) return { kind: "authored" };
  if (!isRecord(value)) throw new Error("provenance must be an object.");
  rejectUnknownKeys(value, ["kind", "source"], "provenance");
  const kind = nonEmptyString(value.kind ?? "authored", "provenance.kind");
  if (!["authored", "generated", "observed"].includes(kind)) {
    throw new Error("provenance.kind is invalid: " + kind);
  }
  const source = optionalString(value.source, "provenance.source");
  if (kind !== "authored" && !source) {
    throw new Error("generated/observed provenance requires provenance.source.");
  }
  return {
    kind: kind as UniverseContentProvenance["kind"],
    ...(source ? { source } : {}),
  };
}

function normalizeRelations(value: unknown): UniverseContentRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("relations must be an array.");
  return value.map((item, index) => {
    const field = "relations[" + index + "]";
    if (!isRecord(item)) throw new Error(field + " must be an object.");
    rejectUnknownKeys(item, ["type", "targetId"], field);
    const type = nonEmptyString(item.type, field + ".type");
    if (!["contains", "related", "continues", "belongs-to"].includes(type)) {
      throw new Error(field + ".type is invalid: " + type);
    }
    const targetId = nonEmptyString(item.targetId, field + ".targetId");
    if (!CONTENT_ID_PATTERN.test(targetId)) {
      throw new Error(field + ".targetId is not a valid content id.");
    }
    return {
      type: type as UniverseContentRelation["type"],
      targetId,
    };
  });
}

function normalizeMedia(value: unknown): UniverseContentMedia[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("media must be an array.");
  return value.map((item, index) => {
    const field = "media[" + index + "]";
    if (!isRecord(item)) throw new Error(field + " must be an object.");
    rejectUnknownKeys(item, ["src", "alt", "kind", "width", "height"], field);
    const rawSrc = nonEmptyString(item.src, field + ".src");
    const src = rawSrc.startsWith("/")
      ? rawSrc
      : httpUrl(rawSrc, field + ".src");
    const alt = nonEmptyString(item.alt, field + ".alt");
    const kind = nonEmptyString(item.kind ?? "image", field + ".kind");
    if (!["image", "video", "audio", "document"].includes(kind)) {
      throw new Error(field + ".kind is invalid: " + kind);
    }
    const width =
      item.width === undefined
        ? undefined
        : integerValue(item.width, 1, field + ".width", 1, 100000);
    const height =
      item.height === undefined
        ? undefined
        : integerValue(item.height, 1, field + ".height", 1, 100000);
    return {
      src,
      alt,
      kind: kind as UniverseContentMedia["kind"],
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    };
  });
}

function normalizeLinks(
  value: unknown,
): Array<{ label: string; url: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("links must be an array.");
  return value.map((item, index) => {
    const field = "links[" + index + "]";
    if (!isRecord(item)) throw new Error(field + " must be an object.");
    rejectUnknownKeys(item, ["label", "url"], field);
    return {
      label: nonEmptyString(item.label, field + ".label"),
      url: absoluteUrl(item.url, field + ".url"),
    };
  });
}

function normalizeSurface(
  value: unknown,
): UniverseContentEntry["surface"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("surface must be an object.");
  rejectUnknownKeys(
    value,
    ["preferredRegion", "anchorCategory", "cluster", "order", "featured"],
    "surface",
  );
  const preferredRegion = optionalString(
    value.preferredRegion,
    "surface.preferredRegion",
  );
  const anchorCategory = optionalString(
    value.anchorCategory,
    "surface.anchorCategory",
  );
  if (
    anchorCategory &&
    ![
      "project",
      "milestone",
      "artifact",
      "experience",
      "research",
      "note",
      "archive",
    ].includes(anchorCategory)
  ) {
    throw new Error("surface.anchorCategory is invalid: " + anchorCategory);
  }
  const cluster = optionalString(value.cluster, "surface.cluster");
  const order =
    value.order === undefined
      ? undefined
      : integerValue(value.order, 0, "surface.order", 0, 1000000);
  const featured =
    value.featured === undefined
      ? undefined
      : booleanValue(value.featured, false, "surface.featured");
  return {
    ...(preferredRegion ? { preferredRegion } : {}),
    ...(anchorCategory
      ? {
          anchorCategory:
            anchorCategory as NonNullable<
              UniverseContentEntry["surface"]
            >["anchorCategory"],
        }
      : {}),
    ...(cluster ? { cluster } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(featured !== undefined ? { featured } : {}),
  };
}

export function migrateContentRecord(
  input: unknown,
): Record<string, unknown> {
  if (!isRecord(input)) throw new Error("Content record must be an object.");
  const version =
    input.schemaVersion === undefined ? 0 : Number(input.schemaVersion);
  if (version === CURRENT_CONTENT_SCHEMA_VERSION) {
    return { ...input, schemaVersion: CURRENT_CONTENT_SCHEMA_VERSION };
  }
  if (version !== 0) {
    throw new Error(
      "Unsupported content schemaVersion " +
        String(input.schemaVersion) +
        "; current version is " +
        CURRENT_CONTENT_SCHEMA_VERSION +
        ".",
    );
  }

  const migrated: Record<string, unknown> = { ...input };
  if (migrated.contentId === undefined && typeof migrated.id === "string") {
    migrated.contentId = migrated.id;
  }
  delete migrated.id;
  migrated.schemaVersion = CURRENT_CONTENT_SCHEMA_VERSION;
  return migrated;
}

export function normalizeImportedContentRecord(
  input: unknown,
): Record<string, unknown> {
  const migrated = migrateContentRecord(input);
  rejectUnknownKeys(
    migrated,
    CONTENT_AUTHORING_FIELDS as unknown as readonly string[],
    "content record",
  );

  const contentId = nonEmptyString(migrated.contentId, "contentId");
  if (!CONTENT_ID_PATTERN.test(contentId)) {
    throw new Error(
      "contentId must use lowercase letters, digits, dot, underscore, or hyphen.",
    );
  }
  const title = nonEmptyString(migrated.title, "title");
  const summary = nonEmptyString(migrated.summary, "summary");
  const body = optionalString(migrated.body, "body");
  const kind = nonEmptyString(migrated.kind, "kind");
  if (!CONTENT_KINDS.has(kind as UniverseContentKind)) {
    throw new Error("kind is invalid: " + kind);
  }
  const status = nonEmptyString(migrated.status ?? "active", "status");
  if (!CONTENT_STATUSES.has(status as UniverseContentStatus)) {
    throw new Error("status is invalid: " + status);
  }
  const placement = nonEmptyString(migrated.placement ?? "auto", "placement");
  if (!CONTENT_PLACEMENTS.has(placement as UniverseContentPlacementMode)) {
    throw new Error("placement is invalid: " + placement);
  }
  const starId = optionalString(migrated.starId, "starId");
  if (placement === "pinned" && !starId) {
    throw new Error('starId is required when placement is "pinned".');
  }
  if (placement !== "pinned" && starId) {
    throw new Error('starId is only valid when placement is "pinned".');
  }
  const dateStart = optionalString(migrated.dateStart, "dateStart");
  const dateEnd = optionalString(migrated.dateEnd, "dateEnd");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (dateStart && !datePattern.test(dateStart)) {
    throw new Error("dateStart must use YYYY-MM-DD.");
  }
  if (dateEnd && !datePattern.test(dateEnd)) {
    throw new Error("dateEnd must use YYYY-MM-DD.");
  }
  if (dateStart && dateEnd && dateEnd < dateStart) {
    throw new Error("dateEnd must not be earlier than dateStart.");
  }

  const i18n = normalizeI18n(migrated.i18n);
  const aliases = normalizeAliases(migrated.aliases);
  const legacyIds = stringArray(migrated.legacyIds, "legacyIds");
  if (legacyIds.includes(contentId)) {
    throw new Error("legacyIds must not repeat contentId.");
  }
  for (const legacyId of legacyIds) {
    if (!CONTENT_ID_PATTERN.test(legacyId)) {
      throw new Error("legacyIds contains invalid content id: " + legacyId);
    }
  }

  const placementKey = optionalString(migrated.placementKey, "placementKey");
  const href =
    migrated.href === undefined ? undefined : absoluteUrl(migrated.href, "href");
  const surface = normalizeSurface(migrated.surface);

  return {
    schemaVersion: CURRENT_CONTENT_SCHEMA_VERSION,
    contentId,
    title,
    summary,
    ...(body ? { body } : {}),
    i18n,
    aliases,
    kind,
    status,
    ...(dateStart ? { dateStart } : {}),
    ...(dateEnd ? { dateEnd } : {}),
    importance: integerValue(migrated.importance, 3, "importance", 1, 5),
    tags: stringArray(migrated.tags, "tags"),
    featured: booleanValue(migrated.featured, false, "featured"),
    signalVisible: booleanValue(
      migrated.signalVisible,
      true,
      "signalVisible",
    ),
    placement,
    ...(placementKey ? { placementKey } : {}),
    ...(starId ? { starId } : {}),
    ...(href ? { href } : {}),
    links: normalizeLinks(migrated.links),
    media: normalizeMedia(migrated.media),
    ...(surface ? { surface } : {}),
    provenance: normalizeProvenance(migrated.provenance),
    relations: normalizeRelations(migrated.relations),
    journeys: stringArray(migrated.journeys, "journeys"),
    legacyIds,
    draft: booleanValue(migrated.draft, false, "draft"),
  };
}

export function normalizeImportedContentBatch(
  input: unknown,
  options: { source?: string } = {},
): Record<string, unknown>[] {
  let items: unknown[];
  if (Array.isArray(input)) {
    items = input;
  } else if (isRecord(input) && Array.isArray(input.items)) {
    rejectUnknownKeys(input, ["items"], "batch envelope");
    items = input.items;
  } else {
    items = [input];
  }

  const normalized = items.map((item, index) => {
    try {
      const withSource =
        options.source &&
        isRecord(item) &&
        item.provenance === undefined
          ? {
              ...item,
              provenance: { kind: "authored", source: options.source },
            }
          : item;
      return normalizeImportedContentRecord(withSource);
    } catch (error) {
      throw new Error(
        "batch item " +
          index +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  });

  const seen = new Set<string>();
  for (const record of normalized) {
    const id = record.contentId as string;
    if (seen.has(id)) {
      throw new Error('batch contains duplicate contentId "' + id + '".');
    }
    seen.add(id);
  }

  return normalized.sort((left, right) =>
    String(left.contentId).localeCompare(String(right.contentId)),
  );
}

export function authoringRecordToUniverseContentEntry(
  input: unknown,
): UniverseContentEntry {
  const record = normalizeImportedContentRecord(input);
  return {
    id: record.contentId as string,
    schemaVersion: record.schemaVersion as number,
    title: record.title as string,
    summary: record.summary as string,
    ...(record.body ? { body: record.body as string } : {}),
    i18n: record.i18n as UniverseContentEntry["i18n"],
    aliases: record.aliases as UniverseContentEntry["aliases"],
    kind: record.kind as UniverseContentKind,
    status: record.status as UniverseContentStatus,
    ...(record.dateStart ? { dateStart: record.dateStart as string } : {}),
    ...(record.dateEnd ? { dateEnd: record.dateEnd as string } : {}),
    importance: record.importance as number,
    tags: record.tags as string[],
    featured: record.featured as boolean,
    signalVisible: record.signalVisible as boolean,
    placement: record.placement as UniverseContentPlacementMode,
    ...(record.placementKey
      ? { placementKey: record.placementKey as string }
      : {}),
    ...(record.starId ? { starId: record.starId as string } : {}),
    ...(record.href ? { href: record.href as string } : {}),
    links: record.links as UniverseContentEntry["links"],
    media: record.media as UniverseContentEntry["media"],
    ...(record.surface
      ? { surface: record.surface as UniverseContentEntry["surface"] }
      : {}),
    provenance: record.provenance as UniverseContentEntry["provenance"],
    relations: record.relations as UniverseContentEntry["relations"],
    journeys: record.journeys as string[],
    legacyIds: record.legacyIds as string[],
  };
}

export function localizeUniverseContent(
  entry: UniverseContentEntry,
  locale: UniverseContentLocale,
): Required<Pick<UniverseContentEntry, "title" | "summary">> & {
  body?: string;
} {
  const requested = entry.i18n?.[locale];
  const english = entry.i18n?.en;
  return {
    title: requested?.title ?? english?.title ?? entry.title,
    summary: requested?.summary ?? english?.summary ?? entry.summary,
    ...(requested?.body ?? english?.body ?? entry.body
      ? { body: requested?.body ?? english?.body ?? entry.body }
      : {}),
  };
}

export function universeContentAliases(
  entry: UniverseContentEntry,
): string[] {
  const aliases = [
    entry.title,
    entry.i18n?.en?.title,
    entry.i18n?.zh?.title,
    ...(entry.aliases?.en ?? []),
    ...(entry.aliases?.zh ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(aliases.map((value) => value.trim()))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function universeContentSearchAliases(
  entry: UniverseContentEntry,
): string[] {
  return [...new Set([...entry.tags, ...universeContentAliases(entry)])];
}

export function universeContentReferenceIds(
  entry: UniverseContentEntry,
): string[] {
  return [entry.id, ...(entry.legacyIds ?? [])];
}

export function resolveUniverseContentReference(
  entries: readonly UniverseContentEntry[],
  reference: string,
): UniverseContentEntry | undefined {
  const normalized = reference.startsWith("personal:")
    ? reference.slice("personal:".length)
    : reference;
  return entries.find((entry) =>
    universeContentReferenceIds(entry).includes(normalized),
  );
}

export function derivePersonalSignalMetadata(
  entry: UniverseContentEntry,
  locale: UniverseContentLocale = "en",
) {
  const copy = localizeUniverseContent(entry, locale);
  return {
    id: "personal:" + entry.id,
    canonicalContentId: entry.id,
    title: copy.title,
    summary: copy.summary,
    aliases: universeContentAliases(entry),
    importance: entry.importance,
    featured: entry.featured,
    visible: entry.signalVisible !== false,
    destinationId:
      entry.placement === "pinned" && entry.starId
        ? "star:" + entry.starId
        : entry.placement === "hero"
          ? "hero"
          : null,
    surface: entry.surface ?? null,
    provenance: entry.provenance?.kind ?? "authored",
  };
}

function normalizedAlias(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

const LOCAL_MEDIA_EXTENSIONS: Record<
  UniverseContentMedia["kind"],
  ReadonlySet<string>
> = {
  image: new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]),
  video: new Set(["m4v", "mp4", "webm"]),
  audio: new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]),
  document: new Set(["csv", "json", "md", "pdf", "txt", "zip"]),
};

function mediaPathExtension(src: string): string {
  const clean = src.split(/[?#]/, 1)[0] ?? src;
  const slash = clean.lastIndexOf("/");
  const dot = clean.lastIndexOf(".");
  return dot > slash ? clean.slice(dot + 1).toLowerCase() : "";
}

export function validateUniverseContentMediaPresence(
  entries: readonly UniverseContentEntry[],
  assetExists: (publicPath: string) => boolean,
): UniverseContentValidationIssue[] {
  const issues: UniverseContentValidationIssue[] = [];
  for (const entry of entries) {
    for (const [index, media] of (entry.media ?? []).entries()) {
      if (!media.src.startsWith("/")) continue;
      if (!assetExists(media.src)) {
        issues.push({
          code: "missing_media_asset",
          entryId: entry.id,
          path: "media[" + index + "].src",
          message: 'Local media asset does not exist: "' + media.src + '".',
        });
      }
    }
  }
  return issues;
}

export function validateUniverseContentCatalog(
  entries: readonly UniverseContentEntry[],
): UniverseContentValidationIssue[] {
  const issues: UniverseContentValidationIssue[] = [];
  const referenceOwner = new Map<string, string>();
  const aliasOwner = new Map<string, string>();

  for (const entry of entries) {
    if (!CONTENT_ID_PATTERN.test(entry.id)) {
      issues.push({
        code: "invalid_id",
        entryId: entry.id,
        path: "id",
        message: "Invalid canonical content id: " + entry.id,
      });
    }

    for (const reference of universeContentReferenceIds(entry)) {
      const previous = referenceOwner.get(reference);
      if (previous && previous !== entry.id) {
        issues.push({
          code: "duplicate_reference",
          entryId: entry.id,
          path: "legacyIds",
          message:
            'Content reference "' +
            reference +
            '" is already owned by "' +
            previous +
            '".',
        });
      } else {
        referenceOwner.set(reference, entry.id);
      }
    }

    for (const alias of [
      ...(entry.aliases?.en ?? []),
      ...(entry.aliases?.zh ?? []),
    ]) {
      const key = normalizedAlias(alias);
      if (!key) continue;
      const previous = aliasOwner.get(key);
      if (previous && previous !== entry.id) {
        issues.push({
          code: "ambiguous_alias",
          entryId: entry.id,
          path: "aliases",
          message:
            'Discovery alias "' +
            alias +
            '" is ambiguous between "' +
            previous +
            '" and "' +
            entry.id +
            '".',
        });
      } else {
        aliasOwner.set(key, entry.id);
      }
    }

    if (entry.dateStart && entry.dateEnd && entry.dateEnd < entry.dateStart) {
      issues.push({
        code: "invalid_date_range",
        entryId: entry.id,
        path: "dateEnd",
        message: "dateEnd must not be earlier than dateStart.",
      });
    }

    if (
      entry.provenance &&
      entry.provenance.kind !== "authored" &&
      !entry.provenance.source
    ) {
      issues.push({
        code: "invalid_provenance",
        entryId: entry.id,
        path: "provenance.source",
        message: "generated/observed provenance requires a source.",
      });
    }

    const entryMedia = new Set<string>();
    for (const [index, media] of (entry.media ?? []).entries()) {
      if (!media.alt.trim()) {
        issues.push({
          code: "missing_media_alt",
          entryId: entry.id,
          path: "media[" + index + "].alt",
          message: "Media alt text must not be empty.",
        });
      }

      const extension = mediaPathExtension(media.src);
      if (
        media.src.startsWith("/") &&
        (!extension || !LOCAL_MEDIA_EXTENSIONS[media.kind].has(extension))
      ) {
        issues.push({
          code: "unsupported_media_type",
          entryId: entry.id,
          path: "media[" + index + "].src",
          message:
            'Local media "' +
            media.src +
            '" is not a supported ' +
            media.kind +
            " asset.",
        });
      }

      if (entryMedia.has(media.src)) {
        issues.push({
          code: "duplicate_media_reference",
          entryId: entry.id,
          path: "media[" + index + "].src",
          message: 'Media "' + media.src + '" is repeated in the same item.',
        });
      }
      entryMedia.add(media.src);

      if (
        media.kind === "image" &&
        ((media.width === undefined) !== (media.height === undefined))
      ) {
        issues.push({
          code: "incomplete_media_dimensions",
          entryId: entry.id,
          path: "media[" + index + "]",
          message: "Image width and height must be supplied together.",
        });
      }
    }
  }

  for (const entry of entries) {
    for (const relation of entry.relations ?? []) {
      if (!referenceOwner.has(relation.targetId)) {
        issues.push({
          code: "broken_relation",
          entryId: entry.id,
          path: "relations",
          message:
            'Relation target "' +
            relation.targetId +
            '" does not resolve to canonical content.',
        });
      }
    }
  }

  return issues.sort(
    (a, b) =>
      (a.entryId ?? "").localeCompare(b.entryId ?? "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
}

export function validateUniverseContentDestinations(
  entries: readonly UniverseContentEntry[],
  markers: readonly GalaxyMarker[],
  nativeStarExists: (starId: string) => boolean = () => false,
): UniverseContentValidationIssue[] {
  const markerIds = new Set<string>();
  for (const marker of markers) {
    markerIds.add(marker.id);
    if (marker.nativeId) markerIds.add(marker.nativeId);
  }

  const issues: UniverseContentValidationIssue[] = [];
  for (const entry of entries) {
    if (
      entry.placement === "pinned" &&
      (!entry.starId ||
        (!markerIds.has(entry.starId) && !nativeStarExists(entry.starId)))
    ) {
      issues.push({
        code: "unknown_destination",
        entryId: entry.id,
        path: "starId",
        message:
          'Pinned destination "' +
          String(entry.starId ?? "") +
          '" is not present in the canonical galaxy marker set.',
      });
    }
  }
  return issues;
}

export function assertUniverseContentCatalog(
  entries: readonly UniverseContentEntry[],
  markers?: readonly GalaxyMarker[],
  nativeStarExists?: (starId: string) => boolean,
): void {
  const issues = [
    ...validateUniverseContentCatalog(entries),
    ...(markers
      ? validateUniverseContentDestinations(
          entries,
          markers,
          nativeStarExists,
        )
      : []),
  ];
  if (issues.length === 0) return;
  throw new Error(
    "Personal content validation failed:\n" +
      issues
        .map(
          (issue) =>
            "- " +
            (issue.entryId ? issue.entryId + ": " : "") +
            issue.message,
        )
        .join("\n"),
  );
}

export function buildUniverseContentIndex(
  entries: readonly UniverseContentEntry[],
): UniverseContentIndex {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const references: Record<string, string> = {};
  const aliases: Record<string, string> = {};

  for (const entry of sorted) {
    for (const reference of universeContentReferenceIds(entry).sort()) {
      references[reference] = entry.id;
    }
    for (const alias of [
      ...(entry.aliases?.en ?? []),
      ...(entry.aliases?.zh ?? []),
    ].sort()) {
      aliases[normalizedAlias(alias)] = entry.id;
    }
  }

  return {
    ids: sorted.map((entry) => entry.id),
    references: Object.fromEntries(
      Object.entries(references).sort(([a], [b]) => a.localeCompare(b)),
    ),
    aliases: Object.fromEntries(
      Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
