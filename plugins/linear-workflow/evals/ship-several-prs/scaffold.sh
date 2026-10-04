#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture resolve 0 'resolve: ENG-1' '{"id": "ENG-1", "from": "argument"}'
fixture config 0 'config ok' '{"root": ".", "branch": "eng-1-add-dark-mode", "baseBranch": "main", "onBaseBranch": false, "existingPr": null, "teamKeys": ["ENG"], "hasApiKey": true, "config": {"mergeMethod": "merge"}}'
fixture pr-check 2 'pr-check: verdict stop' '{"verdict": "stop", "reasons": ["2 open PRs belong to ENG-1; pick one with --pr."], "pr": null, "checks": null, "candidates": [{"number": 41, "url": "https://github.com/acme/web/pull/41", "headRefName": "eng-1-add-dark-mode"}, {"number": 44, "url": "https://github.com/acme/web/pull/44", "headRefName": "eng-1-dark-mode-v2"}]}'
