#!/usr/bin/env bash
# stop-validate-gate.sh - block an agent from finishing on a broken tree
#
# Registered as a Stop hook in .claude/settings.json. When the agent tries
# to end its turn with uncommitted source changes, this runs `task validate`
# and, on failure, feeds the output back so the agent fixes it rather than
# reporting done. "ALWAYS run validate" as a rule an agent can skip becomes
# a rule it cannot.
#
# Exit codes are the Claude Code hook contract:
#   0  allow the agent to stop
#   2  block: stderr is returned to the agent as the reason
set -uo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$repo_root" || exit 0

payload="$(cat)"

# The gate itself runs while the agent works. Without this, a validate
# failure would re-trigger the hook on the next stop, forever.
case "$payload" in
  *'"stop_hook_active": true'* | *'"stop_hook_active":true'*) exit 0 ;;
esac

changed="$(
  {
    git diff --name-only HEAD
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u
)"

[ -z "$changed" ] && exit 0

# Documentation-only turns do not need the full gate.
if ! printf '%s\n' "$changed" | grep -qvE '\.(md|txt|json|ya?ml|toml)$'; then
  exit 0
fi

if ! output="$(./bin/mise exec -- task validate 2>&1)"; then
  {
    echo "task validate failed. Fix it before finishing:"
    echo
    printf '%s\n' "$output" | tail -40
  } >&2
  exit 2
fi

exit 0
