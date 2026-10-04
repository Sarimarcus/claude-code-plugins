---
name: issue-ship
description: Ship a Linear issue — merge its reviewed PR, update the base branch locally, verify the merge landed, and close the issue
argument-hint: "[<ABC-123>]"
disable-model-invocation: true
---

# /linear-workflow:issue-ship — merge the PR and close the issue

Lands the PR that `/linear-workflow:issue-review` opened. Typing `/linear-workflow:issue-ship <ABC-123>` yourself authorizes merging
**that issue's PR**. That authorization does not extend to anything else. If the id was
auto-discovered rather than typed, confirm it once before merging.

## 1. Resolve the issue

Same as `/linear-workflow:issue-review` step 1: the argument, then this session's issue, then the branch name, then
Linear. Read `.claude/linear.json` (`baseBranch`, `mergeMethod`, `deleteBranch`).

## 2. Find the PR and check that it can land

```bash
gh pr list --state open --search "ABC-123 in:title,body" --json number,url,headRefName,isDraft,mergeable,reviewDecision
```

Fall back to `gh pr view <current branch>`. Then:

- **No open PR** → stop: `No open PR for ABC-123. Run /linear-workflow:issue-review ABC-123 first.` Never merge
  unreviewed work by pushing to the base branch.
- **More than one** → list them and ask which to merge.
- **Draft, conflicts (`mergeable: CONFLICTING`), or changes requested** → stop and say which.
- **Uncommitted or unpushed changes on the PR branch** → stop: they are not in the PR. Run
  `/linear-workflow:issue-review` again to push them.
- Show the PR's check status (`gh pr checks <number>`). If checks failed, stop. If they are still
  pending, ask whether to wait.

## 3. Merge

Print `Merging <PR url> — ABC-123 <title>.`, then use `mergeMethod` (default `merge`):

- `merge` / `squash` / `rebase` →
  `gh pr merge <number> --<method> [--delete-branch]`. If the repo doesn't allow that method, gh
  says so. Ask which allowed method to use instead.
- `local` → merge locally so your own `pre-push` hooks run:
  ```bash
  git switch <base> && git pull --ff-only && git merge --no-ff <head> -m "Merge: <title> (ABC-123)" && git push
  ```
  If this fails, stop and report it. Never force-push. A diverged base is reported as that, not as a
  merge conflict.

## 4. Verify that it landed

Don't trust a command's success output. Check the remote:

```bash
gh pr view <number> --json state,mergeCommit -q '.state + " " + (.mergeCommit.oid // "")'
```

`MERGED` with a commit → continue. Anything else → stop before touching Linear, and say what state
the PR is in.

Then update the local checkout: `git switch <base> && git pull --ff-only`.

## 5. Linear

Spawn `linear-workflow:linear-manager`:

> Move ABC-123 to "Done" (no-op if Linear's GitHub integration already did). Add a comment:
> Changed: <one line> · Files: merge commit `<sha>` · Verified: PR <url> merged, checks <status> ·
> Next: shipped. If ABC-123 is a sub-issue, roll its parent up when no sibling is unfinished.

## 6. Report

```
ABC-123 shipped.
  PR:     <url> merged (<method>) as <sha>
  Local:  <base> at <sha>
  Linear: Done, comment posted
```
