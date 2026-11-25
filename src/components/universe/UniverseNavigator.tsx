import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  GalaxyMarker,
  SystemDefinition,
} from "../../lib/universe/types";
import type { UniverseContentPlacement } from "../../lib/universe/content";
import {
  astronomicalName,
  journeyTitle,
  kindLabel,
  navigationDetail,
  navigationGroupLabel,
  text,
  type ProductLocale,
} from "../../lib/universe/locale";
import {
  guidedJourneysForSections,
  loadUniverseNavigation,
  loadUniversePlaces,
  navigationSectionsForResults,
  universeDestinationSystemId,
  type UniverseNavigationDestination,
  type UniverseNavigationGroup,
  type UniverseNavigationSection,
} from "../../lib/universe/yeis/navigation";

const DISCOVERY_DENSITY_LIMITS: Record<
  UniverseNavigationGroup,
  readonly [galaxy: number, system: number, world: number]
> = {
  "personal-signals": [8, 10, 8],
  featured: [8, 8, 6],
  projects: [4, 6, 5],
  research: [4, 6, 5],
  experience: [3, 4, 4],
  artifacts: [3, 4, 4],
  notes: [3, 4, 4],
  hero: [2, 2, 2],
  "observed-hosts": [7, 8, 4],
  exoplanets: [4, 8, 4],
  bodies: [5, 14, 16],
  stars: [6, 6, 3],
  "black-holes": [4, 4, 3],
  "deep-sky": [5, 5, 4],
  galaxies: [4, 4, 3],
};

function discoveryDensityLimit(
  group: UniverseNavigationGroup,
  scalePosition: number,
): number {
  const [galaxy, system, world] = DISCOVERY_DENSITY_LIMITS[group];
  const scale = Math.min(2, Math.max(0, scalePosition));
  const interpolated =
    scale <= 1
      ? galaxy + (system - galaxy) * scale
      : system + (world - system) * (scale - 1);
  return Math.max(1, Math.round(interpolated));
}

function discoveryDensityMode(
  scalePosition: number,
): "galaxy" | "system" | "world" {
  if (scalePosition < 0.75) return "galaxy";
  if (scalePosition < 1.75) return "system";
  return "world";
}

// Escape belongs to the open modal, not to the combobox. Register it with
// the mounted dialog before paint, including while focus is still on its opener.
function NavigatorKeyboardDismissal({ onClose }: { onClose: () => void }) {
  useLayoutEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  return null;
}

export function UniverseNavigator({
  open,
  markers,
  placements,
  currentSystem,
  scalePosition = 0,
  activeDestinationId,
  recentDestinationIds = [],
  pendingDestinationId,
  pendingDestinationMode,
  onClose,
  onNavigate,
  onLocate,
  onStartJourney,
  locale,
}: {
  open: boolean;
  markers: GalaxyMarker[];
  placements: UniverseContentPlacement[];
  currentSystem?: SystemDefinition | null;
  scalePosition?: number;
  activeDestinationId?: string | null;
  recentDestinationIds?: string[];
  pendingDestinationId?: string | null;
  pendingDestinationMode?: "locating" | "traveling" | null;
  onClose: () => void;
  onNavigate: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
  onLocate: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
  onStartJourney?: (
    id: "featured" | "projects" | "research",
    title: string,
    destinations: UniverseNavigationDestination[],
  ) => void;
  locale: ProductLocale;
}) {
  const resultRefs = useRef(new Map<number, HTMLDivElement>());
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<UniverseNavigationSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placesFilter, setPlacesFilter] = useState<
    "all" | "personal" | "important" | "nearby" | "recent"
  >("all");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [pendingAction, setPendingAction] = useState<{
    destinationId: string;
    mode: "open" | "locate";
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const recentDestinationSet = useMemo(
    () => new Set(recentDestinationIds),
    [recentDestinationIds],
  );
  const currentSystemId =
    currentSystem?.id.startsWith("yeis-system:")
      ? currentSystem.id.slice("yeis-system:".length)
      : null;
  const densityMode = discoveryDensityMode(scalePosition);

  const displaySections = useMemo(() => {
    const seenDestinations = new Set<string>();
    const searchMode = Boolean(query.trim());
    const defaultPlaces = !searchMode && placesFilter === "all";

    return sections.flatMap((section) => {
      let candidates = section.destinations.filter((destination) => {
        if (!searchMode) {
          const matchesFilter =
            placesFilter === "all" ||
            (placesFilter === "personal" &&
              destination.origin === "personal") ||
            (placesFilter === "important" &&
              (destination.featured ||
                (destination.importance ?? 0) >= 4 ||
                destination.origin === "hero")) ||
            (placesFilter === "nearby" &&
              Boolean(currentSystemId) &&
              universeDestinationSystemId(destination) === currentSystemId) ||
            (placesFilter === "recent" &&
              recentDestinationSet.has(destination.id));

          if (!matchesFilter) return false;
        }

        if (
          defaultPlaces &&
          section.id === "personal-signals" &&
          !destination.featured &&
          (destination.importance ?? 0) < 4
        ) {
          // The catch-all Personal group is a spotlight in default Places.
          // Lower-priority authored entries remain available in their semantic
          // Projects/Research/etc groups, explicit Personal filter and Search.
          return false;
        }

        return true;
      });

      candidates = candidates.filter(
        (destination) => !seenDestinations.has(destination.id),
      );

      if (defaultPlaces) {
        candidates = candidates.slice(
          0,
          discoveryDensityLimit(section.id, scalePosition),
        );
      }

      for (const destination of candidates) {
        seenDestinations.add(destination.id);
      }

      return candidates.length
        ? [{ ...section, destinations: candidates }]
        : [];
    });
  }, [
    currentSystemId,
    placesFilter,
    query,
    recentDestinationSet,
    scalePosition,
    sections,
  ]);

  const results = useMemo(
    () => displaySections.flatMap((section) => section.destinations),
    [displaySections],
  );

  const journeyOptions = useMemo(
    () => guidedJourneysForSections(sections),
    [sections],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setPendingAction(null);
      setActionError(null);
      return;
    }

    document.documentElement.dataset.universeNavigator = "open";
    document.documentElement.dataset.universeNavigatorFilter = placesFilter;
    const debugQuery = new URLSearchParams(window.location.search).get("navq");
    if (debugQuery) {
      setQuery(debugQuery);
    }
    return () => {
      delete document.documentElement.dataset.universeNavigator;
      delete document.documentElement.dataset.universeNavigatorResults;
      delete document.documentElement.dataset.universeNavigatorMode;
      delete document.documentElement.dataset.universeNavigatorFilter;
      delete document.documentElement.dataset.universeDiscoveryDensity;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let debounceTimer = 0;
    setStatus("loading");
    setSections([]);
    setActiveIndex(0);
    document.documentElement.dataset.universeNavigatorResults = "0";
    const trimmed = query.trim();
    document.documentElement.dataset.universeNavigatorMode = trimmed
      ? "search"
      : "places";

    const run = () => {
      const request = trimmed
        ? loadUniverseNavigation(
            trimmed,
            placements,
            markers,
            currentSystem ?? null,
            recentDestinationIds,
          ).then(navigationSectionsForResults)
        : loadUniversePlaces(
            placements,
            markers,
            currentSystem ?? null,
            recentDestinationIds,
          );

      void request
        .then((next) => {
          if (cancelled) return;
          setSections(next);
          setActiveIndex(0);
          setStatus("idle");
          const count = next.reduce(
            (sum, section) => sum + section.destinations.length,
            0,
          );
          document.documentElement.dataset.universeNavigatorResults =
            String(count);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("[UNIVERSE-NAV] navigator index failed", error);
          setSections([]);
          setStatus("error");
          document.documentElement.dataset.universeNavigatorResults = "error";
        });
    };

    if (trimmed) {
      debounceTimer = window.setTimeout(run, 90);
    } else {
      run();
    }

    return () => {
      cancelled = true;
      if (debounceTimer) window.clearTimeout(debounceTimer);
    };
  }, [
    currentSystem,
    markers,
    open,
    placements,
    query,
    recentDestinationIds,
  ]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.universeNavigatorFilter = placesFilter;
    document.documentElement.dataset.universeDiscoveryDensity = densityMode;
    setActiveIndex(0);
  }, [densityMode, open, placesFilter]);

  useEffect(() => {
    if (!results[activeIndex]) return;
    resultRefs.current.get(activeIndex)?.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    });
  }, [activeIndex, results]);

  if (!open) return null;

  const updateQuery = (value: string) => {
    setQuery(value);
    setStatus("loading");
    setSections([]);
    setActiveIndex(0);
    setActionError(null);
    document.documentElement.dataset.universeNavigatorResults = "0";
    document.documentElement.dataset.universeNavigatorMode = value.trim()
      ? "search"
      : "places";
  };

  const activate = async (destination: UniverseNavigationDestination) => {
    if (pendingAction) return;
    setPendingAction({ destinationId: destination.id, mode: "open" });
    setActionError(null);
    try {
      await Promise.resolve(onNavigate(destination));
      setPendingAction(null);
      onClose();
    } catch (error) {
      console.error("[UNIVERSE-NAV] destination activation failed", error);
      setPendingAction(null);
      setActionError(
        text(locale, "couldNotOpen", {
          title: astronomicalName(locale, destination.title),
        }),
      );
    }
  };

  const locate = async (destination: UniverseNavigationDestination) => {
    if (pendingAction) return;
    setPendingAction({ destinationId: destination.id, mode: "locate" });
    setActionError(null);
    try {
      await Promise.resolve(onLocate(destination));
      setPendingAction(null);
      onClose();
    } catch (error) {
      console.error("[UNIVERSE-NAV] destination locate failed", error);
      setPendingAction(null);
      setActionError(
        text(locale, "couldNotLocate", {
          title: astronomicalName(locale, destination.title),
        }),
      );
    }
  };

  let flatIndex = -1;

  return (
    <div
      className="universe-navigator-backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="universe-navigator"
        role="dialog"
        aria-modal="true"
        aria-label={text(locale, "universeNavigator")}
      >
        <NavigatorKeyboardDismissal onClose={onClose} />
        <header className="navigator-header">
          <div>
            <span>{text(locale, "navigationKicker")}</span>
            <strong>{text(locale, "universeNavigator")}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={text(locale, "closeNavigator")}
          >
            ESC
          </button>
        </header>

        <div className="navigator-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (results.length === 0) return;
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex(
                  (index) =>
                    (index + delta + results.length) % results.length,
                );
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                const result = results[activeIndex] ?? results[0];
                if (!result) return;
                if (event.shiftKey) locate(result);
                else activate(result);
              }
            }}
            placeholder={text(locale, "searchPlaceholder")}
            aria-label={text(locale, "searchUniverse")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="universe-navigator-results"
            aria-activedescendant={
              results[activeIndex]
                ? "universe-navigator-option-" + activeIndex
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>CTRL K</kbd>
        </div>

        <div className="navigator-section-label">
          <span>
            {query.trim()
              ? text(locale, "searchResults")
              : text(locale, "placesDestinations")}
          </span>
          <small>
            {status === "loading"
              ? text(locale, "scanning")
              : String(results.length) + " " + text(locale, "destinations")}
          </small>
        </div>

        {!query.trim() && (
          <div
            className="navigator-filters"
            aria-label={text(locale, "discoveryFilters")}
          >
            {(
              [
                ["all", "filterAll"],
                ["personal", "filterPersonal"],
                ["important", "filterImportant"],
                ["nearby", "filterNearby"],
                ["recent", "filterRecent"],
              ] as const
            ).map(([id, label]) => {
              const disabled =
                (id === "nearby" && !currentSystemId) ||
                (id === "recent" && recentDestinationIds.length === 0);
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={placesFilter === id}
                  disabled={disabled}
                  onClick={() => setPlacesFilter(id)}
                >
                  {text(locale, label)}
                </button>
              );
            })}
          </div>
        )}

        {!query.trim() && onStartJourney && journeyOptions.length > 0 && (
          <div
            className="navigator-journeys"
            aria-label={text(locale, "guidedJourneys")}
          >
            <span className="navigator-journeys-label">
              {text(locale, "guidedJourneys")}
            </span>
            <div>
              {journeyOptions.map((journey) => (
                <button
                  type="button"
                  key={journey.id}
                  onClick={() => {
                    onStartJourney(
                      journey.id,
                      journey.title,
                      journey.destinations,
                    );
                    onClose();
                  }}
                >
                  <strong>{journeyTitle(locale, journey.title)}</strong>
                  <small>
                    {journey.destinations.length + " " + text(locale, "stops")}
                  </small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          id="universe-navigator-results"
          className="navigator-results"
          role="listbox"
          aria-busy={status === "loading" || pendingAction !== null}
        >
          {actionError && (
            <div className="navigator-action-error" role="alert">
              {actionError}
            </div>
          )}

          {status === "loading" && (
            <div className="navigator-empty is-loading" role="status">
              {text(locale, "scanningDestinations")}
            </div>
          )}

          {status === "error" && (
            <div className="navigator-empty">
              {text(locale, "navigationUnavailable")}
            </div>
          )}

          {status !== "error" &&
            status !== "loading" &&
            results.length === 0 && (
              <div className="navigator-empty">
                {!query.trim() && placesFilter === "recent"
                  ? text(locale, "noRecentDestinations")
                  : !query.trim() && placesFilter !== "all"
                    ? text(locale, "noFilteredDestinations")
                    : text(locale, "noDestination")}
              </div>
            )}

          {displaySections.map((section) => (
            <section
              className="navigator-result-group"
              key={section.id}
              aria-label={navigationGroupLabel(locale, section.id, section.title)}
            >
              <header className="navigator-result-group-title">
                <span>
                  {navigationGroupLabel(locale, section.id, section.title)}
                </span>
                <small>{section.destinations.length}</small>
              </header>

              {section.destinations.map((result) => {
                flatIndex += 1;
                const index = flatIndex;
                const isKeyboardActive = index === activeIndex;
                const isCurrent = result.id === activeDestinationId;
                const isPendingDestination =
                  result.id === pendingDestinationId;
                const spatial =
                  result.target.kind === "galaxy" ||
                  result.target.kind === "landmark" ||
                  result.target.kind === "blackhole";
                const localPendingMode =
                  pendingAction?.destinationId === result.id
                    ? pendingAction.mode
                    : null;
                const routePendingMode = isPendingDestination
                  ? pendingDestinationMode
                  : null;

                return (
                  <div
                    key={section.id + ":" + result.id}
                    id={"universe-navigator-option-" + index}
                    ref={(node) => {
                      if (node) resultRefs.current.set(index, node);
                      else resultRefs.current.delete(index);
                    }}
                    className={
                      "navigator-result-row" +
                      (isKeyboardActive ? " is-active" : "") +
                      (isCurrent ? " is-current" : "") +
                      (isPendingDestination ? " is-pending" : "")
                    }
                    data-destination-id={result.id}
                    data-destination-origin={result.origin ?? "catalog"}
                    data-destination-system={
                      universeDestinationSystemId(result) ?? undefined
                    }
                    data-destination-featured={
                      result.featured ? "true" : undefined
                    }
                    data-destination-current={
                      isCurrent ? "true" : undefined
                    }
                    role="option"
                    aria-selected={isKeyboardActive}
                    aria-current={isCurrent ? "location" : undefined}
                    onPointerEnter={() => setActiveIndex(index)}
                  >
                    <button
                      type="button"
                      className="navigator-result-open"
                      onClick={() => void activate(result)}
                      disabled={pendingAction !== null}
                    >
                      <span className={"navigator-kind kind-" + result.kind}>
                        {kindLabel(locale, result.kind)}
                      </span>
                      <span className="navigator-result-main">
                        <strong>
                          {astronomicalName(locale, result.title)}
                        </strong>
                        <small>{navigationDetail(locale, result.detail)}</small>
                      </span>
                      <span className="navigator-open">
                        {localPendingMode === "open"
                          ? spatial
                            ? text(locale, "traveling")
                            : text(locale, "opening")
                          : routePendingMode === "traveling"
                            ? text(locale, "traveling")
                            : routePendingMode === "locating"
                              ? text(locale, "locating")
                              : isCurrent
                                ? text(locale, "active")
                                : spatial
                                  ? text(locale, "travel")
                                  : text(locale, "openAction")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="navigator-locate"
                      onClick={() => void locate(result)}
                      aria-label={text(locale, "locateInGalaxy", {
                        title: astronomicalName(locale, result.title),
                      })}
                      disabled={pendingAction !== null}
                    >
                      {localPendingMode === "locate" ||
                      routePendingMode === "locating"
                        ? text(locale, "locating")
                        : text(locale, "locate")}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="navigator-footer">
          <span>{text(locale, "selectHint")}</span>
          <span>{text(locale, "openHint")}</span>
          <span>{text(locale, "locateHint")}</span>
          <span>{text(locale, "closeHint")}</span>
        </footer>
      </section>
    </div>
  );
}
