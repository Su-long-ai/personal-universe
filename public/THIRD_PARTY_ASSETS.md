# Third-party visual assets

## Solar System Scope — Stars + Milky Way texture

- Local file: `/textures/stars_milky_way.jpg`
- Source: https://www.solarsystemscope.com/textures/
- Original download: https://www.solarsystemscope.com/textures/download/8k_stars_milky_way.jpg
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Credit: Solar System Scope
- Notes: the source pack states that the textures are based on NASA imagery/data and are tuned for visualization.

## procedural-planets

- Package: `procedural-planets@0.5.1`
- Source: https://github.com/ZyFou/ProceduralPlanets
- License: MIT
- Use: live hero-planet terrain, ocean, clouds and atmosphere via `Planet` + `PlanetPass`.


## ProceduralTerrains

- Package: `procedural-terrains@2.0.5`
- Source: https://github.com/ZyFou/ProceduralTerrains
- License: MIT
- Use: finite surface terrain generation, LOD, height sampling and terrain shader.

## Poly Haven — Boulder 01

- Local files: `/models/boulder_01/**`
- Asset: Boulder 01
- Source: https://polyhaven.com/
- Download API: https://api.polyhaven.com/files/boulder_01
- License: CC0
- Use: locally hosted 1K glTF + PBR textures for near-field surface detail.
- Runtime dependency on Poly Haven API: none.


## Galaxy Explorer — galaxy rendering reference

- Source: https://github.com/zjoooooo/galaxy-explorer
- License: MIT
- Copyright: Justin Zhang Jun (2026)
- Use: spiral-arm density placement, GPU `THREE.Points` rendering patterns and galaxy layering were adapted into the R3F galaxy renderer.

## Helios — procedural star-system reference

- Source: https://github.com/dhairyaozaa/procedural-star-system
- License: ISC (declared in package metadata / README)
- Use: deterministic seeded RNG and the decomposition into system/star/planet/moon generators were adapted to TypeScript project data.

## NASA Exoplanet Archive

- Local derived snapshot: `src/data/exoplanet-hosts.json`
- Source: https://exoplanetarchive.ipac.caltech.edu/
- Access: TAP / `pscomppars`
- Use: nearby observed host systems and confirmed-planet parameters.
- Runtime dependency: none; the snapshot is refreshed during development with `npm run catalog:refresh`.
