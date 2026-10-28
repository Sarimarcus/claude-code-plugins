# Changelog

## 0.1.0 — 2026-10-28

- First version: `/cwv-optimizer:cwv-optimize` measures LCP and CLS under real mobile (4× CPU, Slow 4G) or desktop throttling
  through the pinned `chrome-devtools` CLI, prints a colored report with ranked fixes, and with `--fix` has the
  `cwv-optimizer:cwv-optimizer` agent apply them behind a keep-or-revert gate
- The runner rejects unknown flags and non-numeric `--max`/`--days` with exit 2
- Insight details are fetched once per insight and page instead of once per trace
- `evals/refuses-bad-flag` checks that the skill stops at the runner's usage error
- `--fix` rebuilds before measuring so the baseline matches what `verify` rebuilds; `skip` reports left-over untracked files; `clean` keeps a run with an active proposal; the root is resolved through symlinks; a non-stable Chrome is passed to the daemon explicitly
- Re-tracing a failing page reuses its first trace as sample one (`traces.confirm` is the total); protected globs use `path.matchesGlob`
