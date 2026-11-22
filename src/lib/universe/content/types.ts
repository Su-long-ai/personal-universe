export type UniverseContentKind =
  | "project"
  | "experience"
  | "research"
  | "artifact"
  | "note";

export type UniverseContentStatus = "active" | "complete" | "archived";
export type UniverseContentPlacementMode = "auto" | "hero";

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
  href?: string;
}

export interface UniverseContentPlacement {
  entry: UniverseContentEntry;
  markerId: string;
  nativeId?: string;
  planetSlotSeed: number;
}
