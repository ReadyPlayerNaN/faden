import { atom } from "jotai";
import type { TranscriptionProgress } from "../ipc/transcribe";

export type RunSnapshot = {
  lastProgress: TranscriptionProgress;
  updatedAt: number;
};

// Keyed by interview_id
export const transcriptionRunsAtom = atom<Record<number, RunSnapshot>>({});
