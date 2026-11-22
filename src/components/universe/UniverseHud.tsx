import type {
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
} from "../../lib/universe/types";

const LABELS: Record<UniversePhase, string> = {
  galaxy: "GALACTIC OVERVIEW",
  system: "STELLAR SYSTEM",
  approach: "INTERPLANETARY APPROACH",
  orbit: "LOW ORBIT",
  atmosphere: "ATMOSPHERIC ENTRY",
  surface: "SURFACE",
  returning: "RETURN VECTOR",
};

export function UniverseHud({
  phase,
  selectedSystem,
  selectedPlanet,
  markerCount,
  collapsed,
  onToggleCollapsed,
  muted,
  onToggleMuted,
  quality,
  onQualityChange,
  onOpenNavigator,
  navigatorAvailable,
  onReturn,
}: {
  phase: UniversePhase;
  selectedSystem: SystemDefinition | null;
  selectedPlanet: PlanetDefinition | null;
  markerCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  quality: QualityMode;
  onQualityChange: (mode: QualityMode) => void;
  onOpenNavigator: () => void;
  navigatorAvailable: boolean;
  onReturn: () => void;
}) {
  const destination =
    phase === "galaxy"
      ? {
          name: "MILKY WAY",
          detail: `${markerCount} survey markers / observed + procedural`,
        }
      : phase === "system" || phase === "returning"
        ? {
            name: selectedSystem?.name ?? "UNRESOLVED SYSTEM",
            detail: selectedSystem
              ? `${selectedSystem.planets.length} worlds / ${selectedSystem.source}`
              : "system data unavailable",
          }
        : {
            name: selectedPlanet?.name ?? "UNRESOLVED WORLD",
            detail: selectedPlanet
              ? `${selectedPlanet.archetype.replace("_", " ")} / ${selectedPlanet.observed ? "observed" : selectedPlanet.heroKey ? "hero" : "procedural"}`
              : "planet data unavailable",
          };

  const returnLabel =
    phase === "system"
      ? "← RETURN TO GALAXY"
      : phase === "returning"
        ? "RETURNING…"
        : "← RETURN TO SYSTEM";

  return (
    <aside className={`universe-hud ${collapsed ? "is-collapsed" : ""}`}>
      <div className="hud-topline">
        <span className="hud-mark">PU // 01</span>
        <button className="hud-collapse" onClick={onToggleCollapsed}>
          {collapsed ? "OPEN" : "HIDE"}
        </button>
      </div>

      {!collapsed && (
        <div className="hud-content">
          <div className="hud-status">
            <span className="hud-kicker">CURRENT LAYER</span>
            <strong>{LABELS[phase]}</strong>
          </div>

          <div className="hud-destination">
            <span>{destination.name}</span>
            <small>{destination.detail}</small>
          </div>

          <div className="hud-actions">
            <button onClick={onToggleMuted}>{muted ? "SOUND OFF" : "SOUND ON"}</button>
            <label>
              QUALITY
              <select
                value={quality}
                onChange={(event) =>
                  onQualityChange(event.target.value as QualityMode)
                }
              >
                <option value="auto">AUTO</option>
                <option value="high">HIGH</option>
                <option value="low">LOW</option>
              </select>
            </label>
          </div>

          {navigatorAvailable && (
            <button className="hud-navigate" onClick={onOpenNavigator}>
              SEARCH / PLACES <span>CTRL K</span>
            </button>
          )}

          {phase !== "galaxy" && (
            <button
              className="hud-return"
              onClick={onReturn}
              disabled={phase === "returning"}
            >
              {returnLabel}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
