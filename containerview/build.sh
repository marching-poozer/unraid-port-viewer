#!/usr/bin/env bash
#
# Build the Slackware-style .txz for the Container View plugin and stamp
# containerview.plg with the resulting version + MD5.
#
# Usage:  ./build.sh [VERSION]
# Default VERSION is today's date in YYYY.MM.DD format.

set -euo pipefail

cd "$(dirname "$0")"

NAME="containerview"
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
containerview: containerview (Unraid plugin)
containerview:
containerview: Groups and filters the Docker Containers list and the Dashboard's
containerview: Docker tile by category (container label or category rules),
containerview: with compose stack rows, group/stack actions, a filter bar and a
containerview: picker to update the listed containers. Rows stay native markup
containerview: so other Docker-page plugins keep working. Settings: the cog
containerview: beside Basic/Advanced View on the Docker tab.
containerview:
containerview:
EOF

# Normalise perms: files 644, dirs 755, no execute bit on anything (no scripts shipped;
# the include/*.php endpoints run under PHP-FPM).
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

# The stamp is a sed on exact whitespace: fail loudly if it didn't take, or
# the .plg would ship a stale MD5 and every install would fail its checksum.
grep -q "<!ENTITY version   \"${VERSION}\">" "$PLG" && grep -q "<!ENTITY md5       \"${MD5}\">" "$PLG" || {
  echo "error: could not stamp version/md5 into $PLG (ENTITY lines changed?)" >&2
  exit 1
}

echo "Built:   $OUT  ($SIZE bytes)"
echo "MD5:     $MD5"
echo "Stamped: $PLG -> version=$VERSION md5=$MD5"
