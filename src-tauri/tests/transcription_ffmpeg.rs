// Integration tests for the ffmpeg helper module. These require:
//   - Real ffmpeg/ffprobe binaries fetched via `scripts/fetch-binaries.sh`
//   - A small audio fixture at `tests/fixtures/sample.mp3`
//   - A working Tauri app handle (requires `tauri::test::mock_app`)
//
// Marked `#[ignore]` until those prerequisites are met (later plan tasks).

#[test]
#[ignore]
fn probe_duration_integration() {
    // Placeholder: see comment above.
    // The real implementation needs a mock Tauri app handle and a sample fixture.
}
