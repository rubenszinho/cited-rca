#!/usr/bin/env bash
# Mirror Claude Code session logs into the submission repo.
#
# Trajectories are a graded deliverable and cannot be reconstructed after the
# fact: a crash, a /clear, or a session rotation loses them. This runs on a loop
# so the repo always holds a recent copy.
#
# Usage:
#   tools/trajectory/capture.sh          # one-shot sync
#   tools/trajectory/capture.sh --loop   # sync every 300s until killed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$REPO_ROOT/trajectories/raw"
CLAUDE_PROJECTS="${CLAUDE_PROJECTS:-$HOME/.claude/projects}"
INTERVAL="${CAPTURE_INTERVAL:-300}"

# Every project dir whose slug mentions this hackathon. Covers the prep session
# (run from .../hackerearth) and the sprint session (.../hackerearth/frontier),
# including their subagents/ subdirectories.
PATTERN="${CAPTURE_PATTERN:-*hackerearth*}"

sync_once() {
    local found=0
    mkdir -p "$DEST"
    for dir in "$CLAUDE_PROJECTS"/$PATTERN; do
        [ -d "$dir" ] || continue
        found=1
        rsync -a --delete "$dir/" "$DEST/$(basename "$dir")/"
    done
    if [ "$found" -eq 0 ]; then
        echo "warn: no project dir matched $CLAUDE_PROJECTS/$PATTERN" >&2
    fi
    date -u +"%Y-%m-%dT%H:%M:%SZ synced $(find "$DEST" -name '*.jsonl' | wc -l) jsonl files" \
        | tee -a "$REPO_ROOT/trajectories/capture.log"
}

if [ "${1:-}" = "--loop" ]; then
    while true; do
        sync_once || echo "sync failed, retrying" >&2
        sleep "$INTERVAL"
    done
else
    sync_once
fi
