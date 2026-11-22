export type UniversePhase =
  | "galaxy"
  | "approach"
  | "orbit"
  | "atmosphere"
  | "surface"
  | "returning";

export type QualityMode = "auto" | "high" | "low";

export interface WorldDefinition {
  id: string;
  name: string;
  subtitle: string;
  position: [number, number, number];
  radius: number;
}

export const TEST_WORLD: WorldDefinition = {
  id: "aurora-01",
  name: "AURORA-01",
  subtitle: "Uncatalogued ocean world",
  position: [6.7, 0.2, 0],
  radius: 1.72,
};
