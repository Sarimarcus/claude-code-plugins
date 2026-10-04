#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture resolve 0 'resolve: ENG-1' '{"id": "ENG-1", "from": "argument"}'
fixture config 0 'config ok' '{"root": ".", "branch": "eng-1-add-dark-mode", "baseBranch": "main", "onBaseBranch": false, "existingPr": null, "teamKeys": ["ENG"], "hasApiKey": true, "config": {"mergeMethod": "merge"}}'
fixture pr-check 2 'pr-check: verdict wait' '{"verdict": "wait", "reasons": ["Checks still running: e2e"], "pr": {"number": 41, "url": "https://github.com/acme/web/pull/41", "title": "Add dark mode (ENG-1)", "headRefName": "eng-1-add-dark-mode", "headRefOid": "a1b2c3d4e5", "baseRefName": "main", "isDraft": false, "mergeable": "MERGEABLE", "reviewDecision": "APPROVED", "statusCheckRollup": []}, "checks": {"total": 1, "failed": [], "pending": ["e2e"]}, "candidates": []}'
