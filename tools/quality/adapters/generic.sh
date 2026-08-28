#!/usr/bin/env bash
# generic.sh - adapter that measures no functions
#
# Emits nothing, so the scope is gated on file_lines alone. Use it for
# languages no parser supports, for config/SQL/template trees, or as the
# starting point for a real adapter.
#
# CONTRACT (see tools/quality/collect.py):
#   invoked as: generic.sh <file> <file> ...   (sorted, absolute paths)
#   stdout:     one JSON object per line:
#     {"file": "src/a.py", "function": "parse", "nloc": 12, "ccn": 3, "params": 2}
#   exit 0 on success; any other status fails the run.
set -euo pipefail
exit 0
