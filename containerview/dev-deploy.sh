#!/usr/bin/env bash
#
# Development deploy: copies the plugin source straight into
# /usr/local/emhttp/plugins/containerview on the Unraid box. That's RAM - it's
# gone on reboot, and there is no .plg install behind it. Use build.sh and the
# .plg for a real install.
#
# Usage:  UNRAID=root@<server> [UNRAID_PORT=22] ./dev-deploy.sh
#         (or put those two variables in an uncommitted .unraid.env at the repo root)

set -euo pipefail
cd "$(dirname "$0")"

[ -f ../.unraid.env ] && . ../.unraid.env
UNRAID="${UNRAID:?set UNRAID=root@<your server> (or create ../.unraid.env)}"
PORT="${UNRAID_PORT:-22}"

tar -C src/usr/local/emhttp/plugins -cf - containerview |
  ssh -p "$PORT" "$UNRAID" 'tar -xf - -C /usr/local/emhttp/plugins/ && chown -R root:root /usr/local/emhttp/plugins/containerview'
echo "deployed to $UNRAID:/usr/local/emhttp/plugins/containerview (RAM - lost on reboot)"
