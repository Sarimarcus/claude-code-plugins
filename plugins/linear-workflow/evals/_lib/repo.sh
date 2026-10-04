# Sourced by case scaffolds: a git repo plus CLI fixtures in .lw/ (git-ignored).
set -euo pipefail
git init -q -b main
git config user.email eval@example.com && git config user.name eval
printf 'demo\n' > README.md && printf '.lw/\n' > .gitignore
git add README.md .gitignore && git commit -qm "init"
mkdir -p .lw
# fixture <command> <code> <summary> <out-json>
fixture() { printf '{"out":%s,"summary":"%s","code":%s}\n' "$4" "$3" "$2" > ".lw/$1.json"; }
