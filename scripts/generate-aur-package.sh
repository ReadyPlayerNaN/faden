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

cat >"$PACKAGE_DIR/PKGBUILD" <<EOF
pkgname=$PACKAGE_NAME
_pkgname=$BASE_NAME
pkgver=$VERSION
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://github.com/$REPOSITORY"
license=('MIT')
options=(!lto)
depends=('ffmpeg' 'sqlite' 'webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'libsoup3' 'hicolor-icon-theme')
makedepends=('cargo' 'nodejs' 'npm' 'patchelf' 'pkgconf')
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
  npm run build
  cargo build --manifest-path src-tauri/Cargo.toml --bins --features tauri/custom-protocol --release
}

package() {
  cd "\$(find "\$srcdir" -maxdepth 1 -type d -name "\$_pkgname-*" | head -n1)"

  install -Dm755 "src-tauri/target/release/\$_pkgname" "\$pkgdir/usr/bin/\$_pkgname"
  install -Dm644 "src-tauri/icons/128x128.png" "\$pkgdir/usr/share/pixmaps/\$_pkgname.png"
  install -Dm644 LICENSE "\$pkgdir/usr/share/licenses/$PACKAGE_NAME/LICENSE"
  install -Dm644 /dev/stdin "\$pkgdir/usr/share/applications/\$_pkgname.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$DISPLAY_NAME
Comment=$PKG_DESC
Exec=\$_pkgname
Icon=\$_pkgname
Terminal=false
Categories=Office;AudioVideo;
StartupWMClass=faden
DESKTOP
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
	options = !lto
	makedepends = cargo
	makedepends = nodejs
	makedepends = npm
	makedepends = patchelf
	makedepends = pkgconf
	depends = ffmpeg
	depends = sqlite
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
