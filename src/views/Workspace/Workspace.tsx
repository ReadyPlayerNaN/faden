import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { projectOpen } from "../../ipc/project";
import { currentProjectAtom } from "../../state/project";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { interviewListAtom } from "../../state/interview";
import { onTranscriptionProgress } from "../../ipc/transcribe";
import { transcriptionRunsAtom } from "../../state/transcription";
import { Button } from "../../components/Button/Button";
import { LeftPane } from "./LeftPane/LeftPane";
import { CenterPane } from "./CenterPane/CenterPane";
import styles from "./Workspace.module.css";

export const Workspace = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const setRuns = useSetAtom(transcriptionRunsAtom);
  const setInterviews = useSetAtom(interviewListAtom);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onTranscriptionProgress((p) => {
      setRuns((prev) => ({ ...prev, [p.interview_id]: { lastProgress: p, updatedAt: Date.now() } }));
      if (p.stage === "complete" || p.stage === "failed" || p.stage === "cancelled") {
        void fetchInterviews().then(setInterviews);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.title}>{project?.name ?? t("common.loading")}</div>
        <div className={styles.headerActions}>
          <Button onClick={() => void navigate({ to: "/settings" })}>
            {t("settings.title")}
          </Button>
          <Button onClick={() => void navigate({ to: "/" })}>
            ← {t("settings.back")}
          </Button>
        </div>
      </header>
      <div className={styles.panes}>
        <LeftPane />
        <CenterPane />
        <aside className={styles.right}>
          <p className={styles.empty}>{t("workspace.rightPaneEmpty")}</p>
        </aside>
      </div>
    </div>
  );
};
