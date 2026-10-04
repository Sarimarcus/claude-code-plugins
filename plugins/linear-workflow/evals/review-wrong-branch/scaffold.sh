#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-2-billing-page
printf 'billing\n' >> README.md
fixture review 0 'review: ENG-1; branch eng-2-billing-page names ENG-2' '{"issue": {"from": "argument", "identifier": "ENG-1", "title": "Add dark mode", "labels": ["Feature"], "acceptanceCriteria": []}, "repo": {"branch": "eng-2-billing-page", "baseBranch": "main", "onBaseBranch": false, "branchIssue": "ENG-2", "existingPr": null, "checks": null, "dirty": {"count": 1, "files": ["README.md"]}}}'
