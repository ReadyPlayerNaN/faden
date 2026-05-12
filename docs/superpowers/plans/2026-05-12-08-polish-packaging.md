# 08 — Polish & Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** v1.0-ready: complete Settings UI, error states, Czech translations, recent-projects management, Playwright E2E test, signed/notarized installers for Linux/macOS/Windows, README walkthrough, LICENSE.

**Architecture:** Mostly UX and tooling improvements. No major new modules. The largest piece is the cross-platform build configuration.

**Tech Stack:** Plans 01–07. Plus: Playwright (or tauri-driver + WebdriverIO), GitHub Actions (or local CI) for cross-platform builds.

**Spec reference:** §11 (testing), §12 (distribution).

**Prerequisites:** Plans 01–07 merged.

---

## File structure

```
.github/workflows/
└── release.yml                          # NEW — multi-platform build + release

scripts/
├── fetch-binaries.sh                    # MODIFIED — supports CI multi-target
└── package.sh                           # NEW — local packaging helper

src-tauri/
└── tauri.conf.json                      # MODIFIED — bundle settings, updater (decision-dependent), signing

src/
├── components/
│   ├── ErrorBoundary.tsx                # NEW
│   ├── ErrorBanner.tsx                  # NEW
│   └── ProgressBar/                     # NEW (shared)
├── views/
│   ├── Settings/                        # MODIFIED — full per-project + global UI
│   └── ProjectPicker/                   # MODIFIED — rename/remove recents
└── styles/
    └── (refinements)

tests-e2e/                               # NEW
├── package.json
├── playwright.config.ts
└── tests/
    ├── smoke.spec.ts                    # full happy path
    └── readme-example.spec.ts           # matches README walkthrough

README.md                                # REWRITTEN — install + first-run guide
LICENSE                                  # NEW (decision-dependent)
```

---

## Task 1: Czech translations completion

Audit every i18n key in `src/i18n/en.json` and ensure a Czech translation exists in `cs.json`. Plans 02–07 introduced many keys; not all may have Czech versions.

Script: `node -e "const en=require('./src/i18n/en.json'); const cs=require('./src/i18n/cs.json'); function diff(a, b, path='') { ... }"` — list missing keys.

Have a Czech speaker (the wife herself, who's the end user) review the translations. Fix any unnatural phrasing.

Commit: `i18n: complete Czech translations`.

---

## Task 2: Error states and ErrorBoundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx` — wraps the router root.
- Create: `src/components/ErrorBanner.tsx` — used by views to display backend errors.
- Modify: All long-running flows (transcription, AI flows, export) to surface errors via banners with retry buttons.

`ErrorBoundary`: catches React render errors, shows a recovery UI with "Reload window" button.

`ErrorBanner`: dismissible, shown above the workspace. Localized error messages mapped from `AppError` kinds (e.g. `AppError::Conflict` → "This name is already in use", not raw Rust output).

Wherever the existing code uses `void promise.then(...)` with no `.catch`, add error handling that surfaces to a banner.

i18n keys: `errors.networkFailed`, `errors.notFound`, `errors.conflict`, `errors.invalid`, `errors.unknown`.

Commit: `feat(errors): error boundary + banner with localized messages`.

---

## Task 3: Recent projects management

**File:** `src/views/ProjectPicker/ProjectPicker.tsx` (modify)

Each recent project row gets a kebab menu (or right-click) with:
- Rename (changes display name only; doesn't touch the project itself).
- Remove from list (deletes from `globalSettings.recentProjects`).
- Reveal in file manager (use `@tauri-apps/plugin-opener` revealItemInDir — re-add the plugin if needed).
- If the project directory has moved/disappeared, show "Locate…" → opens dialog to point to new path.

Backend: extend `GlobalSettings.recent_projects` from `Vec<String>` to `Vec<RecentProject { path, display_name }>`. Migration: existing string entries treated as both path and display_name.

Commit: `feat(picker): manage recent projects (rename/remove/locate)`.

---

## Task 4: Settings completeness

Currently Settings has Gemini API key only. Add sections:

- **Global**:
  - Gemini API key (existing).
  - Default transcription model (text field with `gemini-3-flash-preview` default).
  - Default AI tagging model (separate dropdown).
  - UI language override (auto / English / Czech).
  - Theme (auto / light / dark — though all current CSS is dark; light theme is a stretch goal, leave the toggle if light theme not implemented).
- **Per-project** (only visible when a project is open):
  - Project name (rename, updates `project_meta.name`).
  - Transcription params (chunk_seconds, channels, sample_rate, bitrate) with reset-to-default buttons.
  - Prompt overrides (from Plan 05 Task 14).

Each per-project field shows a "(using project override)" badge when it differs from default; "Reset" button clears the override.

Backend commands:
- `project_rename(name)` (updates `project_meta.name`).
- `project_settings_get` / `project_settings_set` (already in Plan 05).

i18n keys for all new strings.

Commit: `feat(settings): full global + per-project settings UI`.

---

## Task 5: Cross-platform ffmpeg/ffprobe assembly

Extend `scripts/fetch-binaries.sh` to optionally fetch all three target triples (Linux x86_64-unknown-linux-gnu, macOS aarch64-apple-darwin + x86_64-apple-darwin, Windows x86_64-pc-windows-msvc) instead of just the host:

```sh
TARGETS=${TARGETS:-$HOST}
for target in $TARGETS; do
  # fetch URL based on target
done
```

Document `TARGETS="x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc" scripts/fetch-binaries.sh` for releases.

Commit: `chore(scripts): cross-platform binary fetcher`.

---

## Task 6: GitHub Actions release workflow

**File:** `.github/workflows/release.yml`

Triggered by tag push `v*`. Jobs:

- `build-linux`: ubuntu-22.04 runner, fetch Linux binaries, `tauri build`, upload `.deb` + `.AppImage`.
- `build-macos`: macos-latest, sign + notarize with `APPLE_*` secrets, upload `.dmg`.
- `build-windows`: windows-latest, fetch Windows binaries, upload `.msi` (signing optional/manual).
- `release`: depends on above three; creates GitHub release with all artifacts attached.

Secrets needed: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (Apple notarization), and optionally Windows code-signing certificate.

Tauri 2's `tauri-action` GitHub Action handles most of this — use it.

Commit: `ci(release): multi-platform build pipeline`.

---

## Task 7: Playwright E2E smoke test

**Files:**
- Create: `tests-e2e/package.json` (separate Node project to avoid conflict).
- Create: `tests-e2e/playwright.config.ts`.
- Create: `tests-e2e/tests/smoke.spec.ts`.

Tauri's E2E story uses `tauri-driver` (WebdriverIO) on most platforms. Playwright works with the desktop app via Chrome DevTools Protocol on the underlying webview (Linux + Windows with `WEBKIT_*`, macOS via separate tooling). Simplest portable path: use **WebdriverIO** with `tauri-driver` instead of Playwright.

Decision: use `tauri-driver` + WebdriverIO via the official Tauri docs example.

Test scenarios:
1. Launch app.
2. Click "New project" → pick temp dir → workspace opens.
3. Click "+ New interview" → type name → confirm.
4. Open Settings → fill API key → save → reload.
5. Close app.

Run locally with `npm run e2e` from `tests-e2e/`.

Commit: `test(e2e): smoke test with tauri-driver + webdriverio`.

---

## Task 8: README rewrite

**File:** `README.md` (rewrite)

Sections:
- Project description (1 paragraph): what it is, who it's for.
- Screenshot or demo gif.
- Install: pre-built binaries (when available) and from source.
- First-run walkthrough: create project → import audio → transcribe → tag → export. Match the screenshots/gif.
- Settings overview: Gemini API key, prompts, normalization params.
- Development: prerequisites (Rust, Node, ffmpeg), `scripts/fetch-binaries.sh`, `npm run tauri dev`, tests (`cargo test`, `npm run e2e`).
- License pointer.
- Contributing (placeholder — refer to issues).

Commit: `docs: rewrite README with install + walkthrough`.

---

## Task 9: License decision

Add a LICENSE file. Recommend MIT or Apache-2.0 for permissive, AGPL-3.0 if the user wants strong copyleft (less common for desktop apps but valid).

Decide with user. Add `LICENSE`. Update `Cargo.toml` and `package.json` `license` fields. Add license headers to source files if the chosen license requires (MIT doesn't; AGPL does).

Commit: `docs: add LICENSE`.

---

## Task 10: Auto-update strategy

Two options:

A. **Built-in updater** via Tauri's updater plugin. Requires hosting update manifests + signed packages. Higher operational cost.

B. **Manual download**: each release publishes to GitHub Releases; the app shows a "Check for updates" link in Settings that opens the releases page in a browser.

For v1.0 personal-use, option B is sufficient. Implement: a tiny "Check for updates" button in Settings that opens the GitHub releases URL via `tauri-plugin-opener`. Add to README: "We don't auto-update yet; check the releases page periodically."

Commit: `feat(settings): manual update check link`.

---

## Task 11: Final smoke test

Manual:
1. Run `scripts/fetch-binaries.sh`.
2. `npm run tauri build`.
3. Install the resulting `.AppImage` / `.deb` / `.dmg` / `.msi` on each target platform.
4. Walk through the README's first-run example end-to-end.
5. Verify exports open in Excel, NVivo/Atlas.ti (REFI), and a text editor (Markdown/JSON).

E2E:
- `cd tests-e2e && npm run e2e` → green.

Non-interactive Rust + frontend:
- `cargo test` → all green.
- `npm run build` → clean.

Tag the release and push: `git tag v1.0.0 && git push --tags`.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| §9 settings (global + per-project completeness) | 4 |
| §10 i18n complete | 1 |
| §11 testing — E2E smoke | 7 |
| §12 distribution — multi-platform | 5, 6 |
| §12 LICENSE deferred decision | 9 |
| Error states + retry affordances | 2 |
| Recent projects management | 3 |
| README install + usage | 8 |
| Update strategy decision | 10 |

### Risks

- macOS notarization requires an Apple Developer account ($99/year). If the user doesn't have one, the macOS build will be unsigned and require Gatekeeper override. Document in README.
- Tauri E2E via `tauri-driver` requires platform-specific setup (WebKitGTK on Linux, etc.). Document prerequisites.
- The "Light theme" toggle in Task 4 is gated — skip if not implemented; UI element should be hidden until light CSS exists.

### Notes on ordering

- Task 5 (cross-platform binaries) and Task 6 (release workflow) are tightly coupled. Do Task 5 first so Task 6 has the inputs it needs.
- Task 7 (Playwright/WebdriverIO) is somewhat independent; can be done in parallel with packaging.
- Task 9 (LICENSE) blocks Task 6 (release artifacts should include LICENSE).
