# Mandatory top-down reuse gate

Before editing any protected implementation path, search from the largest reusable solution downward.

Required order:

1. **Full solution / existing product** — can an existing project already cover most of the requested outcome?
2. **Framework / engine / platform** — if not, is there a reusable backbone?
3. **Subsystem** — reuse a substantial functional module.
4. **Component / asset / algorithm / data** — reuse smaller pieces.
5. **Custom implementation** — only after the upper levels were checked or explicitly marked not applicable.

The machine record is `docs/reuse-gate/current.json`. For architecture/subsystem work it must include a coverage matrix and global-value evaluations. Finding one useful small library is not sufficient evidence that the search is complete.

A lower-level choice may still win. The gate requires an explicit tradeoff for every higher-level candidate that was considered, and an explicit override if a rejected candidate has a global-value score at least as high as the selected option. Evaluate global benefit rather than rejecting a candidate because one attribute regresses.

Reuse knowledge is persistent in `docs/reuse-gate/registry.json`. Search the registry first, refresh stale entries as needed, and add newly discovered candidates so future tasks do not restart from zero. Registry statuses follow `adopt | trial | assess | hold`; a `hold` candidate cannot be selected.

Before implementation:

1. Update the registry if research found or materially changed reusable solutions.
2. Update `docs/reuse-gate/current.json`.
3. Run `node scripts/reuse-gate.mjs lint`.
4. Run `npm run reuse:approve` while implementation paths are clean.
5. Only then edit protected files.

Do not bypass or disable the gate. Policy files themselves are protected after this upgrade; changes to the gate require an architecture-level record with `policy_change: true`.

`npm run dev`, `npm run build`, and Git pre-commit enforce the active approval.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
