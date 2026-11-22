# Mandatory reuse-first gate

Before editing any implementation path (src/**, public/**, ordinary scripts/**, or core project config):

1. Search externally for existing reusable libraries, engines, shaders, assets, standards, or reference implementations.
2. Update docs/reuse-gate/current.json with at least two sources and two compared candidates, including license and reuse/reject reasons.
3. List the exact planned implementation files/patterns.
4. Run `npm run reuse:approve` while implementation paths are still clean.
5. Only after approval may implementation begin.

Do not bypass or disable the gate. If reuse:approve refuses because implementation is already dirty, revert/stash the implementation, complete research, approve, then re-apply the implementation.

`npm run dev`, `npm run build`, and Git pre-commit enforce this policy.

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
