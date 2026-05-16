import type { TFunction } from "i18next";
import type { AiRunDTO, AiRunKind, AiRunStatus, ProposalKind } from "../../ipc/ai";
import type { Interview } from "../../ipc/interview";
import type { LocalAiOperation } from "../../state/ai";
import type { RunSnapshot } from "../../state/transcription";

export type DisplayOperation = {
  id: string;
  kind: AiRunKind;
  status: AiRunStatus;
  startedAt: string;
  completedAt: string | null;
  model: string | null;
  summary: string | null;
  error: string | null;
  label?: string;
  interviewId: number | null;
  interviewName: string | null;
  title: string;
};

const isTranscriptionRunning = (
  stage: import("../../ipc/transcribe").TranscriptionProgress["stage"],
) =>
  stage === "starting" ||
  stage === "normalizing" ||
  stage === "chunking" ||
  stage === "transcribing_chunk" ||
  stage === "chunk_complete";

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

const operationTitle = (
  kind: AiRunKind,
  interviewName: string | null,
  t: TFunction,
) => {
  const kindLabel = t(`ai.kinds.${kind}`);
  if (interviewName) {
    return t("ai.operationWithInterview", {
      kind: kindLabel,
      name: interviewName,
      defaultValue: "{{kind}} {{name}}",
    });
  }
  return kindLabel;
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

  const transcriptionOps: DisplayOperation[] = Object.entries(transcriptionRuns)
    .filter(([, run]) => isTranscriptionRunning(run.lastProgress.stage))
    .map(([interviewId, run]) => {
      let label = t("workspace.transcribing");
      if (run.lastProgress.stage === "transcribing_chunk") {
        label = t("workspace.transcribingChunk", {
          index: run.lastProgress.index + 1,
          total: run.lastProgress.total,
        });
      }
      const numericInterviewId = Number(interviewId);
      const interviewName = interviewNameById.get(numericInterviewId) ?? null;
      return {
        id: `transcribe-live-${interviewId}`,
        kind: "transcribe",
        status: "running",
        startedAt: new Date(run.updatedAt).toISOString(),
        completedAt: null,
        model: null,
        summary: null,
        error: null,
        label,
        interviewId: numericInterviewId,
        interviewName,
        title: operationTitle("transcribe", interviewName, t),
      };
    });

  const localOps: DisplayOperation[] = activeOps.map((op) => {
    const interviewName =
      op.interviewId !== null ? interviewNameById.get(op.interviewId) ?? null : null;
    return {
      id: op.id,
      kind: op.kind,
      status: "running",
      startedAt: op.startedAt,
      completedAt: null,
      model: null,
      summary: null,
      error: null,
      label: op.label,
      interviewId: op.interviewId,
      interviewName,
      title: operationTitle(op.kind, interviewName, t),
    };
  });

  const liveTranscribeIds = new Set(
    transcriptionOps.map((op) => op.interviewId).filter((id) => id !== null),
  );

  const localRunIds = new Set(activeOps.map((op) => op.runId).filter((id) => id !== null));
  const runningLocalSignatures = new Set(
    activeOps.map((op) => `${op.kind}:${op.interviewId ?? "none"}`),
  );

  const persisted: DisplayOperation[] = aiRuns
    .filter((run) => {
      if (
        run.kind === "transcribe" &&
        run.status === "running" &&
        run.interviewId !== null &&
        liveTranscribeIds.has(run.interviewId)
      ) {
        return false;
      }
      if (run.status !== "running") {
        return true;
      }
      if (localRunIds.has(run.id)) {
        return false;
      }
      return !runningLocalSignatures.has(`${run.kind}:${run.interviewId ?? "none"}`);
    })
    .map((run: AiRunDTO) => {
      const interviewName =
        run.interviewId !== null ? interviewNameById.get(run.interviewId) ?? null : null;
      return {
        id: `run-${run.id}`,
        kind: run.kind,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        model: run.model,
        summary: run.resultSummary,
        error: run.error,
        interviewId: run.interviewId,
        interviewName,
        title: operationTitle(run.kind, interviewName, t),
      };
    });

  const ongoing = sortByStartedAtDesc([
    ...localOps,
    ...transcriptionOps,
    ...persisted.filter((run) => run.status === "running"),
  ]);

  const all = sortByStartedAtDesc([...localOps, ...transcriptionOps, ...persisted]);

  return { ongoing, all };
};

export const isProposalKind = (kind: AiRunKind): kind is ProposalKind =>
  kind === "codebook_gen" || kind === "pretag" || kind === "find_more";
