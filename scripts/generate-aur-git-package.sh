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

PKG_DESC="${PKG_DESC:-$(python3 - <<'PY'
import tomllib, pathlib
print(tomllib.loads(pathlib.Path('src-tauri/Cargo.toml').read_text())['package']['description'])
PY
)}"

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
depends=('ffmpeg' 'webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'libsoup3' 'hicolor-icon-theme')
makedepends=('binutils' 'cargo' 'nodejs' 'npm' 'dpkg' 'patchelf')
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
  npm run tauri build -- --bundles deb
}

package() {
  cd "\$srcdir/\$_pkgname"
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
	pkgver = 0.r0.g0000000
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
	provides = faden
	conflicts = faden
	source = $BASE_NAME::git+https://github.com/$REPOSITORY.git
	sha256sums = SKIP

pkgname = $PACKAGE_NAME
EOF

echo "AUR git package files created: $PACKAGE_DIR"
