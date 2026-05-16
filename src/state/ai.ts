import { atom } from "jotai";
import type { AiRunDTO, ProposalDTO, ProposalKind } from "../ipc/ai";
import type { TranscriptionProgress } from "../ipc/transcribe";

export type LocalAiOperation = {
  id: string;
  kind: ProposalKind | "transcribe";
  startedAt: string;
  interviewId: number | null;
  label: string;
  progress?: TranscriptionProgress;
};

export const pendingProposalsAtom = atom<ProposalDTO[]>([]);
export const activeProposalIdAtom = atom<number | null>(null);
export const aiRunHistoryAtom = atom<AiRunDTO[]>([]);
export const activeAiOperationsAtom = atom<LocalAiOperation[]>([]);
export const hasOngoingAiOperationsAtom = atom(
  (get) =>
    get(activeAiOperationsAtom).length > 0 ||
    get(aiRunHistoryAtom).some((run) => run.status === "running"),
);

// Session-scoped "don't ask again" — keyed by flow kind
export const skipCostConfirmAtom = atom<Record<string, boolean>>({});
