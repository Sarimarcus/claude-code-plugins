---
name: cwv-optimize
description: Measure Core Web Vitals (LCP and CLS under real mobile throttling) of the project in the current directory and print a report with fixes ranked by gain; with --fix, apply every mechanical fix behind a keep-or-revert gate
argument-hint: "[--fix [--max N]] [--full] [--profile mobile|desktop|both] [--root <dir>] [--config <file>] [--report-dir <dir>] [--target <name>] [--build]"
---

# cwv-optimize

Measures LCP and CLS with the `chrome-devtools` CLI (real Chrome, 4× CPU, Slow 4G, mobile viewport), prints a
colored report, and ranks the fixes by estimated gain. Default is report only: no files are edited.

Every call is written out in full: a shell variable does not survive between Bash calls.

## 1. Check prerequisites

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cwv.mjs" preflight $ARGUMENTS
```

Exit code 2 means something is missing (`npx`, the `chrome-devtools` CLI, Chrome, a git repo). Show its
message verbatim and stop. Never install anything yourself.

## 2. Report only (no `--fix`)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cwv.mjs" measure --no-color $ARGUMENTS
```

Exit 0 means every page passes, 1 means at least one fails (the report is still printed). Show the report
as printed, in a fenced block. Add nothing except one line: `Run with --fix to apply the mechanical fixes.`

## 3. `--fix`

1. `node "${CLAUDE_PLUGIN_ROOT}/bin/cwv.mjs" measure --no-color $ARGUMENTS` prepares the run. It refuses
   (exit 2) when the project has uncommitted files, because a rejected fix is undone from a snapshot of them.
   Show the refusal and stop. The last stderr line is `cwv: run <dir>`: that is `RUN_DIR`.
2. Spawn the `cwv-optimizer:cwv-optimizer` agent with this prompt, filled in:
   ```
   RUN_DIR: <dir>
   CWV: node "${CLAUDE_PLUGIN_ROOT}/bin/cwv.mjs"
   Root: <project root>
   Apply the proposals following your instructions.
   ```
3. Show the agent's receipt, then the contents of the improvements report it names, in a fenced block.

Edits stay uncommitted in the working tree. Do not commit or push unless the user asks.

## Where things are

- Thresholds, throttling profile and paths: `cwv.config.json` at the project root (defaults in the plugin's
  `data/defaults.json`; the README lists every key).
- Reports: `docs/cwv/improvements-<date>-<profile>.md` and `docs/cwv/history.json` (tracked). Temporary run files
  (`.cwv-runs/`) are deleted when a run ends; a run that stops on an error leaves its folder, and
  `cwv.mjs clean` removes it.
