#!/usr/bin/env bash
# Reproduce the committed results from a clean clone, the way a judge will.
#
# Running the evaluation in the working tree proves nothing: it has untracked
# cassettes, a warm .mise, a rendered .env and whatever else the last hour left
# behind. This clones the committed HEAD into a scratch directory, provisions
# the toolchain from scratch, replays the evaluation, and diffs the generated
# results table against the committed one.
#
# Anything that only works in the working tree fails loudly here.
#
#   tools/repro/verify.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n==> %s\n' "$1"; }

say "uncommitted files in the source tree (these will NOT be in the clone)"
git -C "$REPO_ROOT" status --porcelain || true

say "cloning HEAD into $WORK/repo"
git -C "$REPO_ROOT" clone --quiet . "$WORK/repo"
cd "$WORK/repo"

# No API key reaches the clone. If replay is not self-sufficient, this breaks.
unset LLM_API_KEY

say "provisioning the pinned toolchain"
./bin/mise install

say "task setup"
./bin/mise exec -- task setup

say "task validate"
./bin/mise exec -- task validate

say "fixtures rebuild byte-for-byte from their seeds"
./bin/mise exec -- task project:fixtures:verify

say "replaying the evaluation with no API key"
./bin/mise exec -- task project:eval

# Compares the graded outcome of every case, not the rendered table: wall-clock
# timings differ between machines and are not part of the claim.
say "comparing every graded case against the committed results"
./bin/mise exec -- python3 tools/repro/compare_results.py "$REPO_ROOT/results" results
