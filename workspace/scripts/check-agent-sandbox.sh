#!/usr/bin/env bash
set -euo pipefail

RUNTIME="${EXERGY_AGENT_CONTAINER_RUNTIME:-docker}"
IMAGE="${EXERGY_AGENT_CONTAINER_IMAGE:-exergy-agent-workspace:2026-05-24}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/outputs" "$TMP_DIR/inputs" "$TMP_DIR/site-packages"

if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  echo "Container runtime '$RUNTIME' is not installed or not on PATH." >&2
  exit 1
fi

if ! "$RUNTIME" image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Sandbox image '$IMAGE' is not available. Run scripts/build-agent-sandbox.sh first." >&2
  exit 1
fi

"$RUNTIME" run --rm -i \
  --pull=never \
  --network none \
  --memory 512m \
  --cpus 1 \
  --pids-limit 128 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --user "$(id -u):$(id -g)" \
  -e MPLCONFIGDIR=/tmp/matplotlib \
  -v "$TMP_DIR:/workspace:rw" \
  -w /workspace \
  "$IMAGE" \
  python - <<'PY'
from pathlib import Path
import json
import numpy
import pandas
import scipy
import matplotlib

Path("/workspace/outputs").mkdir(exist_ok=True)
Path("/workspace/outputs/check.json").write_text(json.dumps({
    "status": "ready",
    "numpy": numpy.__version__,
    "pandas": pandas.__version__,
    "scipy": scipy.__version__,
    "matplotlib": matplotlib.__version__,
}), encoding="utf-8")
print("agent workspace sandbox ready")
PY

test -s "$TMP_DIR/outputs/check.json"
