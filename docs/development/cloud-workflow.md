# Cloud-first development workflow

Personal Universe treats GitHub Actions as the normal validation environment. A Windows checkout is not a prerequisite for ordinary feature work.

## Normal loop

1. Create or update a GitHub branch.
2. Commit and push the change.
3. Open a pull request to `main`.
4. Let CI run deterministic `npm ci`, the Reuse Gate, the production build, bundle/asset guards, and Playwright Chromium E2E.
5. Inspect the Playwright HTML report, traces on failure, screenshots, runtime/build metrics, and downloadable `dist` artifacts.
6. Fix on the branch and repeat until green.
7. Merge only after the PR validation is green; the same workflow runs again on `main`.

A WIP or feature branch does not need a permanent workflow trigger. Run **CI → Run workflow** and supply the branch name in the optional `ref` input. This is the intended path for branches such as `wip/yeis-full-places-travel`.

## What CI proves

The browser suite exercises the default YEIS engine, explicit `?engine=v2` rollback, Personal Signal counts and overlay, an actual content-derived system/orbit deep link, Search keyboard navigation, Places navigation, and a real YEIS-init failure created by intercepting `stars.bin`.

Browser instrumentation fails on page errors, console errors, and failed/HTTP-error critical JS/CSS/YEIS requests. Optional editorial/image failures are not globally promoted to fatal errors.

Visual checks deliberately do not use strict full-canvas pixel diffs for the animated WebGL scene. CI instead combines stable DOM/HUD assertions with screenshot artifacts at 1440×900, 834×1194, and 390×844. Captures cover Galaxy, System, Orbit/Personal Signal world, Search open, Places open, and the stable Hero-world deep link.

The bundle guard reports `dist` size, JS/CSS/image totals, the largest JS file, `stars.bin`, output file count, and the largest assets. Thresholds are intentionally broad: they are tripwires for accidental giant media, duplicate vendoring, or a full upstream app entering the bundle, not a blocker for normal tens-of-KB movement.

## Reports and artifacts

Every successful CI run keeps the built `dist` artifact for seven days. Playwright reports, screenshots, failure traces, and CI metrics are retained for fourteen days. On a failed browser test, start with the HTML report and trace before reproducing locally.

## Preview deployment

`.github/workflows/pages-preview.yml` is an intentionally separate, manual GitHub Pages module. If repository Pages is configured to use **GitHub Actions**, run **Pages Preview** with any branch/tag/SHA. It builds the selected ref and deploys the static `dist` without external credentials.

PR CI does not depend on Pages being enabled. Until a stable public PR-preview host is configured, the canonical no-credential preview outputs are the downloadable `dist`, the browser screenshots, and the Playwright report/trace. This keeps missing deployment credentials or repository Pages settings from blocking validation.

## When a local machine is still justified

Use a local machine only for Windows-specific behavior, local-GPU work, local-only files, or a final device-specific visual/performance check. Those are exception paths, not prerequisites for routine implementation, regression testing, or failure diagnosis.

## Tooling policy

Playwright Test is pinned by CI and installed after the product's deterministic `npm ci` so the application lockfile remains unchanged. The project reuses Playwright's browser lifecycle, tracing, screenshots, HTML reporting, waiting, and request interception instead of maintaining a custom CDP/WebSocket harness.
