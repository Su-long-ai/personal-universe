export type UniverseContentKind =
  | "project"
  | "experience"
  | "research"
  | "artifact"
  | "note";

export type UniverseContentStatus = "active" | "complete" | "archived";
export type UniverseContentPlacementMode = "auto" | "hero" | "pinned";

export interface UniverseContentEntry {
  id: string;
  title: string;
  summary: string;
  kind: UniverseContentKind;
  status: UniverseContentStatus;
  importance: number;
  tags: string[];
  featured: boolean;
  placement: UniverseContentPlacementMode;
  /**
   * Stable placement identity independent of the source file path.
   * Keep this value unchanged when renaming/moving a content file.
   */
  placementKey?: string;
  /**
   * YEIS native star id (for example c59669) or an existing marker id.
   * Required when placement === "pinned".
   */
  starId?: string;
  href?: string;
}

export interface UniverseContentPlacement {
  entry: UniverseContentEntry;
  markerId: string;
  nativeId?: string;
  planetSlotSeed: number;
}
