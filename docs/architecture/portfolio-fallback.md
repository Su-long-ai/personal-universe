# Readable portfolio and homepage fallback

The 3D homepage is still the default. Its HUD now links to a plain HTML
portfolio. The homepage also renders a separate, bilingual entry when there
is no React tree to display after WebGL startup fails, or when the browser has
JavaScript disabled. This entry lives outside the React island: an
engine/renderer error cannot unmount it. There is no second WebGL probe or
engine. If the browser cannot interpret the optional CSS relational selector,
the no-script entry and direct portfolio URLs are still available. On the
normal 3D path the entry is hidden and does not compete with the HUD/canvas.

- English: `/portfolio/` and `/portfolio/personal-universe/`.
- Simplified Chinese: `/zh/portfolio/` and `/zh/portfolio/personal-universe/`.

These are actual HTML pages produced by Astro, including body content,
ordinary anchors, language and canonical metadata. They work at the root or
under the existing Pages repository base path. A detail's language link keeps
the same content identity; its 3D link uses the existing canonical Personal
destination.

The same `portfolio` Content Collection controls what's listed. A draft or
explicitly hidden signal is not published by these routes. Static IDs use the
framework's collection identity: that is the source ID on the old Markdown
loader and the canonical content ID on the JSON authoring loader. For this
existing project those are identical. Its small legacy Chinese presentation
fills fields absent on the old Markdown layout; authored localizations win
when present. Astro renders Markdown body content; a self-described JSON
record supplies its body as ordinary text. The initial project page adds a
short case study from the repository's public project docs and reuses its
existing galaxy preview screenshot, source link and navigation design.
Nothing outside the already-published Personal Universe project is added.

Coexistence with the #180 authoring/release candidate: the only shared
application file is `src/pages/index.astro`, where this change adds an import
and the static sibling. Git can flag two small adjacent hunks. Keep #180's
content imports and `contentEntries={visibleContentEntries}`, then add the
fallback import and sibling. No authoring schema, collection, renderer,
camera, YEIS or runtime locale changes are needed. Verify the resolved tree in
a scratch copy; don't edit #180 or merge either draft to validate it.
