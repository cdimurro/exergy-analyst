#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="${EXERGY_AGENT_CONTAINER_RUNTIME:-docker}"
IMAGE="${EXERGY_AGENT_CONTAINER_IMAGE:-exergy-agent-workspace:2026-05-24}"

if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  echo "Container runtime '$RUNTIME' is not installed or not on PATH." >&2
  echo "Install Docker/Podman or enable Docker Desktop WSL integration, then rerun this script." >&2
  exit 1
fi

"$RUNTIME" build \
  -f "$ROOT_DIR/docker/agent-workspace.Dockerfile" \
  -t "$IMAGE" \
  "$ROOT_DIR"

"$ROOT_DIR/scripts/check-agent-sandbox.sh"
