#!/usr/bin/env bash
set -euo pipefail

export ENGINE_ROOT="${ENGINE_ROOT:-/app/engine}"
export EXERGY_ANALYST_ROOT="${EXERGY_ANALYST_ROOT:-$ENGINE_ROOT}"
export PYTHON_PATH="${PYTHON_PATH:-/usr/local/bin/python}"
export PYTHONPATH="$ENGINE_ROOT/src:$ENGINE_ROOT:${PYTHONPATH:-}"

mkdir -p \
  "$ENGINE_ROOT/runtime/db" \
  "$ENGINE_ROOT/runtime/sessions" \
  "$ENGINE_ROOT/runtime/projects" \
  "$ENGINE_ROOT/runtime/workspace_jobs" \
  "$ENGINE_ROOT/runtime/workspace_briefs" \
  "$ENGINE_ROOT/runtime/evidence" \
  "$ENGINE_ROOT/runtime/ingestion" \
  "$ENGINE_ROOT/runtime/ptl_briefs"

"$PYTHON_PATH" -c "import exergy_analyst; print('Exergy Analyst Python OK')" >/dev/null

cd /app/nextjs
HOSTNAME="0.0.0.0" PORT="${PORT:-10000}" node server.js
