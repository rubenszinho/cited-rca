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

# Every committed result must be re-executed, not just compared to itself.
# `task project:eval` only re-runs baseline and agent; leaving the other four
# variants as cloned files made the comparison trivially pass on them.
say "clearing the cloned results so nothing is compared against itself"
rm -f results/*.json
# Including the derived paired comparisons: left in place they would be the
# cloned files, and the claims gate would then back the prose with the very
# artifact the clone was supposed to regenerate.
rm -rf results/paired

# Pinned, not inherited. The seed count is what the documents' means are over;
# if the default ever moves, this path must fail loudly rather than quietly
# regenerate different numbers and blame the documents for them.
say "replaying every variant with no API key, at the seed count the docs quote"
SEEDS=6 ./bin/mise exec -- task project:eval
SEEDS=6 ./bin/mise exec -- task project:ablate

# Compares the graded outcome of every case, not the rendered table: wall-clock
# timings differ between machines and are not part of the claim.
say "checking that no document quotes a figure without a run behind it"
./bin/mise exec -- task project:verify:claims

say "checking that every committed review cites a line present in the clone"
./bin/mise exec -- task project:verify:citations

say "comparing every graded case against the committed results"
./bin/mise exec -- python3 tools/repro/compare_results.py "$REPO_ROOT/results" results
