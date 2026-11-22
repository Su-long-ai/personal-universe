import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GalaxyMarker,
  SystemDefinition,
} from "../../lib/universe/types";
import type { UniverseContentPlacement } from "../../lib/universe/content";
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
  onClose,
  onNavigate,
  onLocate,
  onStartJourney,
}: {
  open: boolean;
  markers: GalaxyMarker[];
  placements: UniverseContentPlacement[];
  currentSystem?: SystemDefinition | null;
  activeDestinationId?: string | null;
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
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<number, HTMLDivElement>());
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<UniverseNavigationSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const results = useMemo(
    () => sections.flatMap((section) => section.destinations),
    [sections],
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

    return [
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
  }, [sections]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
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
        : loadUniversePlaces(placements, markers);

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

  const activate = (destination: UniverseNavigationDestination) => {
    onClose();
    void Promise.resolve(onNavigate(destination)).catch((error) => {
      console.error("[UNIVERSE-NAV] destination activation failed", error);
    });
  };

  const locate = (destination: UniverseNavigationDestination) => {
    onClose();
    void Promise.resolve(onLocate(destination)).catch((error) => {
      console.error("[UNIVERSE-NAV] destination locate failed", error);
    });
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
        aria-label="Universe navigator"
      >
        <header className="navigator-header">
          <div>
            <span>YEIS NAVIGATION // SEARCH + PLACES</span>
            <strong>Universe Navigator</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close navigator">
            ESC
          </button>
        </header>

        <div className="navigator-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            placeholder="Search personal signals, planets, stars, landmarks, galaxies…"
            aria-label="Search universe"
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
          <span>{query.trim() ? "SEARCH RESULTS" : "PLACES / DESTINATIONS"}</span>
          <small>
            {status === "loading"
              ? "SCANNING…"
              : String(results.length) + " DESTINATIONS"}
          </small>
        </div>

        {!query.trim() && onStartJourney && (
          <div className="navigator-journeys" aria-label="Guided journeys">
            <span className="navigator-journeys-label">GUIDED JOURNEYS</span>
            <div>
              {journeyOptions.map((journey) => (
                <button
                  type="button"
                  key={journey.id}
                  disabled={journey.destinations.length === 0}
                  onClick={() => {
                    if (!journey.destinations.length) return;
                    onStartJourney(journey.title, journey.destinations);
                    onClose();
                  }}
                >
                  <strong>{journey.title}</strong>
                  <small>
                    {journey.destinations.length
                      ? journey.destinations.length + " STOPS"
                      : "NO SIGNALS YET"}
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
          aria-busy={status === "loading"}
        >
          {status === "error" && (
            <div className="navigator-empty">
              YEIS navigation index unavailable.
            </div>
          )}

          {status !== "error" &&
            status !== "loading" &&
            results.length === 0 && (
              <div className="navigator-empty">
                No destination matched this signal.
              </div>
            )}

          {sections.map((section) => (
            <section
              className="navigator-result-group"
              key={section.id}
              aria-label={section.title}
            >
              <header className="navigator-result-group-title">
                <span>{section.title}</span>
                <small>{section.destinations.length}</small>
              </header>

              {section.destinations.map((result) => {
                flatIndex += 1;
                const index = flatIndex;
                const isKeyboardActive = index === activeIndex;
                const isCurrent = result.id === activeDestinationId;
                const spatial =
                  result.target.kind === "galaxy" ||
                  result.target.kind === "landmark" ||
                  result.target.kind === "blackhole";

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
                      (isCurrent ? " is-current" : "")
                    }
                    role="option"
                    aria-selected={isKeyboardActive}
                    aria-current={isCurrent ? "location" : undefined}
                    onPointerEnter={() => setActiveIndex(index)}
                  >
                    <button
                      type="button"
                      className="navigator-result-open"
                      onClick={() => activate(result)}
                    >
                      <span className={"navigator-kind kind-" + result.kind}>
                        {result.kind}
                      </span>
                      <span className="navigator-result-main">
                        <strong>{result.title}</strong>
                        <small>{result.detail}</small>
                      </span>
                      <span className="navigator-open">
                        {isCurrent ? "ACTIVE" : spatial ? "TRAVEL →" : "OPEN →"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="navigator-locate"
                      onClick={() => locate(result)}
                      aria-label={"Locate " + result.title + " in galaxy"}
                    >
                      LOCATE
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="navigator-footer">
          <span>↑↓ SELECT</span>
          <span>ENTER OPEN / TRAVEL</span>
          <span>SHIFT+ENTER LOCATE</span>
          <span>ESC CLOSE</span>
        </footer>
      </section>
    </div>
  );
}
