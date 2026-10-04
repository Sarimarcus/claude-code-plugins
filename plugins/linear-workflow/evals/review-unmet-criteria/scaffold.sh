#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
printf 'Dark mode coming soon.\n' >> README.md
fixture review 0 'review: ENG-1, 2 acceptance criteria' '{"issue": {"from": "argument", "identifier": "ENG-1", "title": "Add dark mode", "labels": ["Feature"], "acceptanceCriteria": [{"text": "A theme toggle exists in src/settings.ts", "checked": false}, {"text": "The choice persists in localStorage under acme-theme", "checked": false}]}, "repo": {"branch": "eng-1-add-dark-mode", "baseBranch": "main", "onBaseBranch": false, "branchIssue": "ENG-1", "existingPr": null, "checks": [], "dirty": {"count": 1, "files": ["README.md"]}}}'
