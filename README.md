# Faden

Desktop application for qualitative interview research. Audio transcription
via Gemini, manual and AI-assisted tagging with a three-level codebook
(cluster -> category -> tag), per-second audio-to-transcript linking, and
five export formats (CSV, Markdown, REFI-QDA, stats, codebook).

**Status:** Alpha. Built for personal research use. May be open-sourced once
it stabilises.

**Linux / Wayland note:** Sorry — Tauri currently forces client-side window
decorations in some Wayland setups, so Faden may show an ugly custom titlebar
instead of your compositor defaults. Upstream bug: https://github.com/tauri-apps/tao/issues/1046

**Website:** https://faden.space

## Features

- Project-per-folder. Each project is a directory with `project.sqlite`, a
  `media/` folder for original audio, and a `cache/` folder for transcoded
  WAV chunks.
- Multi-format import: audio only, transcript text, transcript JSON, or
  audio plus matching transcript.
- Cloud transcription via Google's Gemini models with chunked retry and a
  progress bar per chunk.
- Three-level codebook (cluster / category / tag) with colors, descriptions,
  and reorder.
- Selection-based tagging with per-quote memos and shared-tag rollups.
- Audio playback driven by transcript clicks, plus loop-current-span.
- AI assists, all explicitly user-triggered (no background calls):
  codebook generation, pre-tagging, "find more like this".
- Export to CSV (per-quote), Markdown, REFI-QDA XML, stats reports
  (frequencies and co-occurrences), and standalone codebook (JSON or CSV).
- English and Czech UI.

## Install (from source)

### Prerequisites

- Rust toolchain (`rustup`)
- Node.js 18+
- `ffmpeg` and `ffprobe` installed on the system
- A Gemini API key (https://aistudio.google.com/apikey)
- System WebKitGTK on Linux (Tauri runtime)

### Setup

```sh
git clone <repo-url> faden
cd faden
npm install
npm run tauri dev           # development build with hot reload
```

To produce a release bundle:

```sh
npm run tauri build
```

Output bundles land in `src-tauri/target/release/bundle/` (deb, AppImage,
or platform-specific installers).

## First-run walkthrough

1. **Launch the app**. The project picker opens. Click **New project**,
   choose an empty folder. The picker also lists recent projects with
   inline rename / remove.
2. **Add your API key**. Open Settings (gear icon in the workspace). Paste
   your Gemini key. Faden stores it in your OS keychain / credential
   store, not in plaintext project settings. Optionally set the default
   transcription / AI model and UI language.
3. **Import an interview**. In the left pane click **+ From audio**, pick
   an audio file. The app transcodes a working copy via the system
   `ffmpeg` and creates a new interview row.
4. **Transcribe**. Click **Transcribe** next to the interview. Long files
   are chunked; progress is shown per chunk. Failed chunks can be retried.
5. **Build a codebook**. In the left pane add clusters, then categories,
   then tags. Or use **AI -> Generate codebook** to draft one from selected
   interviews.
6. **Tag quotes**. Select transcript text and apply a tag. Optionally add
   a memo. Tagged spans appear in the right pane with their tags and the
   underlying audio loop.
7. **AI pre-tag** (optional). Pick an interview, open the AI panel, choose
   **Pre-tag**. Review the staged proposals and accept individually or
   in bulk.
8. **Export**. From the workspace menu choose **Export**. Pick scope
   (current interview / whole project / by tag), formats (CSV, Markdown,
   REFI-QDA, stats, codebook), and an output directory.

## Settings overview

- **Gemini API key** - required for any AI feature. Stored in the OS
  keychain / credential store.
- **Default transcription model** / **Default AI tagging model** - the
  model identifiers to pass to Gemini. Default is `gemini-3-flash-preview`.
- **UI language** - Auto (OS default), English, or Czech.
- **Prompts** - per-project overrides for transcription, codebook
  generation, pre-tagging, and find-more system / user prompts. Empty
  fields fall back to the built-in defaults.

## Project layout on disk

```
my-project/
  project.sqlite      # codebook, interviews, segments, spans, settings
  media/              # imported originals (audio, transcripts)
  cache/              # transcoded WAV chunks, transient files
```

Projects are portable: zip the folder, move it to another machine with
the same app installed, and reopen via **Open folder...**.

## Development

### Prerequisites

- Rust toolchain (`rustup`)
- Node.js 18+
- `ffmpeg` + `ffprobe`
- WebKitGTK + libsoup3 (Linux desktops)

### Common commands

```sh
npm install                     # install JS deps
npm run dev                     # vite-only dev server
npm run tauri dev               # full Tauri dev shell
npm run build                   # tsc + vite production frontend build
npm run tauri build             # signed/unsigned platform installer
cargo test --manifest-path src-tauri/Cargo.toml
```

### Linux packaging

Linux builds use the system `ffmpeg` / `ffprobe` and Arch packaging is
handled via the AUR metadata generated in `scripts/generate-aur-package.sh`
and `scripts/generate-aur-git-package.sh`.

### Testing

- Rust backend: `cargo test` from `src-tauri/`.
- Frontend type-check: `tsc --noEmit`.
- No end-to-end harness yet; manual smoke list lives in
  `docs/superpowers/plans/`.

### Architecture pointers

- `src-tauri/` - Rust backend, Tauri commands, SQLite layer
  (`db/queries/`), AI providers (`ai/`), transcription pipeline
  (`transcription/`), export adapters (`export/`).
- `src/` - React 19 frontend. State in Jotai (`src/state/`), routing via
  TanStack Router (`src/router.ts`). No CSS-in-JS, no Tailwind - plain
  CSS modules.
- `src/ipc/` - typed wrappers around `invoke(...)` Tauri commands. Always
  add a wrapper rather than calling `invoke` from view code.
- `src/i18n/{en,cs}.json` - translations. Files must stay in structural
  parity; an audit script lives in the polish plan.

## Roadmap

See `docs/superpowers/plans/` for per-feature plans (01 through 08) and
`docs/superpowers/roadmap.md` (if present) for the high-level outline.

## License

MIT - see `LICENSE`.
