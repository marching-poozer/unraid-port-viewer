#!/usr/bin/env bash
#
# Build the Slackware-style .txz for the Plugin Disabler plugin and stamp
# plugindisabler.plg with the resulting version + MD5.
#
# Usage:  ./build.sh [VERSION]
# Default VERSION is today's date in YYYY.MM.DD format.

set -euo pipefail

cd "$(dirname "$0")"

NAME="plugindisabler"
VERSION="${1:-$(date +%Y.%m.%d)}"
BUILD="1"
ARCH="noarch"
SRC="src"
PKG="${NAME}-${VERSION}-${ARCH}-${BUILD}"
OUT="archive/${PKG}.txz"
PLG="${NAME}.plg"

if [[ ! -d "$SRC/usr/local/emhttp/plugins/$NAME" ]]; then
  echo "error: expected source tree at $SRC/usr/local/emhttp/plugins/$NAME" >&2
  exit 1
fi

mkdir -p archive

# Stage to a clean temp dir so we can normalise perms and add install/ metadata.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -a "$SRC/." "$STAGE/"
mkdir -p "$STAGE/install"
cat > "$STAGE/install/slack-desc" <<'EOF'
# HOW TO EDIT THIS FILE:
# The "handy ruler" below makes it easier to edit a package description.
# Line up the first '|' above the ':' following the base package name, and
# the '|' on the right side marks the last column you can put a character in.
# You must make exactly 11 lines for the formatting to be correct.  It's also
# customary to leave one space after the ':' except on otherwise blank lines.

       |-----handy-ruler------------------------------------------------------|
plugindisabler: plugindisabler (Unraid plugin)
plugindisabler:
plugindisabler: Adds a "Manage" tab to the native Plugins page for
plugindisabler: temporarily disabling other plugins' GUI pages (renaming
plugindisabler: their .page files), for diagnosing whether a plugin is
plugindisabler: causing a webGUI problem without uninstalling it.
plugindisabler:
plugindisabler:
plugindisabler:
EOF

# Normalise perms: files 644, dirs 755, no execute bit on anything (no scripts shipped).
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +

# Build the txz. Owner root:root so install drops files at the right perms.
( cd "$STAGE" && tar --owner=root --group=root --numeric-owner -cJf - \
    install \
    usr \
) > "$OUT"

MD5="$(md5sum "$OUT" | awk '{print $1}')"
SIZE="$(wc -c < "$OUT")"

# Stamp version + md5 into the .plg.
sed -i \
  -e "s|<!ENTITY version   \"[^\"]*\">|<!ENTITY version   \"${VERSION}\">|" \
  -e "s|<!ENTITY md5       \"[^\"]*\">|<!ENTITY md5       \"${MD5}\">|" \
  "$PLG"

echo "Built:   $OUT  ($SIZE bytes)"
echo "MD5:     $MD5"
echo "Stamped: $PLG -> version=$VERSION md5=$MD5"
