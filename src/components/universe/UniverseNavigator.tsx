import { useEffect, useRef, useState } from "react";
import type { GalaxyMarker } from "../../lib/universe/types";
import type { UniverseContentPlacement } from "../../lib/universe/content";
import {
  loadUniverseNavigation,
  type UniverseNavigationDestination,
} from "../../lib/universe/yeis/navigation";

export function UniverseNavigator({
  open,
  markers,
  placements,
  onClose,
  onNavigate,
  onLocate,
}: {
  open: boolean;
  markers: GalaxyMarker[];
  placements: UniverseContentPlacement[];
  onClose: () => void;
  onNavigate: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
  onLocate: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniverseNavigationDestination[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    document.documentElement.dataset.universeNavigator = "open";
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      delete document.documentElement.dataset.universeNavigator;
      delete document.documentElement.dataset.universeNavigatorResults;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");

    void loadUniverseNavigation(query, placements, markers)
      .then((next) => {
        if (cancelled) return;
        setResults(next);
        setActiveIndex(0);
        setStatus("idle");
        document.documentElement.dataset.universeNavigatorResults = String(
          next.length,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[UNIVERSE-NAV] search failed", error);
        setResults([]);
        setStatus("error");
        document.documentElement.dataset.universeNavigatorResults = "error";
      });

    return () => {
      cancelled = true;
    };
  }, [markers, open, placements, query]);

  if (!open) return null;

  const activate = (destination: UniverseNavigationDestination) => {
    void Promise.resolve(onNavigate(destination)).then(onClose);
  };

  const locate = (destination: UniverseNavigationDestination) => {
    void Promise.resolve(onLocate(destination)).then(onClose);
  };

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
            placeholder="Search projects, stars, galaxies, black holes, landmarks…"
            aria-label="Search universe"
          />
          <kbd>CTRL K</kbd>
        </div>

        <div className="navigator-section-label">
          <span>
            {query.trim()
              ? "SEARCH RESULTS"
              : "PERSONAL SIGNALS + FEATURED PLACES"}
          </span>
          <small>
            {status === "loading"
              ? "SCANNING…"
              : String(results.length) + " DESTINATIONS"}
          </small>
        </div>

        <div className="navigator-results" role="listbox">
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
          {results.map((result, index) => (
            <div
              key={result.id}
              className={
                "navigator-result-row" +
                (index === activeIndex ? " is-active" : "")
              }
              role="option"
              aria-selected={index === activeIndex}
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
                  {result.target.kind === "star" || result.target.kind === "body" ? "OPEN →" : "TRAVEL →"}
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
