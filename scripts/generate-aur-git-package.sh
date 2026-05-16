#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REPOSITORY="${REPOSITORY:-${GITHUB_REPOSITORY:-ReadyPlayerNaN/faden}}"
PACKAGE_NAME="${PACKAGE_NAME:-faden-git}"
BASE_NAME="${BASE_NAME:-faden}"
DISPLAY_NAME="${DISPLAY_NAME:-Faden}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT/dist/aur}"
PACKAGE_DIR="$OUTPUT_ROOT/$PACKAGE_NAME"

PKG_DESC="${PKG_DESC:-$(awk -F ' = ' '/^description = / { gsub(/^"|"$/, "", $2); print $2; exit }' "$ROOT/src-tauri/Cargo.toml")}"

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

cat > "$PACKAGE_DIR/PKGBUILD" <<EOF
pkgname=$PACKAGE_NAME
_pkgname=$BASE_NAME
pkgver=0.r0.g0000000
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://github.com/$REPOSITORY"
license=('MIT')
depends=('ffmpeg' 'sqlite' 'webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'libsoup3' 'hicolor-icon-theme')
makedepends=('cargo' 'nodejs' 'npm' 'patchelf' 'pkgconf')
provides=('faden')
conflicts=('faden')
source=("\$_pkgname::git+https://github.com/$REPOSITORY.git")
sha256sums=('SKIP')

pkgver() {
  cd "\$srcdir/\$_pkgname"
  printf '%s.r%s.g%s' \
    "\$(git show -s --format=%cd --date=format:%Y%m%d)" \
    "\$(git rev-list --count HEAD)" \
    "\$(git rev-parse --short HEAD)"
}

prepare() {
  cd "\$srcdir/\$_pkgname"
  export npm_config_cache="\$srcdir/npm-cache"
  npm ci
}

build() {
  cd "\$srcdir/\$_pkgname"
  npm run build
  cargo build --manifest-path src-tauri/Cargo.toml --bins --features tauri/custom-protocol --release
}

package() {
  cd "\$srcdir/\$_pkgname"

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

cat > "$PACKAGE_DIR/.SRCINFO" <<EOF
pkgbase = $PACKAGE_NAME
	pkgdesc = $PKG_DESC
	pkgver = 0.r0.g0000000
	pkgrel = 1
	url = https://github.com/$REPOSITORY
	arch = x86_64
	license = MIT
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
	provides = faden
	conflicts = faden
	source = $BASE_NAME::git+https://github.com/$REPOSITORY.git
	sha256sums = SKIP

pkgname = $PACKAGE_NAME
EOF

echo "AUR git package files created: $PACKAGE_DIR"
