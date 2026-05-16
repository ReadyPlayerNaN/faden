import { atom } from "jotai";
import type { TranscriptionProgress } from "../ipc/transcribe";

export type RunSnapshot = {
  runId: number | null;
  startedAt: number;
  lastProgress: TranscriptionProgress;
  updatedAt: number;
};

export const transcriptionRunsAtom = atom<Record<number, RunSnapshot>>({});
