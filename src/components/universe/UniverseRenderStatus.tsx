import { useEffect, useState } from "react";
import { portfolioPath } from "../../lib/portfolio/paths";
import type { ProductLocale } from "../../lib/universe/locale";

export function UniverseRenderStatus({ locale }: { locale: ProductLocale }) {
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    // The renderer remains the only lifecycle owner. Subscribe only to its
    // existing transition signal, not camera attributes, timers, or canvas events.
    const sync = () => setLost(html.dataset.universeWebglLifecycle === "lost");
    const observer = new MutationObserver(sync);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["data-universe-webgl-lifecycle"],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  const zh = locale === "zh";
  return (
    <div className="universe-render-status" data-render-lost={lost ? "true" : undefined}>
      <div role="status" aria-atomic="true">
        {lost && (
          <>
            <strong>{zh ? "3D 画面暂不可用" : "3D view interrupted"}</strong>
            <p>
              {zh
                ? "浏览器恢复图形渲染后，3D 画面会自动返回。你也可以继续浏览文字版作品集。"
                : "The 3D view returns when the browser restores rendering. You can keep browsing the text portfolio in the meantime."}
            </p>
          </>
        )}
      </div>
      {lost && (
        <a href={portfolioPath(locale)}>
          {zh ? "打开文字版作品集" : "Open text portfolio"}
        </a>
      )}
    </div>
  );
}
