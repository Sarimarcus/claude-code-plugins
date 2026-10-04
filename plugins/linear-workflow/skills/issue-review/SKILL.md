---
name: issue-review
description: Put a Linear issue up for review — run the project's checks, commit, push the branch, open a PR that closes the issue, move it to In Review
argument-hint: "[<ABC-123>]"
disable-model-invocation: true
---

# /linear-workflow:issue-review — open the PR for a Linear issue

Checks → commit → push the feature branch → PR with `Closes ABC-123` → In Review. Nothing gets
merged or deployed. That is `/linear-workflow:issue-ship`.

Running this command authorizes pushing **this issue's feature branch**. It never pushes the base branch.

## 1. Resolve the issue

- An id in `$ARGUMENTS` (`ABC-123`, `123`) → use it.
- No argument → use the issue this session started with `/linear-workflow:issue-start`. Otherwise take the id from
  the current branch name. Otherwise ask `linear-workflow:linear-manager` for your issues in In Progress or In
  Review: use it if there is exactly one, else stop and list the candidates.
- If the id was discovered rather than typed, print `Resolved ABC-123 <title> (from <source>)`
  before anything else.

Read `.claude/linear.json` if it exists (`baseBranch`, `checks`, `teamKey`).

## 2. Pre-flight

- Current branch is the base branch (or `main`/`master`) → stop: there is no branch to review. Run
  `/linear-workflow:issue-start` first or switch to the issue's branch.
- Show `git status --short`. If files that clearly don't belong to this issue are modified, ask
  which ones to include. Never commit them silently.

## 3. Checks

Run the `checks` from `.claude/linear.json`, in order. If none are configured, infer the obvious
ones (e.g. `npm run build` / `npm test` when `package.json` defines them, `make test`, `cargo test`)
and say which ones you ran. Stop on the first failure and show its output. Don't commit.

## 4. Commit and push

- Stage the paths that belong to this issue explicitly. Never `git add -A`.
- Message: a conventional-commit prefix (`fix:` for a Bug label or a "fix" title, otherwise `feat:`/`chore:` by
  judgment) + the issue title + ` (ABC-123)`.
- Skip the commit if there is nothing to commit. A branch that is already ahead still needs the push.
- `git push -u origin HEAD`. Never force-push.

## 5. Open the PR

If a PR already exists for the branch (`gh pr view --json url`), reuse it. Otherwise:

```bash
gh pr create --base "<baseBranch>" --title "<title> (ABC-123)" --body "$(cat <<'BODY'
## Summary

Closes ABC-123.

- <one or two bullets about the change>

## Test plan

- [ ] <one verifiable check>
BODY
)"
```

The `Closes ABC-123` line is what links the PR to the issue, so it is required.

## 6. Linear

Spawn `linear-workflow:linear-manager`:

> Move ABC-123 to "In Review" (no-op if Linear's GitHub integration already did). Add a completion
> comment: Changed: <one line> · Files: see commit `<sha>` · Verified: <checks and their result> ·
> Next: review <PR URL>, then `/linear-workflow:issue-ship ABC-123`.

## 7. Report

```
ABC-123 up for review.
  Branch: <branch> (<sha>)
  PR:     <url>
  Checks: <commands> ✓
  Linear: In Review, comment posted
  Next:   /linear-workflow:issue-ship ABC-123
```
