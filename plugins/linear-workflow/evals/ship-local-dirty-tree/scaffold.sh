#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
# A shared checkout: pull is set to rebase, local main lags origin by one commit, and another
# session's edits sit uncommitted. `git pull --ff-only` refuses here; `git merge --ff-only` doesn't.
git config pull.rebase true
printf 'changelog\n' > CHANGES.md && git add CHANGES.md && git commit -qm "Update changes" && git push -q origin main
git reset -q --keep HEAD~1
git switch -qc eng-1-add-dark-mode
printf 'dark\n' > theme.css && git add theme.css && git commit -qm "Add dark mode (ENG-1)" && git push -q -u origin eng-1-add-dark-mode
head="$(git rev-parse HEAD)"
git switch -q main
printf 'demo\nwork in progress\n' > README.md && printf 'scratch\n' > notes.txt
fixture ship 0 'ship: ENG-1, verdict ready' '{"issue": {"id": "ENG-1", "from": "argument"}, "merge": {"baseBranch": "main", "mergeMethod": "local", "deleteBranch": false}, "check": {"verdict": "ready", "reasons": [], "pr": {"number": 41, "url": "https://github.com/acme/web/pull/41", "title": "Add dark mode (ENG-1)", "headRefName": "eng-1-add-dark-mode", "headRefOid": "'"$head"'"}, "candidates": []}}'
fixture pr-merged 0 'pr-merged: #41 merged as 9f8e7d6c' '{"issue": "ENG-1", "pr": 41, "landed": true, "state": "MERGED", "mergeCommit": "9f8e7d6c5b4a"}'
fixture transition 0 'transition: ENG-1 In Review → Done, comment posted' '{"issue": "ENG-1", "from": "In Review", "to": "Done", "changed": true, "commented": true, "parent": null}'
