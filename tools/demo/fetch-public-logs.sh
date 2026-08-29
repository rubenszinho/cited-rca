#!/usr/bin/env bash
# Fetch a real, public production log sample and run the workflow on it.
#
# The twelve cases are synthetic so the evaluation can be graded exactly. This
# is the other half of the question: does it work on logs nobody wrote for it?
#
# Source: loghub (https://github.com/logpai/loghub), a collection of system
# logs published for log-analytics research. The samples are real production
# output and are NOT sanitised or reformatted. Cite the loghub paper if you use
# them: https://github.com/logpai/loghub/blob/master/CITATION
#
# The dataset is downloaded, never committed - this repository redistributes
# none of it. Only the generated review is kept, which quotes the handful of
# lines it cites.
#
#   tools/demo/fetch-public-logs.sh [Hadoop|OpenStack|Zookeeper|HDFS]
set -euo pipefail

DATASET="${1:-Hadoop}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$REPO_ROOT/examples/public-${DATASET,,}"
URL="https://raw.githubusercontent.com/logpai/loghub/master/${DATASET}/${DATASET}_2k.log"

mkdir -p "$DEST"
echo "==> fetching $DATASET from loghub"
curl -fsSL -m 60 -o "$DEST/${DATASET,,}.log" "$URL"
echo "    $(wc -l < "$DEST/${DATASET,,}.log") lines"

cat > "$DEST/SOURCE.md" <<SRC
# Source

\`${DATASET,,}.log\` is the \`${DATASET}_2k\` sample from
[loghub](https://github.com/logpai/loghub), real production output published for
log-analytics research. It is not sanitised, anonymised or reformatted.

Not committed to this repository. Fetch it with:

\`\`\`bash
tools/demo/fetch-public-logs.sh ${DATASET}
\`\`\`

Cite the loghub paper if you use the dataset:
https://github.com/logpai/loghub/blob/master/CITATION
SRC

echo "==> running the workflow"
cd "$REPO_ROOT"
./bin/mise exec -- task project:dev -- --dir "$DEST"
