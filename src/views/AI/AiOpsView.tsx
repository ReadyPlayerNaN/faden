import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { aiRunList } from "../../ipc/ai";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { onTranscriptionProgress } from "../../ipc/transcribe";
import { activeAiOperationsAtom, aiRunHistoryAtom } from "../../state/ai";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import { transcriptionRunsAtom } from "../../state/transcription";
import { buildDisplayOperations, formatTimestamp } from "./aiOperations";
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

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  const refresh = async () => {
    const [nextInterviews, nextRuns] = await Promise.all([
      fetchInterviews(),
      aiRunList(),
    ]);
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
    void onTranscriptionProgress((p) => {
      setRuns((prev) => ({
        ...prev,
        [p.interview_id]: { lastProgress: p, updatedAt: Date.now() },
      }));
      if (p.stage === "complete" || p.stage === "failed" || p.stage === "cancelled") {
        void fetchInterviews().then(setInterviews);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [setInterviews, setRuns]);

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

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("ai.opsTitle")}</h1>
          <p className={styles.subtitle}>
            {project?.name ?? t("common.loading")}
          </p>
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
              <OperationCard key={op.id} projectPath={projectPath} {...op} />
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
              <OperationCard key={op.id} projectPath={projectPath} {...op} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

type OperationCardProps = ReturnType<typeof buildDisplayOperations>["all"][number] & {
  projectPath: string;
};

const OperationCard = ({
  runId,
  kind,
  status,
  title,
  label,
  summary,
  error,
  startedAt,
  completedAt,
  model,
  projectPath,
}: OperationCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clickable = runId !== null;

  const body = (
    <>
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
      <div className={styles.meta}>
        <span>
          {t("ai.startedAt")}: {formatTimestamp(startedAt)}
        </span>
        {completedAt && (
          <span>
            {t("ai.completedAt")}: {formatTimestamp(completedAt)}
          </span>
        )}
        {model && <span>{model}</span>}
        <span>{t(`ai.kinds.${kind}`)}</span>
      </div>
    </>
  );

  return (
    <li className={styles.opsItem}>
      {clickable ? (
        <button
          type="button"
          className={styles.opsButton}
          onClick={() =>
            void navigate({
              to: "/workspace/$projectPath/ai-ops/$runId",
              params: { projectPath, runId: String(runId) },
            })
          }
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  );
};
