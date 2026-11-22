# Reuse-first implementation gate

This project treats external reuse research as a hard prerequisite for implementation.

## Required workflow

1. Research existing libraries, engines, shaders, assets, standards, or reference implementations externally.
2. Write/update docs/reuse-gate/current.json with at least 2 external sources, at least 2 candidates/approaches, license/reuse status, an explicit decision, and exact planned implementation files.
3. While implementation paths are still clean, run npm run reuse:approve. This freezes the research record hash and current Git HEAD into docs/reuse-gate/approval.json.
4. Implement.
5. npm run dev, npm run build, and Git pre-commit all re-check the approval.

If implementation files were modified before approval, approval is refused. If the research record changes after approval, approval becomes invalid. If implementation touches files outside planned_files, the gate blocks.

Machine-enforced paths are src/**, public/**, ordinary scripts/**, and core project config files.

The gate itself intentionally reuses Git hooks and npm lifecycle hooks rather than introducing another policy service.
