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
PKG_DESC="${PKG_DESC:-$(awk -F ' = ' '/^description = / { gsub(/^"|"$/, "", $2); print $2; exit }' "$ROOT/src-tauri/Cargo.toml")}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT/dist/aur}"
PACKAGE_DIR="$OUTPUT_ROOT/$PACKAGE_NAME"
SOURCE_URL="https://github.com/$REPOSITORY/archive/refs/tags/$TAG.tar.gz"
SOURCE_NAME="$BASE_NAME-$VERSION.tar.gz"
SOURCE_SHA256="${SOURCE_SHA256:-}"

if [[ -z "$SOURCE_SHA256" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -L "$SOURCE_URL" -o "$tmp"
  SOURCE_SHA256="$(sha256sum "$tmp" | awk '{print $1}')"
fi

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

cat > "$PACKAGE_DIR/PKGBUILD" <<EOF
pkgname=$PACKAGE_NAME
_pkgname=$BASE_NAME
pkgver=$VERSION
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://github.com/$REPOSITORY"
license=('MIT')
depends=('ffmpeg' 'webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'libsoup3' 'hicolor-icon-theme')
makedepends=('binutils' 'cargo' 'nodejs' 'npm' 'dpkg' 'patchelf')
conflicts=('${BASE_NAME}-bin' '${BASE_NAME}-git')
source=("$SOURCE_NAME::$SOURCE_URL")
sha256sums=('$SOURCE_SHA256')

prepare() {
  cd "\$(find "\$srcdir" -maxdepth 1 -type d -name "\$_pkgname-*" | head -n1)"
  export npm_config_cache="\$srcdir/npm-cache"
  npm ci
}

build() {
  cd "\$(find "\$srcdir" -maxdepth 1 -type d -name "\$_pkgname-*" | head -n1)"
  npm run tauri build -- --bundles deb
}

package() {
  cd "\$(find "\$srcdir" -maxdepth 1 -type d -name "\$_pkgname-*" | head -n1)"
  local data_dir
  data_dir="\$(find src-tauri/target/release/bundle/deb -type d -path '*/data' | head -n1)"

  if [[ -z "\$data_dir" ]]; then
    echo 'Tauri deb bundle data directory not found' >&2
    exit 1
  fi

  cp -a "\$data_dir"/. "\$pkgdir"/
}
EOF

cat > "$PACKAGE_DIR/.SRCINFO" <<EOF
pkgbase = $PACKAGE_NAME
	pkgdesc = $PKG_DESC
	pkgver = $VERSION
	pkgrel = 1
	url = https://github.com/$REPOSITORY
	arch = x86_64
	license = MIT
	makedepends = binutils
	makedepends = cargo
	makedepends = nodejs
	makedepends = npm
	makedepends = dpkg
	makedepends = patchelf
	depends = ffmpeg
	depends = webkit2gtk-4.1
	depends = gtk3
	depends = libayatana-appindicator
	depends = libsoup3
	depends = hicolor-icon-theme
	conflicts = ${BASE_NAME}-bin
	conflicts = ${BASE_NAME}-git
	source = $SOURCE_NAME::$SOURCE_URL
	sha256sums = $SOURCE_SHA256

pkgname = $PACKAGE_NAME
EOF

echo "AUR release package files created: $PACKAGE_DIR"
