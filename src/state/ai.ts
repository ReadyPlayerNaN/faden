import { atom } from "jotai";
import type { ProposalDTO } from "../ipc/ai";

export const pendingProposalsAtom = atom<ProposalDTO[]>([]);
export const activeProposalIdAtom = atom<number | null>(null);

// Session-scoped "don't ask again" — keyed by flow kind
export const skipCostConfirmAtom = atom<Record<string, boolean>>({});
