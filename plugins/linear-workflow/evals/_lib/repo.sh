# Sourced by case scaffolds: a git repo with a local `origin`, plus CLI fixtures in .lw/ (git-ignored).
set -euo pipefail
git init -q -b main
git config user.email eval@example.com && git config user.name eval
printf 'demo\n' > README.md && printf '.lw/\n' > .gitignore
git add README.md .gitignore && git commit -qm "init"
mkdir -p .lw
git init -q --bare .lw/origin.git && git remote add origin .lw/origin.git && git push -q -u origin main
# fixture <command> <code> <summary> <out-json>
fixture() { printf '{"out":%s,"summary":"%s","code":%s}\n' "$4" "$3" "$2" > ".lw/$1.json"; }
