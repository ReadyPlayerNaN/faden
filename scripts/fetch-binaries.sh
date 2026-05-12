#!/usr/bin/env bash
set -euo pipefail

# Fetch ffmpeg + ffprobe static binaries for the host platform (or $TARGETS).
# Tauri sidecars must be named <base>-<target-triple>[.exe].
#
# Usage:
#   scripts/fetch-binaries.sh                 # host platform only
#   TARGETS="x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc" \
#     scripts/fetch-binaries.sh                # cross-platform (for releases)

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
mkdir -p "$DEST"

HOST=$(rustc -vV 2>/dev/null | sed -n 's/host: //p')
TARGETS="${TARGETS:-$HOST}"

for target in $TARGETS; do
  echo "Fetching for: $target"
  case "$target" in
    x86_64-unknown-linux-gnu)
      url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
      tmp=$(mktemp -d)
      curl -L -o "$tmp/ff.tar.xz" "$url"
      tar -xf "$tmp/ff.tar.xz" -C "$tmp"
      bin_dir=$(find "$tmp" -name "ffmpeg-*-amd64-static" -type d | head -n1)
      cp "$bin_dir/ffmpeg"  "$DEST/ffmpeg-$target"
      cp "$bin_dir/ffprobe" "$DEST/ffprobe-$target"
      rm -rf "$tmp"
      ;;
    aarch64-apple-darwin|x86_64-apple-darwin)
      arch="${target%%-*}"
      [ "$arch" = "x86_64" ] && arch="intel"
      [ "$arch" = "aarch64" ] && arch="arm64"
      curl -L -o "$DEST/ffmpeg-$target.zip" "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
      curl -L -o "$DEST/ffprobe-$target.zip" "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
      ( cd "$DEST" && unzip -o "ffmpeg-$target.zip"   && mv ffmpeg  "ffmpeg-$target"  && rm "ffmpeg-$target.zip" )
      ( cd "$DEST" && unzip -o "ffprobe-$target.zip"  && mv ffprobe "ffprobe-$target" && rm "ffprobe-$target.zip" )
      ;;
    x86_64-pc-windows-msvc)
      url="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
      tmp=$(mktemp -d)
      curl -L -o "$tmp/ff.zip" "$url"
      ( cd "$tmp" && unzip -q ff.zip )
      bin_dir=$(find "$tmp" -name "bin" -type d | head -n1)
      cp "$bin_dir/ffmpeg.exe"  "$DEST/ffmpeg-$target.exe"
      cp "$bin_dir/ffprobe.exe" "$DEST/ffprobe-$target.exe"
      rm -rf "$tmp"
      ;;
    *)
      echo "Unsupported target: $target" >&2
      exit 1
      ;;
  esac
  chmod +x "$DEST/ffmpeg-$target"* "$DEST/ffprobe-$target"* 2>/dev/null || true
done

echo "Done. Binaries in: $DEST"
ls -la "$DEST"
