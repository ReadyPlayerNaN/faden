import { invoke } from "@tauri-apps/api/core";

export type CostEstimate = {
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUsd: number;
};

type RawCostEstimate = {
  model: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_usd: number;
};

export type ProposalKind = "codebook_gen" | "pretag" | "find_more";
export type AiRunKind = ProposalKind | "transcribe";
export type AiRunStatus = "running" | "complete" | "failed" | "cancelled";

export type ProposalDTO = {
  id: number;
  kind: ProposalKind;
  payload: unknown;
};

export type AiRunDTO = {
  id: number;
  kind: AiRunKind;
  interviewId: number | null;
  model: string;
  prompt: string;
  startedAt: string;
  completedAt: string | null;
  status: AiRunStatus;
  error: string | null;
  tokenUsageJson: string | null;
  resultSummary: string | null;
};

const costFromRaw = (r: RawCostEstimate): CostEstimate => ({
  model: r.model,
  estimatedInputTokens: r.estimated_input_tokens,
  estimatedOutputTokens: r.estimated_output_tokens,
  estimatedUsd: r.estimated_usd,
});

export const aiCodebookGenStart = (
  interviewIds: number[],
  includeExistingCodebook: boolean,
): Promise<number> =>
  invoke<number>("ai_codebook_gen_start", {
    interviewIds,
    includeExistingCodebook,
  });

export const aiPretagStart = (interviewId: number): Promise<number> =>
  invoke<number>("ai_pretag_start", { interviewId });

export const aiFindMoreStart = (
  tagId: number,
  interviewId: number,
): Promise<number> =>
  invoke<number>("ai_find_more_start", { tagId, interviewId });

export const aiProposalList = (): Promise<ProposalDTO[]> =>
  invoke<ProposalDTO[]>("ai_proposal_list");

export const aiProposalGet = (proposalId: number): Promise<ProposalDTO> =>
  invoke<ProposalDTO>("ai_proposal_get", { proposalId });

export const aiProposalAccept = (
  proposalId: number,
  selection: unknown,
): Promise<{ created_count: number; skipped: string[] }> =>
  invoke("ai_proposal_accept", { proposalId, selection });

export const aiProposalReject = (proposalId: number): Promise<void> =>
  invoke("ai_proposal_reject", { proposalId });

export const aiRunList = (): Promise<AiRunDTO[]> =>
  invoke<AiRunDTO[]>("ai_run_list");

export const aiCostEstimate = async (
  kind: ProposalKind,
  args: unknown,
): Promise<CostEstimate> =>
  costFromRaw(await invoke<RawCostEstimate>("ai_cost_estimate", { kind, args }));
