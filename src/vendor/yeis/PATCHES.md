# Vendored YEIS core

Upstream: https://github.com/berkcomba/youreyesinspace  
Pinned source commit: `e52056897364e060fbd6d00951628f163b57d7a1`  
Vendored subset: 22 TypeScript files forming the dependency closure of
`Universe`, `StarSystem`, `CelestialBody`, and `StarCatalog`.

This directory intentionally does **not** track the upstream default branch.
Later upstream revisions are AGPL-3.0-or-later and are outside the approved
source boundary.

## Host patches

The vendored code is kept structurally close to upstream. There are three
intentional Personal Universe adaptations:

1. `core/Universe.ts`
   - Adds `registerExtraSystem(system)`.
   - This exposes the upstream private `ExtraSystem` mechanism so Hero systems
     can be registered without changing normal real/procedural generation.

2. `data/StarCatalog.ts`
   - Replaces the upstream Vite-injected `__BUILD_ID__` cache key with the
     pinned source identifier `e520568`.
   - Data format and parsing are unchanged.

3. `i18n/index.ts`
   - Replaces the upstream product UI locale loader with a tiny identity/Intl
     compatibility shim exporting only the formatting functions required by the
     model closure.
   - This avoids importing YEIS product UI/locales into Personal Universe.

No model, orbital, catalogue, procedural-generation, galaxy, black-hole, or
stellar algorithms were rewritten in this migration.

## Data

`/public/vendor/yeis/data/stars.bin` and `star-names.json` are copied from
the same pinned snapshot. The binary contains 109,401 HYG-derived stars.

See `UPSTREAM_NOTICE.md` for third-party attribution and licensing, including
the CC BY-SA 4.0 HYG-derived catalogue terms.
