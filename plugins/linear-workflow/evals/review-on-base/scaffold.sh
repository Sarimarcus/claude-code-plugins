#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
fixture review 0 'review: ENG-1' '{"issue": {"from": "argument", "identifier": "ENG-1", "title": "Add dark mode", "labels": ["Feature"], "acceptanceCriteria": []}, "repo": {"branch": "main", "baseBranch": "main", "onBaseBranch": true, "branchIssue": null, "existingPr": null, "checks": null, "dirty": {"count": 0, "files": []}}}'
