import type {
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
} from "../../lib/universe/types";
import {
  archetypeLabel,
  astronomicalName,
  phaseLabel,
  text,
  type ProductLocale,
} from "../../lib/universe/locale";

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
  locale,
  onLocaleChange,
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
  locale: ProductLocale;
  onLocaleChange: (locale: ProductLocale) => void;
}) {
  const destination =
    phase === "galaxy"
      ? {
          name: astronomicalName(locale, "MILKY WAY"),
          detail:
            String(markerCount) + " " + text(locale, "surveyMarkers"),
        }
      : phase === "system" || phase === "returning"
        ? {
            name: astronomicalName(
              locale,
              selectedSystem?.name ?? text(locale, "unresolvedSystem"),
            ),
            detail: selectedSystem
              ? locale === "zh"
                ? `${selectedSystem.planets.length} ${text(locale, "worlds")} / ${selectedSystem.source}`
                : `${selectedSystem.planets.length} worlds / ${selectedSystem.source}`
              : text(locale, "systemUnavailable"),
          }
        : {
            name: astronomicalName(
              locale,
              selectedPlanet?.name ?? text(locale, "unresolvedWorld"),
            ),
            detail: selectedPlanet
              ? `${archetypeLabel(locale, selectedPlanet.archetype)} / ${
                  selectedPlanet.observed
                    ? text(locale, "observed")
                    : selectedPlanet.heroKey
                      ? text(locale, "hero")
                      : text(locale, "procedural")
                }`
              : text(locale, "planetUnavailable"),
          };

  const returnLabel =
    phase === "system"
      ? text(locale, "returnGalaxy")
      : phase === "returning"
        ? text(locale, "returning")
        : text(locale, "returnSystem");

  return (
    <aside className={`universe-hud ${collapsed ? "is-collapsed" : ""}`}>
      <div className="hud-topline">
        <span className="hud-mark">PU // 01</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button
            className="hud-collapse"
            type="button"
            onClick={() => onLocaleChange(locale === "en" ? "zh" : "en")}
            aria-label={
              locale === "en"
                ? "Switch language to Chinese"
                : "切换语言为英文"
            }
          >
            {locale === "en" ? "中文" : "EN"}
          </button>
          <button
            className="hud-collapse"
            type="button"
            onClick={onToggleCollapsed}
          >
            {collapsed ? text(locale, "open") : text(locale, "hide")}
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="hud-content">
          <div className="hud-status">
            <span className="hud-kicker">{text(locale, "currentLayer")}</span>
            <strong>{phaseLabel(locale, phase)}</strong>
          </div>

          <div className="hud-destination">
            <span>{destination.name}</span>
            <small>{destination.detail}</small>
          </div>

          <div className="hud-actions">
            <button type="button" onClick={onToggleMuted}>
              {muted ? text(locale, "soundOff") : text(locale, "soundOn")}
            </button>
            <label>
              {text(locale, "quality")}
              <select
                value={quality}
                onChange={(event) =>
                  onQualityChange(event.target.value as QualityMode)
                }
              >
                <option value="auto">{text(locale, "auto")}</option>
                <option value="high">{text(locale, "high")}</option>
                <option value="low">{text(locale, "low")}</option>
              </select>
            </label>
          </div>

          {navigatorAvailable && (
            <button
              className="hud-navigate"
              type="button"
              onClick={onOpenNavigator}
            >
              {text(locale, "searchPlaces")} <span>CTRL K</span>
            </button>
          )}

          {phase !== "galaxy" && (
            <button
              className="hud-return"
              type="button"
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
