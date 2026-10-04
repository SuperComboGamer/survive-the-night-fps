#!/usr/bin/env bash
# Hosts a PR's screenshots on their own branch, pr-images-<slug>, so they never land in the code branch.
# usage: .claude/skills/create-pr/push-images.sh <slug> <remote> <image>...
# Images go in flat, by file name (letters, digits, . _ - only). Running it again adds to the branch (a same-named
# image is replaced) with a fast-forward push. It never touches the working tree, the index or the current branch.
# Prints a raw URL per image, for ![](...) in the PR body.
set -euo pipefail
[ $# -ge 3 ] || { sed -n '2,6p' "$0"; exit 1; }
slug=$1 remote=$2
shift 2
branch="pr-images-$slug"

new=""
for f in "$@"; do
  [ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
  name=$(basename "$f")
  case $name in *[!A-Za-z0-9._-]*) echo "rename $name: letters, digits, . _ - only" >&2; exit 1 ;; esac
  new+="100644 blob $(git hash-object -w "$f")	$name"$'\n'
done
names=$(printf '%s' "$new" | cut -f2)
dupes=$(printf '%s\n' "$names" | sort | uniq -d)
[ -z "$dupes" ] || { echo "two images named: $dupes" >&2; exit 1; }

# build on the branch as it is, if it exists
parent=""
kept=""
if [ -n "$(git ls-remote "$remote" "refs/heads/$branch")" ]; then
  git fetch -q "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"
  parent=$(git rev-parse "refs/remotes/$remote/$branch")
  kept=$(git ls-tree "$parent" | NAMES="$names" awk -F'\t' '
    BEGIN { n = split(ENVIRON["NAMES"], a, "\n"); for (i = 1; i <= n; i++) s[a[i]] = 1 }
    NF && !($2 in s)')
fi
tree=$(printf '%s\n%s' "$kept" "$new" | grep -v '^$' | git mktree)
msg="Screenshots for the PR from $(git rev-parse --abbrev-ref HEAD)"
if [ -n "$parent" ]; then
  commit=$(git commit-tree "$tree" -p "$parent" -m "$msg")
else
  commit=$(git commit-tree "$tree" -m "$msg")
fi
git push -q "$remote" "$commit:refs/heads/$branch"

repo=$(git remote get-url "$remote" | sed -E 's#^(ssh://)?git@github\.com[:/]##; s#^https://github\.com/##; s#\.git$##')
for f in "$@"; do echo "https://raw.githubusercontent.com/$repo/$branch/$(basename "$f")"; done
