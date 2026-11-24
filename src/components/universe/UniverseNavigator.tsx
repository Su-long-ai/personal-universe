import { useEffect, useMemo, useRef, useState } from "react";
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
  loadUniverseNavigation,
  loadUniversePlaces,
  navigationSectionsForResults,
  type UniverseNavigationDestination,
  type UniverseNavigationSection,
} from "../../lib/universe/yeis/navigation";

export function UniverseNavigator({
  open,
  markers,
  placements,
  currentSystem,
  activeDestinationId,
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
  activeDestinationId?: string | null;
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
    title: string,
    destinations: UniverseNavigationDestination[],
  ) => void;
  locale: ProductLocale;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<number, HTMLDivElement>());
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<UniverseNavigationSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [pendingAction, setPendingAction] = useState<{
    destinationId: string;
    mode: "open" | "locate";
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const displaySections = useMemo(() => {
    const seenDestinations = new Set<string>();
    return sections.flatMap((section) => {
      const destinations = section.destinations.filter((destination) => {
        if (seenDestinations.has(destination.id)) return false;
        seenDestinations.add(destination.id);
        return true;
      });
      return destinations.length ? [{ ...section, destinations }] : [];
    });
  }, [sections]);

  const results = useMemo(
    () => displaySections.flatMap((section) => section.destinations),
    [displaySections],
  );

  const journeyOptions = useMemo(() => {
    const personal =
      sections.find((section) => section.id === "personal-signals")
        ?.destinations ?? [];
    const featuredIds = new Set(
      (sections.find((section) => section.id === "featured")
        ?.destinations ?? [])
        .filter((destination) => destination.entryId)
        .map((destination) => destination.id),
    );
    const featured = personal.filter((destination) =>
      featuredIds.has(destination.id),
    );
    const projects =
      sections.find((section) => section.id === "projects")
        ?.destinations ?? [];
    const research =
      sections.find((section) => section.id === "research")
        ?.destinations ?? [];

    const candidates = [
      {
        id: "featured",
        title: "Featured Journey",
        destinations: featured,
      },
      {
        id: "projects",
        title: "Projects Journey",
        destinations: projects,
      },
      {
        id: "research",
        title: "Research Journey",
        destinations: research,
      },
    ];

    const seenRoutes = new Set<string>();
    return candidates.filter((journey) => {
      if (journey.destinations.length === 0) return false;
      const routeKey = journey.destinations
        .map((destination) => destination.id)
        .join("\u0000");
      if (seenRoutes.has(routeKey)) return false;
      seenRoutes.add(routeKey);
      return true;
    });
  }, [sections]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setPendingAction(null);
      setActionError(null);
      return;
    }

    document.documentElement.dataset.universeNavigator = "open";
    const debugQuery = new URLSearchParams(window.location.search).get("navq");
    if (debugQuery) {
      setQuery(debugQuery);
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      delete document.documentElement.dataset.universeNavigator;
      delete document.documentElement.dataset.universeNavigatorResults;
      delete document.documentElement.dataset.universeNavigatorMode;
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
          ).then(navigationSectionsForResults)
        : loadUniversePlaces(
            placements,
            markers,
            currentSystem ?? null,
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
  }, [currentSystem, markers, open, placements, query]);

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
            ref={inputRef}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }

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
                    onStartJourney(journey.title, journey.destinations);
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
                {text(locale, "noDestination")}
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
