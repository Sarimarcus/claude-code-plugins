#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
fixture ship 2 'ship: ENG-1, verdict stop' '{"issue": {"id": "ENG-1", "from": "argument"}, "merge": {"baseBranch": "main", "mergeMethod": "merge", "deleteBranch": false}, "check": {"verdict": "stop", "reasons": ["No open PR for ENG-1. Run issue-review first."], "pr": null, "candidates": []}}'
