#!/usr/bin/env bash
# Publishes jobs.json and state.json from $DATA_DIR to the orphan `data` branch as ONE force-pushed commit,
# so the branch never accumulates history. The site reads jobs.json from raw.githubusercontent.com/<repo>/data/.
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
[ -f "$DATA_DIR/jobs.json" ] || { echo "publish-data: $DATA_DIR/jobs.json not found" >&2; exit 1; }
[ -f "$DATA_DIR/state.json" ] || { echo "publish-data: $DATA_DIR/state.json not found" >&2; exit 1; }

if [ -n "${PUBLISH_URL:-}" ]; then
  URL="$PUBLISH_URL"
elif [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
else
  URL="$(git remote get-url origin)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DATA_DIR/jobs.json" "$DATA_DIR/state.json" "$TMP/"
# Vercel builds every branch it sees; this one holds only data, so tell it not to (otherwise each run emails "Preview deployment failed").
printf '{\n  "git": { "deploymentEnabled": false }\n}\n' > "$TMP/vercel.json"
git -C "$TMP" init -q -b data
git -C "$TMP" add jobs.json state.json vercel.json
git -C "$TMP" -c user.name="job-feed bot" -c user.email="job-feed@users.noreply.github.com" commit -q -m "data: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$TMP" push -q --force "$URL" data:data
echo "published $(wc -c < "$DATA_DIR/jobs.json" | tr -d ' ') bytes to branch data"
