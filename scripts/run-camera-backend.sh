#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GREENWAVE — camera perception backend (Step 8)
#
# IMPORTANT: this must be run from the repository ROOT, not from backend/.
# The backend is a Python package (backend.main:app), so we must load it as
# a package — NOT as plain `main:app` — and the project root must be on
# PYTHONPATH so the relative imports inside backend/ resolve.
#
# Correct invocation:
#   ./scripts/run-camera-backend.sh
#
# Common mistake that breaks it (do NOT use):
#   cd backend && python3.11 -m uvicorn main:app ...
#   -> ImportError: attempted relative import with no known parent package
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

cd "$ROOT"

export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

echo "[GREENWAVE] starting camera backend from: $ROOT"
echo "[GREENWAVE] PYTHONPATH=$PYTHONPATH"
echo "[GREENWAVE] command: python3.11 -m uvicorn backend.main:app --host 127.0.0.1 --port 8099"

# If a previous instance is already bound to 8099, leave it alone rather than
# spawning a duplicate. This script is mainly for first start / recovery.
if command -v lsof >/dev/null 2>&1; then
  if lsof -i :8099 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[GREENWAVE] port 8099 already listening — assuming backend is up"
    exit 0
  fi
fi

exec python3.11 -m uvicorn backend.main:app \
  --host 127.0.0.1 \
  --port 8099 \
  --log-level info
