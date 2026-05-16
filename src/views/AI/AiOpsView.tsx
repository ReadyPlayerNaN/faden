import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import {
  aiRunList,
  aiRunRetry,
  providerLabel,
  type AiRunStageDTO,
} from "../../ipc/ai";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { onTranscriptionProgress } from "../../ipc/transcribe";
import { activeAiOperationsAtom, aiRunHistoryAtom } from "../../state/ai";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import { transcriptionRunsAtom } from "../../state/transcription";
import {
  buildDisplayOperations,
  formatTimestamp,
  stageProgressText,
  type DisplayOperation,
} from "./aiOperations";
import styles from "./AiOpsView.module.css";

export const AiOpsView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const interviews = useAtomValue(interviewListAtom);
  const setInterviews = useSetAtom(interviewListAtom);
  const transcriptionRuns = useAtomValue(transcriptionRunsAtom);
  const setRuns = useSetAtom(transcriptionRunsAtom);
  const activeOps = useAtomValue(activeAiOperationsAtom);
  const [aiRuns, setAiRuns] = useAtom(aiRunHistoryAtom);
  const [loading, setLoading] = useState(true);
  const [retryingRunId, setRetryingRunId] = useState<number | null>(null);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  const refresh = async () => {
    const [nextInterviews, nextRuns] = await Promise.all([fetchInterviews(), aiRunList()]);
    setInterviews(nextInterviews);
    setAiRuns(nextRuns);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [setAiRuns, setInterviews]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onTranscriptionProgress((progress) => {
      setRuns((prev) => {
        const existing = prev[progress.interview_id];
        const runId = progress.run_id ?? existing?.runId ?? null;
        const startedAt =
          progress.stage === "starting" ? Date.now() : existing?.startedAt ?? Date.now();
        return {
          ...prev,
          [progress.interview_id]: {
            runId,
            startedAt,
            lastProgress: progress,
            updatedAt: Date.now(),
          },
        };
      });
      if (
        progress.stage === "complete" ||
        progress.stage === "failed" ||
        progress.stage === "cancelled"
      ) {
        void refresh();
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [setRuns]);

  const { ongoing, all } = useMemo(
    () =>
      buildDisplayOperations({
        interviews,
        transcriptionRuns,
        activeOps,
        aiRuns,
        t,
      }),
    [activeOps, aiRuns, interviews, t, transcriptionRuns],
  );

  const history = all.filter((op) => op.status !== "running");

  const retryRun = async (runId: number) => {
    setRetryingRunId(runId);
    try {
      await aiRunRetry(runId);
      await refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryingRunId(null);
    }
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("ai.opsTitle")}</h1>
          <p className={styles.subtitle}>{project?.name ?? t("common.loading")}</p>
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => void refresh()} disabled={loading}>
            {t("ai.refreshOps")}
          </Button>
          <Button
            onClick={() =>
              void navigate({
                to: "/workspace/$projectPath",
                params: { projectPath },
              })
            }
          >
            ← {t("settings.back")}
          </Button>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            {t("ai.ongoingTitle", { defaultValue: "Ongoing" })}
          </h2>
          <span className={styles.sectionCount}>{ongoing.length}</span>
        </div>
        {ongoing.length === 0 ? (
          <p className={styles.empty}>
            {t("ai.noOngoing", { defaultValue: "No ongoing operations" })}
          </p>
        ) : (
          <ul className={styles.opsList}>
            {ongoing.map((op) => (
              <OperationCard
                key={op.id}
                operation={op}
                projectPath={projectPath}
                retrying={retryingRunId === op.runId}
                onRetry={retryRun}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            {t("ai.historyTitle", { defaultValue: "History" })}
          </h2>
          <span className={styles.sectionCount}>{history.length}</span>
        </div>
        {all.length === 0 ? (
          <p className={styles.empty}>{t("ai.noOperations")}</p>
        ) : history.length === 0 ? (
          <p className={styles.empty}>
            {t("ai.noHistory", { defaultValue: "No historical operations yet" })}
          </p>
        ) : (
          <ul className={styles.opsList}>
            {history.map((op) => (
              <OperationCard
                key={op.id}
                operation={op}
                projectPath={projectPath}
                retrying={retryingRunId === op.runId}
                onRetry={retryRun}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

type OperationCardProps = {
  operation: DisplayOperation;
  projectPath: string;
  retrying: boolean;
  onRetry: (runId: number) => Promise<void>;
};

const StageBadge = ({ stage }: { stage: AiRunStageDTO }) => {
  const { t } = useTranslation();
  return (
    <li className={`${styles.stageItem} ${styles[`status_${stage.status}`] ?? ""}`}>
      <span>{stageProgressText(stage, t)}</span>
      <span className={styles.stageStatus}>{t(`ai.stageStatus.${stage.status}`)}</span>
    </li>
  );
};

const OperationCard = ({ operation, projectPath, retrying, onRetry }: OperationCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    runId,
    kind,
    status,
    title,
    label,
    summary,
    error,
    startedAt,
    completedAt,
    provider,
    modelId,
    stages,
    retryAvailable,
  } = operation;
  const clickable = runId !== null;

  return (
    <li className={styles.opsItem}>
      <div className={styles.opsCardBody}>
        <div className={styles.opsTopRow}>
          <span className={styles.kind}>{title}</span>
          <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
            {status === "running" && <span className={styles.loaderInline} aria-hidden="true" />}
            {t(`ai.status.${status}`)}
          </span>
        </div>
        {label && label !== title && <div className={styles.summary}>{label}</div>}
        {summary && <div className={styles.summary}>{summary}</div>}
        {error && <div className={styles.error}>{error}</div>}
        {(provider || modelId) && (
          <div className={styles.badgesRow}>
            {provider && <span className={styles.modelBadge}>{providerLabel(provider) ?? provider}</span>}
            {modelId && <span className={styles.modelBadge}>{modelId}</span>}
          </div>
        )}
        {stages.length > 0 && (
          <ul className={styles.stageList}>
            {stages.map((stage) => (
              <StageBadge key={`${operation.id}-${stage.key}`} stage={stage} />
            ))}
          </ul>
        )}
        <div className={styles.meta}>
          <span>
            {t("ai.startedAt")}: {formatTimestamp(startedAt)}
          </span>
          {completedAt && (
            <span>
              {t("ai.completedAt")}: {formatTimestamp(completedAt)}
            </span>
          )}
          <span>{t(`ai.kinds.${kind}`)}</span>
        </div>
      </div>

      <div className={styles.cardActions}>
        {clickable && (
          <Button
            onClick={() =>
              void navigate({
                to: "/workspace/$projectPath/ai-ops/$runId",
                params: { projectPath, runId: String(runId) },
              })
            }
          >
            {t("common.open")}
          </Button>
        )}
        {retryAvailable && runId !== null && (
          <Button onClick={() => void onRetry(runId)} disabled={retrying}>
            {retrying ? t("common.loading") : t("common.retry")}
          </Button>
        )}
      </div>
    </li>
  );
};
