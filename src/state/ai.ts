import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { AiRunDTO, ProposalDTO, ProposalKind } from "../ipc/ai";
import type { TranscriptionProgress } from "../ipc/transcribe";

export type LocalAiOperation = {
  id: string;
  runId?: number | null;
  kind: ProposalKind | "transcribe";
  startedAt: string;
  interviewId: number | null;
  label: string;
  title?: string;
  progress?: TranscriptionProgress;
};

export const pendingProposalsAtom = atom<ProposalDTO[]>([]);
export const activeProposalIdAtom = atom<number | null>(null);
export const aiRunHistoryAtom = atom<AiRunDTO[]>([]);
export const activeAiOperationsAtom = atom<LocalAiOperation[]>([]);

export type SuggestionReviewItem = {
  segmentId: number;
  startOffset: number;
  endOffset: number;
  tagNames: string[];
  rationale?: string | null;
};

export type ActiveSuggestionReview = {
  proposalId: number;
  proposalKind: "pretag" | "find_more";
  interviewId: number;
  suggestions: SuggestionReviewItem[];
  currentIndex: number;
  decisions: Array<"accepted" | "declined" | null>;
};

export const activeSuggestionReviewAtom = atom<ActiveSuggestionReview | null>(null);
export const acknowledgedAiRunsAtom = atomWithStorage<Record<number, boolean>>(
  "faden.acknowledged-ai-runs",
  {},
  createJSONStorage(() => localStorage),
  { getOnInit: true },
);
export const hasOngoingAiOperationsAtom = atom(
  (get) =>
    get(activeAiOperationsAtom).length > 0 ||
    get(aiRunHistoryAtom).some((run) => run.status === "running"),
);

// Session-scoped "don't ask again" — keyed by flow kind
export const skipCostConfirmAtom = atom<Record<string, boolean>>({});
