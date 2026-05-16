//! End-to-end cassette test for the transcription pipeline.
//!
//! Requirements:
//!   1. Real ffmpeg + ffprobe binaries fetched via `scripts/fetch-binaries.sh`.
//!   2. A small audio fixture at `tests/fixtures/sample.mp3`.
//!   3. A Tauri mock app handle (via `tauri::test::mock_builder()`).
//!   4. Mocked Gemini responses (already covered by `transcription_gemini.rs` unit
//!      tests for the client; the orchestrator calls the client transparently).
//!
//! Marked `#[ignore]` until those prerequisites are available. To run:
//!   cargo test --test transcription_gemini_cassette -- --ignored

#[test]
#[ignore]
fn full_pipeline_runs_against_mocked_gemini() {
    // Outline:
    //   1. Build mock Tauri app with shell + dialog plugins.
    //   2. Set up mockito server with upload + generateContent + delete handlers.
    //   3. Create a temp project, insert an interview with the fixture audio.
    //   4. Invoke `pipeline::run_pipeline` with PipelineConfig pointed at mockito.
    //   5. Assert: interview status -> Complete, segments inserted, ai_run complete.
    //
    // The orchestrator needs significant refactoring to be testable from outside
    // a running Tauri app (factor out the parts that need AppHandle vs the parts
    // that are pure). Deferred to a later polish task.
}
