# cwv-optimizer

Core Web Vitals for a static site, measured the way a visitor's browser sees it: real Chrome with CPU and
network throttling, driven through the [`chrome-devtools`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
CLI. No Lighthouse score, no simulated throttling.

- `/cwv-optimizer:cwv-optimize` prints a report: LCP and CLS per page against the thresholds, where the LCP time goes, and the
  fixes ranked by estimated gain.
- `/cwv-optimizer:cwv-optimize --fix` hands the mechanical fixes to the `cwv-optimizer:cwv-optimizer` agent. It edits source files only; the
  runner rebuilds, re-measures and **keeps or reverts** each edit by itself.

Run it from the project root (or pass `--root`). It builds the site, serves the build folder on a free port with
brotli and CDN-style caching, and traces one page per template.

## Install

```
/plugin marketplace add Sarimarcus/claude-code-plugins
/plugin install cwv-optimizer@sarimarcus
```

Needs Node 22+, Chrome or Chromium, and a git repository. The plugin never installs anything: if `npx`, the
pinned `chrome-devtools` CLI or Chrome is missing, it stops with exit code 2 and says which command to run.

## Commands

```bash
node bin/cwv.mjs preflight                 # check prerequisites
node bin/cwv.mjs measure [--full] [--profile mobile|desktop|both] [--build] [--json]
node bin/cwv.mjs measure --fix [--max N]   # rebuild, then prepare a fix run (needs a clean working tree)
node bin/cwv.mjs next|skip|verify|finish|report --run <dir>   # the loop the agent drives; report reprints the run's first report
node bin/cwv.mjs clean [--days N]          # remove leftover run folders
```

Other flags: `--root <dir>`, `--config <file>`, `--report-dir <dir>`, `--target <name>`, `--no-color`,
`--keep-artifacts`. Output is colored on a terminal, plain when piped or with `NO_COLOR`.

## The gate

On every page, under the chosen profile: **LCP ≤ 2500 ms** and **CLS < 0.01**, from the exact value in the saved
trace (not the rounded one DevTools prints). A page within 20 % of a limit is "at risk". One trace per page
first; failing and at-risk pages are traced 3 times and the median is used.

A fix is **kept** when the median LCP of the affected pages improves by at least 150 ms, or a CLS fix lowers CLS by
at least `keepMinClsGain` (or brings a failing page under its limit), and nothing gets worse. `finish` re-measures
every page after a kept fix, since a layout edit can reach any page. Otherwise only the files the agent touched are restored (from a
snapshot taken before the edit, so your own uncommitted work is never touched). A fix that edits a protected
path is reverted at once. The loop stops after 2 consecutive reverts.

All numbers live in `cwv.config.json`; this README says what they mean, the file holds the values.

## `cwv.config.json`

Optional, at the project root. Anything omitted uses `data/defaults.json`.

| Key | Meaning |
| --- | --- |
| `thresholds.lcpMaxMs`, `thresholds.clsMax` | the gate |
| `thresholds.keepMinGainMs` | smallest LCP gain a fix must show (about the measured run-to-run spread) |
| `thresholds.keepMinClsGain` | smallest CLS drop that keeps a CLS fix; a CLS rise of more than this on a failing page reverts any fix |
| `thresholds.atRiskMargin` | fraction below a limit that counts as at risk |
| `defaultProfile`, `profiles.<name>` | CPU slowdown, network preset and viewport per profile (`mobile`, `desktop`) |
| `traces.initial`, `traces.confirm` | traces per page, first pass and for failing pages |
| `build.command`, `build.distDir` | how to build; the output folder (auto-detected: `dist`, `build`, `out`, `.output/public`) |
| `pages.maxPages`, `pages.include` | cap on pages traced in `--full` (one per template: first path segment, from the sitemap or the build folder), and paths to always trace (for example a listing whose items use an irregular plural) |
| `fix.maxConsecutiveReverts`, `fix.maxFixes` | loop limits |
| `reportDir`, `runsDir` | where reports go (default `docs/cwv`) and where temporary runs live (`.cwv-runs`, add it to `.gitignore`) |
| `recipes` | extra recipe files (component names, ownership rules); they win over `recipes/default.md` |
| `classification` | extra insight classification and vetoes, merged over `data/classification.json` |
| `protectedGlobs` | paths a fix may never edit |

Reports: `docs/cwv/improvements-<date>-<profile>.md` and `docs/cwv/history.json` are written when a `--fix` run
finishes. Temporary files (traces, insight details, snapshots, run state) are deleted at the end of every run; a run that stops on an error leaves its folder for `clean`. A new untracked file a rejected fix created is never deleted: it is listed in the `verify` output. Run `--fix` in a checkout no other session is editing: a file another session creates during a fix cannot be told apart from the fix's own.

## Notes

- Insight names and estimates come from DevTools and vary from trace to trace, so insights are merged across a
  page's traces. Estimates are guides; the measured gain decides.
- `INP` cannot be measured in a lab trace and is not gated.
