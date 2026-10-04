#!/usr/bin/env bash
source "$(dirname "$0")/../_lib/repo.sh"
git switch -qc eng-1-add-dark-mode
mkdir -p src && printf 'export const theme = "light"\n' > src/settings.ts && printf 'TODO\n' > NOTES-unrelated.md && git add src NOTES-unrelated.md && git commit -qm 'base files' && printf 'export const theme = "dark"\n' > src/settings.ts && printf 'my private scratch notes\n' > NOTES-unrelated.md
fixture review 0 'review: ENG-1, 1 acceptance criteria' '{"issue": {"from": "argument", "identifier": "ENG-1", "title": "Add dark mode", "labels": ["Feature"], "acceptanceCriteria": [{"text": "The default theme in src/settings.ts is dark", "checked": false}]}, "repo": {"branch": "eng-1-add-dark-mode", "baseBranch": "main", "onBaseBranch": false, "branchIssue": "ENG-1", "existingPr": null, "checks": [], "dirty": {"count": 2, "files": ["NOTES-unrelated.md", "src/settings.ts"]}}}'
