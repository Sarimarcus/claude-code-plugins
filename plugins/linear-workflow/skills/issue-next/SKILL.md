---
name: issue-next
description: Pick the next Linear issue to work on — the active cycle's unblocked issues ranked by priority and milestone urgency, with an offer to start the top one
---

# issue-next — what to work on next

Read-only. A five-second decision, not a planning session. That is `issue-plan-cycle`.

## 1. Fetch the ranked queue

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.ts" queue --limit 10
```

The CLI does the whole selection deterministically:
- the active cycle (of `teamKey`, else the first of your teams that has one);
- your Todo and In Progress issues in it, minus the blocked ones and anything in review (Linear
  types In Review as "started" too, so the CLI excludes review states by name);
- each in-progress epic replaced by its best unblocked sub-issue (`epic` is set on that entry);
- ranked by priority (Urgent first, no priority last), then milestone target date, then age.

The JSON has `cycle`, `examined`, `candidates`, `droppedBlocked` and `droppedEpics`. Use the order as
given and don't re-rank.

- Exit 1 → if the error is a missing API key or a Linear failure, ask the
  `linear-workflow:linear-manager` agent for the same list (same rules, no descriptions) and say so.
  Otherwise show the error.
- `cycle` is null → stop: `No active cycle. Create one in Linear, or run /linear-workflow:issue-plan-cycle.`
- `candidates` is empty → stop: `Nothing unblocked in cycle #N (<examined> issues, <blocked> blocked). Run /linear-workflow:issue-plan-cycle.`

## 2. Show the top 5

```
ABC-123  Urgent · ends in 2d    <title>
         milestone: <name>      why: highest priority, nearest milestone
ABC-140  High · no due          <title>   [epic: ABC-100 <title>]
         why: next unblocked sub-issue of in-progress epic ABC-100
```

- Show urgency relative to today: `ends in Nd`, `overdue Nd`, or `no due`.
- Give a "why" of one short sentence per row, based on what decided its rank. Don't repeat the
  same reason word for word.
- If `droppedEpics` isn't empty, mention it once after the table.

## 3. Offer to start

`Start ABC-123? [Y/n/<other id>]`. On `Y` or Enter, run `/linear-workflow:issue-start ABC-123`. On
another id, start that one instead. On `n`, stop. If the user declines all five, offer entries 6–10
once, then stop.
