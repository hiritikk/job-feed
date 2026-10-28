#!/usr/bin/env bash
# Backup for GitHub's own schedule: starts the "refresh" workflow when it has not started for 25+ minutes.
# Run it every few minutes from launchd/cron; it does nothing when a run is recent, so the two never double up.
set -euo pipefail

REPO="${REPO:-hiritikk/job-feed}"
GH="${GH:-gh}"
MIN_AGE_SECONDS=1500

last="$("$GH" run list --repo "$REPO" --workflow refresh.yml --limit 1 --json createdAt --jq '.[0].createdAt // empty')"
if [ -n "$last" ]; then
  started="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$last" +%s 2>/dev/null || date -u -d "$last" +%s)"
  age=$(( $(date -u +%s) - started ))
else
  age=999999
fi

if [ "$age" -ge "$MIN_AGE_SECONDS" ]; then
  "$GH" workflow run refresh.yml --repo "$REPO"
  echo "triggered (last run ${age}s ago)"
else
  echo "skipped (last run ${age}s ago)"
fi
