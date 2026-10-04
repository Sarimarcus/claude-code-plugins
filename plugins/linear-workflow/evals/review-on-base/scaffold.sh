#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
fixture resolve 0 'resolve: ENG-1' '{"id": "ENG-1", "from": "argument"}'
fixture config 0 'config ok' '{"root": ".", "branch": "main", "baseBranch": "main", "onBaseBranch": true, "existingPr": null, "teamKeys": ["ENG"], "hasApiKey": true, "config": {"mergeMethod": "merge"}}'
