# Personal Universe — Long-Running Implementation Agents

These are builder prompts for parallel long-running agents. Each role owns a large implementation domain and must keep doing real work: sync latest main, satisfy Machine Reuse Gate, edit code, test, push a long-lived branch, update a PR, absorb new main changes, and continue until its domain is substantially productized.

Launch with a short instruction such as:

> Read `docs/agents/03-scale-input-product-feel.md` from `Su-long-ai/personal-universe` and execute it continuously.

Global rules:

- Builders, not reviewers. No review-only/report-only agents.
- Tests are evidence, not the product. Fix real product defects directly.
- Every new protected implementation unit needs existing approval coverage or new formal reuse research + approval.
- Prefer existing/native/external capability before project-owned machinery.
- Pinned reusable YEIS boundary remains `e52056897364e060fbd6d00951628f163b57d7a1`. Current upstream AGPL may be observed conceptually but not copied, rewritten, cherry-picked, or imported.
- Never create a second navigation authority, camera authority, renderer authority, wheel owner, or duplicate scale state machine.
- Periodically fetch and integrate latest `origin/main`; do not build for long on stale baselines.
- Preserve schema-3 approval ancestry; avoid squash/rebase when it would destroy required provenance.
- If another live agent owns the same surface, coordinate via narrow contracts rather than duplicating implementation.
- Do not stop after one small bug or one green test.

Roles:

1. [Native Scale / YEIS](./01-native-scale-yeis.md)
2. [World Renderer Continuity](./02-world-renderer-continuity.md)
3. [Scale Input / Product Feel](./03-scale-input-product-feel.md)
4. [WebGL / Performance / Release Engineering](./04-webgl-performance-release-engineering.md)
5. [Release / Visual Acceptance](./05-release-visual-acceptance.md)
6. [Surface / World Productization](./06-surface-world-productization.md)

The lead/integration line owns cross-domain merge order, conflict resolution, combined release candidates, and final merge to main.
