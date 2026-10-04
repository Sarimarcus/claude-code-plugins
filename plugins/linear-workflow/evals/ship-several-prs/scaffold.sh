#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture ship 2 'ship: ENG-1, verdict stop' '{"issue": {"id": "ENG-1", "from": "argument"}, "merge": {"baseBranch": "main", "mergeMethod": "merge", "deleteBranch": false}, "check": {"verdict": "stop", "reasons": ["2 open PRs belong to ENG-1; pick one with --pr."], "pr": null, "candidates": [{"number": 41, "url": "https://github.com/acme/web/pull/41", "headRefName": "eng-1-add-dark-mode"}, {"number": 44, "url": "https://github.com/acme/web/pull/44", "headRefName": "eng-1-dark-mode-v2"}]}}'
