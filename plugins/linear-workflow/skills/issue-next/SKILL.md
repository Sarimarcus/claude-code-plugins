---
name: issue-next
model: haiku
description: Pick the next Linear issue to work on — the active cycle's unblocked issues ranked by priority and milestone urgency, with an offer to start the top one
---

# issue-next — what to work on next

Read-only. A five-second decision, not a planning session. That is `issue-plan-cycle`.

## 1. Fetch the ranked queue

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" queue --limit 10
```

The CLI does the whole selection and ranking deterministically: the active cycle (of `teamKey`, else
the first of your teams that has one); your Todo and In Progress issues in it, minus blocked ones and
anything in review; each in-progress epic replaced by its best unblocked sub-issue; ranked by
priority, then milestone date, then age.

The JSON has `cycle` (`number`, `team`, `endsAt`), `examined`, `blocked` (a count), `droppedEpics` and
`candidates`, each `{rank, id, title, priority, urgency, state, milestone, epic}`.

- Exit 1 → if the error is a missing API key or a Linear failure, ask the
  `linear-workflow:linear-manager` agent for the same list (same rules, no descriptions) and say so.
  Otherwise show the error.
- `cycle` is null → stop: `No active cycle. Create one in Linear, or run /linear-workflow:issue-plan-cycle.`
- `candidates` is empty → stop: `Nothing unblocked in cycle #N (<examined> issues, <blocked> blocked). Run /linear-workflow:issue-plan-cycle.`

## 2. Show the top 5, exactly in `rank` order

**Never re-sort.** `rank` 1 comes first even when a lower row has a higher priority: the CLI already
weighed priority against milestone dates. Print `priority` and `urgency` exactly as given.

```
ENG-9  Medium · overdue 3d   <title>   [epic: ENG-2]
       milestone: <name>     why: <one short sentence>
ENG-7  Urgent · no due       <title>
       why: <one short sentence>
```

- The "why" is your one sentence on why it sits at that rank (e.g. "overdue milestone", "highest
  priority with no deadline"). Don't repeat the same reason word for word.
- If `droppedEpics` isn't empty, mention it once after the table.

## 3. Offer to start

`Start <rank 1 id>? [Y/n/<other id>]` (always the `rank` 1 issue). On `Y` or Enter, run `/linear-workflow:issue-start ABC-123`. On
another id, start that one instead. On `n`, stop. If the user declines all five, offer entries 6–10
once, then stop.
