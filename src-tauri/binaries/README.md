# Bundled binaries

Tauri sidecars (`ffmpeg`, `ffprobe`) live here. Configuration: see
`src-tauri/tauri.conf.json` → `bundle.externalBin`.

Tauri requires sidecars to be named `<base>-<target-triple>[.exe]`.

These binaries are **not** version-controlled — they are large (~80MB on Linux).
Fetch them for your host platform before the first build:

```sh
scripts/fetch-binaries.sh
```

For release builds with cross-platform support:

```sh
TARGETS="x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc" \
  scripts/fetch-binaries.sh
```

Host triple lookup: `rustc -vV | grep host`.
