#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture ship 2 'ship: ENG-1, verdict stop' '{"issue": {"id": "ENG-1", "from": "argument"}, "merge": {"baseBranch": "main", "mergeMethod": "merge", "deleteBranch": false}, "check": {"verdict": "stop", "reasons": ["The PR is a draft.", "Failed checks: unit-tests"], "pr": {"number": 41, "url": "https://github.com/acme/web/pull/41", "title": "Add dark mode (ENG-1)", "headRefName": "eng-1-add-dark-mode", "headRefOid": "a1b2c3d4e5"}, "candidates": [{"number": 41, "url": "https://github.com/acme/web/pull/41", "headRefName": "eng-1-add-dark-mode"}]}}'
