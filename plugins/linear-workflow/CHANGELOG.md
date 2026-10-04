# Changelog

## 0.1.0 — unreleased

First public release.

- Skills: `issue-next`, `issue-start`, `issue-review`, `issue-ship`, `issue-plan-cycle`
- CLI `bin/linear-workflow.ts`: `config`, `resolve`, `issue`, `queue`, `plan-cycle`, `transition`,
  `set-cycle`, `pr-check`, `pr-merged`. The skills' deterministic steps run here instead of through the LLM
- Agent: `linear-manager`, for issue creation and as the CLI's fallback
- Evals for the skills' guardrails (9 cases), run against canned CLI answers
  (`EVAL_LINEAR_WORKFLOW_FIXTURES`)
- `lib/`: code shared by the CLI and the mod (Linear client, ranking, roll-up, PR verdicts)
- Mod: band and details pane for the current issue, `/linear` command, list of other sessions,
  conflict and scope-drift warnings, issue held when another session moves the shared branch
