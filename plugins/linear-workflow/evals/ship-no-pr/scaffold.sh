#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture resolve 0 'resolve: ENG-1' '{"id": "ENG-1", "from": "argument"}'
fixture config 0 'config ok' '{"root": ".", "branch": "eng-1-add-dark-mode", "baseBranch": "main", "onBaseBranch": false, "existingPr": null, "teamKeys": ["ENG"], "hasApiKey": true, "config": {"mergeMethod": "merge"}}'
fixture pr-check 2 'pr-check: verdict stop' '{"verdict": "stop", "reasons": ["No open PR for ENG-1. Run issue-review first."], "pr": null, "checks": null, "candidates": []}'
