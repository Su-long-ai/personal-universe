import type { QualityMode, UniversePhase } from "../../lib/universe/types";

const LABELS: Record<UniversePhase, string> = {
  galaxy: "GALACTIC OVERVIEW",
  approach: "INTERSTELLAR APPROACH",
  orbit: "LOW ORBIT",
  atmosphere: "ATMOSPHERIC ENTRY",
  surface: "SURFACE // AURORA-01",
  returning: "RETURN VECTOR",
};

export function UniverseHud({
  phase,
  collapsed,
  onToggleCollapsed,
  muted,
  onToggleMuted,
  quality,
  onQualityChange,
  onReturn,
}: {
  phase: UniversePhase;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  quality: QualityMode;
  onQualityChange: (mode: QualityMode) => void;
  onReturn: () => void;
}) {
  return (
    <aside className={`universe-hud ${collapsed ? "is-collapsed" : ""}`}>
      <div className="hud-topline">
        <span className="hud-mark">PU // 00</span>
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
            <span>AURORA-01</span>
            <small>uncatalogued / test world</small>
          </div>

          <div className="hud-actions">
            <button onClick={onToggleMuted}>{muted ? "SOUND OFF" : "SOUND ON"}</button>
            <label>
              QUALITY
              <select value={quality} onChange={(event) => onQualityChange(event.target.value as QualityMode)}>
                <option value="auto">AUTO</option>
                <option value="high">HIGH</option>
                <option value="low">LOW</option>
              </select>
            </label>
          </div>

          {phase !== "galaxy" && (
            <button className="hud-return" onClick={onReturn}>
              ← RETURN TO GALAXY
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
