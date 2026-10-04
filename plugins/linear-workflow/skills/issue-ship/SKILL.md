---
name: issue-ship
description: Ship a Linear issue — check its PR can land, merge it, verify the merge on GitHub, and close the issue
argument-hint: "[<ABC-123>]"
disable-model-invocation: true
---

# issue-ship — merge the PR and close the issue

Lands the PR that `issue-review` opened. Typing `/linear-workflow:issue-ship <ABC-123>` yourself
authorizes merging **that issue's PR**. That authorization does not extend to anything else. If the
id was resolved rather than typed, confirm it once before merging.

Every CLI call below is written out in full. A shell variable set in one Bash call does not exist in the next.

**Project conventions win.** Where the project's `CLAUDE.md`, `CONTRIBUTING.md` or `.claude/linear.json`
says otherwise (commit style, PR format, checks, branching, state names), follow the project. The
steps below are the defaults.

## 1. Resolve

Same as `issue-review` step 1: the session's issue, else `node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" resolve $ARGUMENTS`.
`node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" config` gives `baseBranch`, `mergeMethod` (default `merge`) and `deleteBranch`.

## 2. Can it land?

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" pr-check ABC-123
```

The CLI makes the decision, so don't second-guess it:

- **Exit 0, `verdict: ready`** → continue.
- **Exit 2, `verdict: wait`** → only checks are still running. Show them and ask whether to wait
  (re-run `pr-check` afterwards) or stop.
- **Exit 2, `verdict: stop`** → show every entry in `reasons` and stop. These cover: no open PR that
  belongs to the issue (its branch or title names it, or its body closes it; a PR that only mentions
  the issue doesn't count), more than one PR, a draft, conflicts, changes requested, failed checks,
  uncommitted local changes on the PR branch, and a local head that differs from the PR head. For
  "no open PR", point to `issue-review`. For several PRs, list `candidates`, ask which one, and run
  `pr-check ABC-123 --pr <number>` on it. Never merge one the CLI hasn't checked.
- **Exit 1** → `gh` failed (not installed or not logged in): show the error and stop.

## 3. Merge

Print `Merging <pr.url> — ABC-123 <title>.`, then use `mergeMethod`:

- `merge` / `squash` / `rebase` →
  `gh pr merge <pr.number> --<method> [--delete-branch]`. If the repo doesn't allow that method, gh
  says so. Ask which allowed method to use instead.
- `local` → merge locally so your own `pre-push` hooks run. Merge the PR head **as GitHub has it**
  (`pr.headRefOid`), not your local branch:
  ```bash
  git fetch origin "<base>" "<pr.headRefName>" && \
  test "$(git rev-parse "origin/<pr.headRefName>")" = "<pr.headRefOid>" && \
  git switch "<base>" && git pull --ff-only && \
  git merge --no-ff "origin/<pr.headRefName>" -m "Merge: <title> (ABC-123)" && git push
  ```
  If this fails, stop and report it. Never force-push. A diverged base is reported as that, not as
  a merge conflict.

## 4. Verify that it landed

Don't trust a command's success output. Ask GitHub:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" pr-merged ABC-123 --pr <pr.number>
```

Exit 0 (`landed: true`, with `mergeCommit`) → continue. Exit 2 → stop before touching Linear, and
report `state`. Then update the local checkout: `git switch <base> && git pull --ff-only`.

## 5. Linear

Write the close-out comment to a temp file, then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" transition ABC-123 Done --comment-file <file>
```

The comment: `- **Changed:** <one line>` · `- **Files:** merge commit <sha>` ·
`- **Verified:** PR <url> merged, checks green` · `- **Next:** shipped`.
This is idempotent, so it works whether or not Linear's GitHub integration already closed the issue.
It also rolls the parent up when no sibling is unfinished; anything not done or canceled counts as
unfinished, In Review included.

## 6. Report

```
ABC-123 shipped.
  PR:     <url> merged (<method>) as <sha>
  Local:  <base> at <sha>
  Linear: Done (<changed or already>), comment posted<, parent ABC-100 rolled up | stays: N unfinished>
```
