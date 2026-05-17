import type { TFunction } from "i18next";
import { parseModelRef } from "../../ipc/ai";
import type {
  AiRunDTO,
  AiRunKind,
  AiRunStageDTO,
  AiRunStageKey,
  AiRunStatus,
  ProposalKind,
} from "../../ipc/ai";
import type { Interview } from "../../ipc/interview";
import type { LocalAiOperation } from "../../state/ai";
import type { RunSnapshot } from "../../state/transcription";

export type DisplayOperation = {
  id: string;
  runId: number | null;
  kind: AiRunKind;
  status: AiRunStatus;
  startedAt: string;
  completedAt: string | null;
  provider: string | null;
  model: string | null;
  modelId: string | null;
  summary: string | null;
  error: string | null;
  label?: string;
  interviewId: number | null;
  interviewName: string | null;
  title: string;
  relatedScopeLabel: string;
  stages: AiRunStageDTO[];
  retryAvailable: boolean;
};

export const isAcknowledgedOperation = (
  operation: DisplayOperation,
  acknowledgedRuns: Record<number, boolean>,
) => operation.status === "failed" && operation.runId !== null && !!acknowledgedRuns[operation.runId];

export const isUnresolvedOperation = (
  operation: DisplayOperation,
  acknowledgedRuns: Record<number, boolean>,
) => operation.status === "running" || (operation.status === "failed" && !isAcknowledgedOperation(operation, acknowledgedRuns));

const TRANSCRIPTION_RUNNING_STAGES = new Set([
  "starting",
  "analyzing_source",
  "preparing_chunks",
  "encoding_chunk",
  "transcribing_chunk",
  "composing_transcript",
]);

const TRANSCRIPTION_STAGE_ORDER: AiRunStageKey[] = [
  "analyze_source",
  "prepare_chunks",
  "encode_chunks",
  "transcribe_chunks",
  "compose_transcript",
  "finalize",
];

const isTranscriptionRunning = (
  stage: import("../../ipc/transcribe").TranscriptionProgress["stage"],
) => TRANSCRIPTION_RUNNING_STAGES.has(stage);

export const formatTimestamp = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const sortByStartedAtDesc = (items: DisplayOperation[]) =>
  [...items].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime();
    const bTime = new Date(b.startedAt).getTime();
    return bTime - aTime;
  });

type RunInputMetadata = {
  provider?: string;
  tag_id?: number;
  tag_name?: string;
};

const parseRunInputMetadata = (inputJson: string | null): RunInputMetadata | null => {
  if (!inputJson) return null;
  try {
    return JSON.parse(inputJson) as RunInputMetadata;
  } catch {
    return null;
  }
};

const operationTitle = (
  kind: AiRunKind,
  t: TFunction,
  metadata?: RunInputMetadata | null,
) => {
  if (kind === "find_more" && metadata?.tag_name) {
    return t("ai.findMoreTagTitle", {
      name: metadata.tag_name,
      defaultValue: 'Find more "{{name}}"',
    });
  }
  return t(`ai.kinds.${kind}`);
};

const relatedScopeLabel = (interviewName: string | null, t: TFunction) =>
  interviewName
    ? t("ai.relatedInterviewValue", {
        name: interviewName,
        defaultValue: "Interview: {{name}}",
      })
    : t("ai.projectWide", { defaultValue: "Project-wide" });

const stageLabel = (key: AiRunStageKey, t: TFunction) =>
  t(`ai.operationStages.${key}`);

export const stageProgressText = (stage: AiRunStageDTO, t: TFunction) => {
  if (stage.totalCount === null || stage.completedCount === null) {
    return stageLabel(stage.key, t);
  }
  return t("ai.operationStageProgress", {
    stage: stageLabel(stage.key, t),
    completed: stage.completedCount,
    total: stage.totalCount,
    defaultValue: "{{stage}} {{completed}}/{{total}}",
  });
};

const labelFromSnapshot = (run: RunSnapshot, t: TFunction) => {
  const { lastProgress } = run;
  switch (lastProgress.stage) {
    case "starting":
    case "analyzing_source":
      return stageLabel("analyze_source", t);
    case "preparing_chunks":
      return t("ai.operationStageProgress", {
        stage: stageLabel("prepare_chunks", t),
        completed: lastProgress.total_chunks,
        total: lastProgress.total_chunks,
      });
    case "encoding_chunk":
      return t("ai.operationStageProgress", {
        stage: stageLabel("encode_chunks", t),
        completed: lastProgress.index + 1,
        total: lastProgress.total,
      });
    case "transcribing_chunk":
      return t("ai.operationStageProgress", {
        stage: stageLabel("transcribe_chunks", t),
        completed: lastProgress.index + 1,
        total: lastProgress.total,
      });
    case "composing_transcript":
      return stageLabel("compose_transcript", t);
    case "complete":
      return stageLabel("finalize", t);
    case "failed":
      return lastProgress.message;
    case "cancelled":
      return t("ai.status.cancelled");
  }
};

const stageStatusFromSnapshot = (
  run: RunSnapshot,
  key: AiRunStageKey,
): AiRunStageDTO["status"] => {
  const stage = run.lastProgress.stage;
  if (stage === "complete") return "complete";
  if (stage === "cancelled") return key === "finalize" ? "cancelled" : "complete";
  if (stage === "failed") return key === "finalize" ? "failed" : "complete";

  const indexByEvent = {
    starting: 0,
    analyzing_source: 0,
    preparing_chunks: 1,
    encoding_chunk: 2,
    transcribing_chunk: 3,
    composing_transcript: 4,
  } as const;
  const stageOrder = TRANSCRIPTION_STAGE_ORDER.indexOf(key);
  const currentOrder = indexByEvent[stage];
  if (stageOrder < currentOrder) return "complete";
  if (stageOrder === currentOrder) return "running";
  return "pending";
};

const buildLiveStages = (run: RunSnapshot): AiRunStageDTO[] =>
  TRANSCRIPTION_STAGE_ORDER.map((key, order) => {
    let totalCount: number | null = null;
    let completedCount: number | null = null;
    if (key === "prepare_chunks" && run.lastProgress.stage === "preparing_chunks") {
      totalCount = run.lastProgress.total_chunks;
      completedCount = run.lastProgress.total_chunks;
    }
    if (key === "encode_chunks" && run.lastProgress.stage === "encoding_chunk") {
      totalCount = run.lastProgress.total;
      completedCount = run.lastProgress.index + 1;
    }
    if (key === "transcribe_chunks") {
      if (run.lastProgress.stage === "transcribing_chunk") {
        totalCount = run.lastProgress.total;
        completedCount = run.lastProgress.index;
      }
      if (run.lastProgress.stage === "composing_transcript") {
        totalCount = run.lastProgress.total_chunks;
        completedCount = run.lastProgress.completed_chunks;
      }
      if (run.lastProgress.stage === "complete") {
        totalCount = 1;
        completedCount = 1;
      }
    }
    return {
      id: -(order + 1),
      aiRunId: run.runId ?? 0,
      key,
      order,
      status: stageStatusFromSnapshot(run, key),
      totalCount,
      completedCount,
      failedCount: 0,
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: null,
      error: null,
    };
  });

const mergeLiveStageProgress = (stages: AiRunStageDTO[], run: RunSnapshot) => {
  const liveStages = new Map(buildLiveStages(run).map((stage) => [stage.key, stage]));
  return stages.map((stage) => {
    const live = liveStages.get(stage.key);
    if (!live) return stage;
    if (live.status === "running") {
      return {
        ...stage,
        status: live.status,
        totalCount: live.totalCount ?? stage.totalCount,
        completedCount: live.completedCount ?? stage.completedCount,
      };
    }
    return stage;
  });
};

const labelFromStages = (stages: AiRunStageDTO[], t: TFunction) => {
  const running = stages.find((stage) => stage.status === "running" || stage.status === "retrying");
  if (running) return stageProgressText(running, t);
  const failed = stages.find((stage) => stage.status === "failed");
  if (failed) return failed.error ?? stageLabel(failed.key, t);
  const lastComplete = [...stages].reverse().find((stage) => stage.status === "complete");
  return lastComplete ? stageProgressText(lastComplete, t) : undefined;
};

export const buildDisplayOperations = ({
  interviews,
  transcriptionRuns,
  activeOps,
  aiRuns,
  t,
}: {
  interviews: Interview[];
  transcriptionRuns: Record<number, RunSnapshot>;
  activeOps: LocalAiOperation[];
  aiRuns: AiRunDTO[];
  t: TFunction;
}) => {
  const interviewNameById = new Map(interviews.map((interview) => [interview.id, interview.name]));
  const liveByRunId = new Map<number, RunSnapshot>();
  const liveByInterviewId = new Map<number, RunSnapshot>();

  Object.entries(transcriptionRuns)
    .filter(([, run]) => isTranscriptionRunning(run.lastProgress.stage))
    .forEach(([interviewId, run]) => {
      const numericInterviewId = Number(interviewId);
      liveByInterviewId.set(numericInterviewId, run);
      if (run.runId !== null) {
        liveByRunId.set(run.runId, run);
      }
    });

  const localOps: DisplayOperation[] = activeOps.map((op) => {
    const interviewName =
      op.interviewId !== null ? interviewNameById.get(op.interviewId) ?? null : null;
    return {
      id: op.id,
      runId: op.runId ?? null,
      kind: op.kind,
      status: "running",
      startedAt: op.startedAt,
      completedAt: null,
      provider: null,
      model: null,
      modelId: null,
      summary: null,
      error: null,
      label: op.label,
      interviewId: op.interviewId,
      interviewName,
      title: op.title ?? operationTitle(op.kind, t),
      relatedScopeLabel: relatedScopeLabel(interviewName, t),
      stages: [],
      retryAvailable: false,
    };
  });

  const localRunIds = new Set(activeOps.map((op) => op.runId).filter((id): id is number => id !== null && id !== undefined));
  const runningLocalSignatures = new Set(
    activeOps.map((op) => `${op.kind}:${op.interviewId ?? "none"}`),
  );

  const persisted: DisplayOperation[] = aiRuns
    .filter((run) => {
      if (run.status !== "running") return true;
      if (localRunIds.has(run.id)) return false;
      return !runningLocalSignatures.has(`${run.kind}:${run.interviewId ?? "none"}`);
    })
    .map((run: AiRunDTO) => {
      const interviewName =
        run.interviewId !== null ? interviewNameById.get(run.interviewId) ?? null : null;
      const live = liveByRunId.get(run.id) ?? (run.interviewId !== null ? liveByInterviewId.get(run.interviewId) : undefined);
      const stages = live ? mergeLiveStageProgress(run.stages, live) : run.stages;
      const parsedModel = parseModelRef(run.model, run.provider);
      const metadata = parseRunInputMetadata(run.inputJson);
      return {
        id: `run-${run.id}`,
        runId: run.id,
        kind: run.kind,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        provider: parsedModel.provider,
        model: run.model,
        modelId: parsedModel.modelId,
        summary: run.resultSummary,
        error: run.error,
        label: live ? labelFromSnapshot(live, t) : labelFromStages(stages, t),
        interviewId: run.interviewId,
        interviewName,
        title: operationTitle(run.kind, t, metadata),
        relatedScopeLabel: relatedScopeLabel(interviewName, t),
        stages,
        retryAvailable:
          run.kind === "transcribe" && (run.status === "failed" || run.status === "cancelled"),
      };
    });

  const syntheticLiveRuns: DisplayOperation[] = Object.entries(transcriptionRuns)
    .filter(([, run]) => isTranscriptionRunning(run.lastProgress.stage))
    .filter(([, run]) => run.runId === null || !aiRuns.some((aiRun) => aiRun.id === run.runId))
    .map(([interviewId, run]) => {
      const numericInterviewId = Number(interviewId);
      const interviewName = interviewNameById.get(numericInterviewId) ?? null;
      const stages = buildLiveStages(run);
      return {
        id: `transcribe-live-${interviewId}`,
        runId: run.runId,
        kind: "transcribe",
        status: "running",
        startedAt: new Date(run.startedAt).toISOString(),
        completedAt: null,
        provider: null,
        model: null,
        modelId: null,
        summary: null,
        error: null,
        label: labelFromSnapshot(run, t),
        interviewId: numericInterviewId,
        interviewName,
        title: operationTitle("transcribe", t),
        relatedScopeLabel: relatedScopeLabel(interviewName, t),
        stages,
        retryAvailable: false,
      };
    });

  const ongoing = sortByStartedAtDesc([
    ...localOps,
    ...syntheticLiveRuns,
    ...persisted.filter((run) => run.status === "running"),
  ]);

  const all = sortByStartedAtDesc([...localOps, ...syntheticLiveRuns, ...persisted]);

  return { ongoing, all };
};

export const isProposalKind = (kind: AiRunKind): kind is ProposalKind =>
  kind === "codebook_gen" ||
  kind === "pretag" ||
  kind === "find_more" ||
  kind === "categorize" ||
  kind === "cluster";
