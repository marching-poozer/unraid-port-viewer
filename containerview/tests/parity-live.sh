#!/usr/bin/env bash
#
# Live native-parity check against the Unraid server: runs the native
# DockerContainers.php and our include/containers.php back-to-back on the box
# (the plugin must be deployed - see dev-deploy.sh), copies both captures to a
# temp dir (never the repo: they hold real container names, IPs and paths)
# and diffs them with tests/parity.js.
#
# Usage:  UNRAID=root@<server> [UNRAID_PORT=22] tests/parity-live.sh
#         (or put those two variables in an uncommitted .unraid.env at the repo root)

set -euo pipefail
cd "$(dirname "$0")/.."

[ -f ../.unraid.env ] && . ../.unraid.env
UNRAID="${UNRAID:?set UNRAID=root@<your server> (or create ../.unraid.env)}"
PORT="${UNRAID_PORT:-22}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ssh -p "$PORT" "$UNRAID" '
  php /usr/local/emhttp/plugins/dynamix.docker.manager/include/DockerContainers.php > /tmp/cv-native.html &&
  php /usr/local/emhttp/plugins/containerview/include/containers.php > /tmp/cv-feed.json'
scp -q -P "$PORT" "$UNRAID:/tmp/cv-native.html" "$UNRAID:/tmp/cv-feed.json" "$TMP/"
ssh -p "$PORT" "$UNRAID" 'rm -f /tmp/cv-native.html /tmp/cv-feed.json'

node tests/parity.js "$TMP/cv-feed.json" "$TMP/cv-native.html"
