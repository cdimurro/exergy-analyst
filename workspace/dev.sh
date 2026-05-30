#!/bin/bash
# Quick dev server restart — kills old processes and starts fresh
cd "$(dirname "$0")"
fuser -k 3000/tcp 2>/dev/null
fuser -k 3001/tcp 2>/dev/null
sleep 0.5
rm -rf .next
exec npx next dev --turbopack --port 3000
