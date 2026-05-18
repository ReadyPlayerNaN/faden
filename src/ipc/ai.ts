import { invoke } from "@tauri-apps/api/core";

export type CostEstimate = {
  provider: string;
  model: string;
  modelRef: string;
  pricingKnown: boolean;
  textInputUsdPerMillion: number;
  audioInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUsd: number;
};

type RawCostEstimate = {
  provider: string;
  model: string;
  model_ref: string;
  pricing_known: boolean;
  text_input_usd_per_million: number;
  audio_input_usd_per_million: number;
  output_usd_per_million: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_usd: number;
};

export type ProposalKind =
  | "codebook_gen"
  | "pretag"
  | "find_more"
  | "categorize"
  | "cluster";
export type ProposalStatus = "pending" | "accepted" | "rejected";
export type AiRunKind = ProposalKind | "transcribe";
export type CostEstimateKind = ProposalKind | "transcribe";
export type AiRunStatus = "running" | "complete" | "failed" | "cancelled";

export type ProposalDTO = {
  id: number;
  aiRunId: number;
  kind: ProposalKind;
  payload: unknown;
  status: ProposalStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type AiRunNodeStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "retrying"
  | "skipped";

export type AiRunStageKey =
  | "analyze_source"
  | "prepare_chunks"
  | "encode_chunks"
  | "transcribe_chunks"
  | "compose_transcript"
  | "finalize";

export type AiRunTaskKind = "encode_chunk" | "transcribe_chunk";

export type AiRunStageDTO = {
  id: number;
  aiRunId: number;
  key: AiRunStageKey;
  order: number;
  status: AiRunNodeStatus;
  totalCount: number | null;
  completedCount: number | null;
  failedCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type AiRunTaskDTO = {
  id: number;
  aiRunStageId: number;
  aiRunId: number;
  kind: AiRunTaskKind;
  chunkIndex: number;
  status: AiRunNodeStatus;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  logJson: string | null;
};

export type AiRunDTO = {
  id: number;
  kind: AiRunKind;
  interviewId: number | null;
  provider: string | null;
  model: string;
  modelId: string;
  prompt: string;
  inputJson: string | null;
  startedAt: string;
  completedAt: string | null;
  status: AiRunStatus;
  error: string | null;
  tokenUsageJson: string | null;
  resultSummary: string | null;
  rawOutput: string | null;
  stages: AiRunStageDTO[];
};

export type AiRunDetailDTO = AiRunDTO & {
  tasks: AiRunTaskDTO[];
};

export const providerLabel = (provider: string | null): string | null => {
  switch (provider) {
    case "gemini":
      return "Gemini";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "ollama":
      return "Ollama";
    default:
      return provider;
  }
};

export const parseModelRef = (
  modelRef: string,
  fallbackProvider?: string | null,
): { provider: string | null; modelId: string } => {
  const slash = modelRef.indexOf("/");
  if (slash > 0) {
    return {
      provider: modelRef.slice(0, slash),
      modelId: modelRef.slice(slash + 1),
    };
  }
  return { provider: fallbackProvider ?? null, modelId: modelRef };
};

const costFromRaw = (r: RawCostEstimate): CostEstimate => ({
  provider: r.provider,
  model: r.model,
  modelRef: r.model_ref,
  pricingKnown: r.pricing_known,
  textInputUsdPerMillion: r.text_input_usd_per_million,
  audioInputUsdPerMillion: r.audio_input_usd_per_million,
  outputUsdPerMillion: r.output_usd_per_million,
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

export const aiCategorizeStart = (): Promise<number> =>
  invoke<number>("ai_categorize_start");

export const aiClusterStart = (): Promise<number> =>
  invoke<number>("ai_cluster_start");

export const aiProposalList = (
  statuses?: ProposalStatus[],
  aiRunId?: number,
): Promise<ProposalDTO[]> =>
  invoke<ProposalDTO[]>("ai_proposal_list", { statuses, aiRunId });

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

export const aiRunGet = (runId: number): Promise<AiRunDTO> =>
  invoke<AiRunDTO>("ai_run_get", { runId });

export const aiRunDetail = (runId: number): Promise<AiRunDetailDTO> =>
  invoke<AiRunDetailDTO>("ai_run_detail", { runId });

export const aiRunRetry = (runId: number): Promise<void> =>
  invoke("ai_run_retry", { runId });

export const aiCostEstimate = async (
  kind: CostEstimateKind,
  args: unknown,
): Promise<CostEstimate> =>
  costFromRaw(await invoke<RawCostEstimate>("ai_cost_estimate", { kind, args }));
