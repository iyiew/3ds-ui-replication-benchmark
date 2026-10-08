# Benchmark repository instructions

This is a benchmark definition, NOT an already-completed Nintendo 3DS replica.

When explicitly asked to run the benchmark, read `PROMPT.md`, the three images
in `references/`, and `benchmark.json`. Implement only inside `starter/`.
Do not modify reference images, prompts, evaluator scripts, scoring rules,
or baseline configuration to make an implementation pass.

The placeholder in `starter/` is intentional. Do not implement the task merely
because this repository was opened, reviewed, or its infrastructure was edited.
No existing solution or theme-switching extension belongs in the baseline.

Use React, TypeScript and CSS with the supplied locked starter dependencies.
Do not load reference screenshots as a screen, shell, or UI background.
Small individual icon assets are allowed; document any cropping in
`starter/ASSET_NOTES.md`.

Do not delegate to other agents during a benchmark run unless the evaluator
explicitly permits the same delegation capability for every candidate. Report
actual tools, model version, reasoning setting and budget to the evaluator.
