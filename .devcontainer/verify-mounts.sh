#!/usr/bin/env bash
# Verify the shared Claude home and knowledge vault are mounted correctly.
# Implements the checks in /knowledge/deployment/shared-claude-home-mounts.md
# The failure this catches is silent: an empty Claude home looks like a fresh
# install, not a broken mount.
set -uo pipefail

ws="${WORKSPACE_FOLDER:-/home-mgmt}"
fail=0
note() { printf '  %s\n' "$*"; }
ok()   { printf 'ok   %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; fail=1; }

echo "== workspace =="
if [ "$PWD" = "$ws" ] || [ -d "$ws" ]; then
  ok "workspace is $ws"
  case "$ws" in
    /workspace|/workspace/*)
      bad "workspaceFolder is the default /workspace"
      note "memory key collides with every other container on the default."
      note "set workspaceFolder AND the compose mount target to /home-mgmt." ;;
  esac
else
  bad "expected workspace at $ws"
fi

echo "== two distinct bind mounts =="
grep -qE ' /home/node/\.claude ' /proc/mounts && ok "/home/node/.claude is a mount" \
  || bad "/home/node/.claude is NOT a mount — CLAUDE_KB probably expanded empty"
grep -qE ' /knowledge ' /proc/mounts && ok "/knowledge is a mount" \
  || bad "/knowledge is NOT a mount — check .devcontainer/.env"

echo "== claude home is not the repo's own .claude =="
if [ -e "$ws/.claude" ]; then
  a=$(stat -c '%d:%i' "$ws/.claude" 2>/dev/null)
  b=$(stat -c '%d:%i' /home/node/.claude 2>/dev/null)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then
    bad "$ws/.claude and /home/node/.claude are the same inode"
    note "the repo .claude IS the live home — the state the mount layout exists to avoid."
  else
    ok "distinct inodes ($a vs $b)"
  fi
else
  ok "no repo-local .claude (project scope picked up automatically if added)"
fi

echo "== contents =="
if [ -d /home/node/.claude/projects ]; then
  ok "projects/: $(ls -1 /home/node/.claude/projects 2>/dev/null | tr '\n' ' ')"
  [ -d /home/node/.claude/projects/-home-mgmt ] \
    && ok "memory key -home-mgmt present" \
    || note "memory key -home-mgmt not created yet (appears after the first session)"
else
  bad "/home/node/.claude/projects missing — Claude home is empty"
fi

if [ -d /knowledge ] && [ -f /knowledge/index.md ]; then
  ok "/knowledge/index.md readable"
  if touch /knowledge/.write-test 2>/dev/null; then
    rm -f /knowledge/.write-test; ok "/knowledge is writable"
  else
    bad "/knowledge is read-only"
  fi
else
  bad "/knowledge/index.md not found"
fi

echo
[ "$fail" -eq 0 ] && echo "All mount checks passed." \
  || echo "Mount checks FAILED — see /knowledge/deployment/shared-claude-home-mounts.md"
exit "$fail"
