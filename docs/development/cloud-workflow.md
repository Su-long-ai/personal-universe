# Cloud-first development workflow

Personal Universe treats GitHub Actions as the normal validation environment. A Windows checkout is not a prerequisite for ordinary feature work.

## Normal loop

1. Create or update a GitHub branch.
2. For protected implementation, prepare the task-scoped Reuse Gate record and approval commit before the implementation commit.
3. Push the branch and open a pull request to `main`.
4. Let **Machine Reuse Gate** validate the PR diff and approval provenance.
5. After the gate passes, CI runs deterministic `npm ci`, the production build, bundle/asset guards, and Playwright Chromium E2E.
6. Inspect the Playwright HTML report, traces on failure, screenshots, runtime/build metrics, and downloadable `dist` artifacts.
7. Fix on the branch and repeat until green.
8. Merge schema-3 work with a **merge commit** so approval-before-implementation history is preserved. The same CI runs again on `main`.

PR jobs checkout the immutable event `github.sha` rather than the moving `refs/pull/.../merge` ref, so a long-running build/E2E job cannot silently switch commits when another push lands on the PR.

A WIP or feature branch does not need a permanent branch trigger. Run **CI → Run workflow** and provide the branch/tag/SHA in the optional `ref` input. Manual validation compares the selected ref against `origin/main`, so branches such as `wip/yeis-full-places-travel` can use the same machine gate and browser suite.

## What CI proves

The browser suite exercises the default YEIS engine, explicit `?engine=v2` rollback, Personal Signal counts and overlay, an actual content-derived system/orbit deep link, Search keyboard navigation, Places navigation, and a real YEIS-init failure created by intercepting `stars.bin`.

Browser instrumentation fails on page errors (including uncaught browser exceptions), console errors, and failed/HTTP-error critical JS/CSS/YEIS requests. The fallback test has a narrow allowlist for the network error it deliberately injects. Optional editorial/image failures are not globally promoted to fatal errors.

Visual checks deliberately avoid strict full-canvas pixel diffs for the animated WebGL scene. CI combines stable DOM/HUD assertions with retained screenshot artifacts at 1440×900, 834×1194, and 390×844. Captures cover Galaxy, System, Orbit/Personal Signal world, Search open, Places open, and the stable Hero-world deep link.

The bundle guard reports `dist` size, JS/CSS/image totals, the largest JS file, `stars.bin`, output-file count, and the largest assets. Thresholds are broad tripwires for accidental giant media, duplicate vendoring, or a full upstream app entering the bundle; ordinary tens-of-KB movement is not intended to block the project.

## Reports and artifacts

The production `dist` artifact is uploaded before browser E2E, so a browser failure still leaves a deployable/reproducible build. Dist is retained for seven days. Playwright HTML reports, success screenshots, failure screenshots/traces, and CI metrics are retained for fourteen days. Each shard emits Playwright's native blob report as well; a lightweight final CI job merges those blobs into one `personal-universe-playwright-report-<run_id>` HTML-report artifact even when a shard failed.

Start CI diagnosis from the combined HTML report and the failing shard trace rather than reproducing on the user's computer.

## Preview deployment

`.github/workflows/pages-preview.yml` is currently a manual deployment path for a selected ref. The first real `main` deployment attempt proved that this private repository does not yet have an enabled GitHub Pages site, so automatic `main` publication is intentionally disabled until hosting is available. The deployment build still injects `PUBLIC_SITE_URL=https://su-long-ai.github.io` and `PUBLIC_BASE_PATH=/personal-universe`; ordinary local development and normal browser CI remain rooted at `/`.

Public runtime assets use Astro/Vite `import.meta.env.BASE_URL`, so the same code works at local root, the GitHub Pages repository subpath, and a future custom-domain root without maintaining a second URL layer. After `deploy-pages`, the workflow probes both the live homepage and the YEIS `stars.bin` catalogue before reporting the production URL.

GitHub Pages must be enabled and configured to use GitHub Actions before the manual deployment can succeed. Until that external repository/account prerequisite is satisfied, a failed Pages deployment is not treated as a product regression and does not run automatically on `main`. PR CI remains independent from hosting. Cloudflare Pages and Vercel remain the researched root-hosted fallbacks if Pages availability cannot be enabled for this private repository.

## When a local machine is justified

Use a local machine only for Windows-specific behavior, local-GPU work, local-only files, or a final device-specific visual/performance check. Those are exception paths, not prerequisites for routine implementation, regression testing, or failure diagnosis.

## Tooling policy

Playwright Test is pinned by CI and installed after the product's deterministic `npm ci` so the application lockfile remains unchanged. The project reuses Playwright's browser lifecycle, tracing, screenshots, HTML reporting, waiting, and request interception instead of maintaining a custom CDP/WebSocket harness.

## Sharded browser validation

The first fully validated Playwright run executed all eight tests on one CI worker.
The browser-test step alone took 9m40s; the three WebGL visual viewport tests
accounted for roughly 7m47s of that time.

Task `PLAYWRIGHT-SHARDING-V1-001` keeps Playwright's CI stability rule of one
worker per machine, but distributes the suite across four GitHub-hosted runners:

1. Machine Reuse Gate runs once.
2. Astro build + bundle guard run once.
3. The validated `dist` artifact is uploaded once.
4. Four Playwright shards download the same `dist` and run concurrently.
5. Each shard retains its own HTML report, trace, screenshots and metrics.

`fullyParallel: true` is used for shard balancing only; each shard still has
`workers: 1`, so multiple SwiftShader/WebGL browsers do not contend inside the
same runner.

CI keeps one retry for diagnostic traces but enables Playwright's native `failOnFlakyTests`; a test that only passes on retry is therefore still a failed CI signal and must be hardened before merge.

This follows Playwright's native CI sharding model rather than weakening visual
coverage or adding another browser-test service.

