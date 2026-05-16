#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

TAG="${TAG:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TAG" ]]; then
	echo "TAG or GITHUB_REF_NAME must be set" >&2
	exit 1
fi

VERSION="${VERSION:-${TAG#v}}"
REPOSITORY="${REPOSITORY:-${GITHUB_REPOSITORY:-}}"
if [[ -z "$REPOSITORY" ]]; then
	echo "REPOSITORY or GITHUB_REPOSITORY must be set" >&2
	exit 1
fi

PACKAGE_NAME="${PACKAGE_NAME:-${REPOSITORY##*/}}"
BASE_NAME="${BASE_NAME:-$PACKAGE_NAME}"
DISPLAY_NAME="${DISPLAY_NAME:-Faden}"
PKG_DESC="${PKG_DESC:-$(awk -F ' = ' '/^description = / { gsub(/^"|"$/, "", $2); print $2; exit }' "$ROOT/src-tauri/Cargo.toml")}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT/dist/aur}"
PACKAGE_DIR="$OUTPUT_ROOT/$PACKAGE_NAME"
SOURCE_NAME="${SOURCE_NAME:-$BASE_NAME-$VERSION-linux-x86_64.tar.gz}"
SOURCE_URL="${SOURCE_URL:-https://github.com/$REPOSITORY/releases/download/$TAG/$SOURCE_NAME}"
SOURCE_SHA256="${SOURCE_SHA256:-}"

if [[ -z "$SOURCE_SHA256" ]]; then
	tmp="$(mktemp)"
	trap 'rm -f "$tmp"' EXIT
	curl -L "$SOURCE_URL" -o "$tmp"
	SOURCE_SHA256="$(sha256sum "$tmp" | awk '{print $1}')"
fi

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

cat >"$PACKAGE_DIR/PKGBUILD" <<EOF
pkgname=$PACKAGE_NAME
_pkgname=$BASE_NAME
pkgver=$VERSION
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://github.com/$REPOSITORY"
license=('MIT')
depends=('ffmpeg' 'sqlite' 'webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'libsoup3' 'hicolor-icon-theme')
conflicts=('${BASE_NAME}-git')
source=("$SOURCE_NAME::$SOURCE_URL")
sha256sums=('$SOURCE_SHA256')

package() {
  cp -a "$srcdir/usr/." "$pkgdir/usr/"
}
EOF

cat >"$PACKAGE_DIR/.SRCINFO" <<EOF
pkgbase = $PACKAGE_NAME
	pkgdesc = $PKG_DESC
	pkgver = $VERSION
	pkgrel = 1
	url = https://github.com/$REPOSITORY
	arch = x86_64
	license = MIT
	depends = ffmpeg
	depends = sqlite
	depends = webkit2gtk-4.1
	depends = gtk3
	depends = libayatana-appindicator
	depends = libsoup3
	depends = hicolor-icon-theme
	conflicts = ${BASE_NAME}-git
	source = $SOURCE_NAME::$SOURCE_URL
	sha256sums = $SOURCE_SHA256

pkgname = $PACKAGE_NAME
EOF

echo "AUR release package files created: $PACKAGE_DIR"
