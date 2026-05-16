import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TranscriptStatus } from "./interview";

export type TranscriptionProgress =
  | { stage: "starting"; interview_id: number; run_id: number }
  | { stage: "analyzing_source"; interview_id: number; run_id: number }
  | { stage: "preparing_chunks"; interview_id: number; run_id: number; total_chunks: number }
  | { stage: "encoding_chunk"; interview_id: number; run_id: number; index: number; total: number }
  | { stage: "transcribing_chunk"; interview_id: number; run_id: number; index: number; total: number; attempt: number }
  | { stage: "composing_transcript"; interview_id: number; run_id: number; completed_chunks: number; total_chunks: number }
  | { stage: "complete"; interview_id: number; run_id: number; total_segments: number }
  | { stage: "failed"; interview_id: number; run_id: number; message: string }
  | { stage: "cancelled"; interview_id: number; run_id: number };

export const transcribeStart = (interviewId: number): Promise<void> =>
  invoke("transcribe_start", { interviewId });

export const transcribeCancel = (interviewId: number): Promise<void> =>
  invoke("transcribe_cancel", { interviewId });

export const transcribeStatus = (interviewId: number): Promise<TranscriptStatus> =>
  invoke<TranscriptStatus>("transcribe_status", { interviewId });

export const onTranscriptionProgress = (
  fn: (p: TranscriptionProgress) => void,
): Promise<UnlistenFn> =>
  listen<TranscriptionProgress>("transcription:progress", (e) => fn(e.payload));
