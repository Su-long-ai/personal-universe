export type UniverseContentKind =
  | "project"
  | "experience"
  | "research"
  | "artifact"
  | "note";

export type UniverseContentStatus = "active" | "complete" | "archived";
export type UniverseContentPlacementMode = "auto" | "hero" | "pinned";
export type UniverseContentLocale = "en" | "zh";
export type UniverseContentProvenanceKind =
  | "authored"
  | "generated"
  | "observed";
export type UniverseContentRelationType =
  | "contains"
  | "related"
  | "continues"
  | "belongs-to";
export type UniverseContentMediaKind =
  | "image"
  | "video"
  | "audio"
  | "document";

export interface UniverseContentLocalizedCopy {
  title?: string;
  summary?: string;
  body?: string;
}

export interface UniverseContentMedia {
  src: string;
  alt: string;
  kind: UniverseContentMediaKind;
  width?: number;
  height?: number;
}

export interface UniverseContentLink {
  label: string;
  url: string;
}

export interface UniverseContentSurfaceHint {
  preferredRegion?: string;
  anchorCategory?:
    | "project"
    | "milestone"
    | "artifact"
    | "experience"
    | "research"
    | "note"
    | "archive";
  cluster?: string;
  order?: number;
  featured?: boolean;
}

export interface UniverseContentProvenance {
  kind: UniverseContentProvenanceKind;
  source?: string;
}

export interface UniverseContentRelation {
  type: UniverseContentRelationType;
  targetId: string;
}

export interface UniverseContentEntry {
  /**
   * Canonical authored content identity. This is explicitly stored in source
   * data and must not be derived from filename, sort order, localized text,
   * search rank, or renderer placement.
   */
  id: string;
  schemaVersion?: number;
  title: string;
  summary: string;
  body?: string;
  i18n?: Partial<Record<UniverseContentLocale, UniverseContentLocalizedCopy>>;
  aliases?: Partial<Record<UniverseContentLocale, string[]>>;
  kind: UniverseContentKind;
  status: UniverseContentStatus;
  dateStart?: string;
  dateEnd?: string;
  importance: number;
  tags: string[];
  featured: boolean;
  signalVisible?: boolean;
  placement: UniverseContentPlacementMode;
  /**
   * Stable placement identity independent of the source file path.
   * Keep this value unchanged when intentionally preserving a previous
   * spatial mapping whose key differs from the canonical content id.
   */
  placementKey?: string;
  /**
   * YEIS native star id (for example c59669) or an existing marker id.
   * Required when placement === "pinned".
   */
  starId?: string;
  href?: string;
  links?: UniverseContentLink[];
  media?: UniverseContentMedia[];
  surface?: UniverseContentSurfaceHint;
  provenance?: UniverseContentProvenance;
  relations?: UniverseContentRelation[];
  journeys?: string[];
  /**
   * Old canonical ids retained only for backwards-compatible references.
   * New product links should always use id.
   */
  legacyIds?: string[];
}

export interface UniverseContentPlacement {
  entry: UniverseContentEntry;
  markerId: string;
  nativeId?: string;
  planetSlotSeed: number;
}
