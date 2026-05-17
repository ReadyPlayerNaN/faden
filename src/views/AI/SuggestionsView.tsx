import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { currentProjectAtom } from "../../state/project";
import { interviewListAtom } from "../../state/interview";
import { activeProposalIdAtom } from "../../state/ai";
import { StagingPanel } from "../Workspace/AI/StagingPanel";
import styles from "./SuggestionsView.module.css";

export const SuggestionsView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const setInterviews = useSetAtom(interviewListAtom);
  const setActiveProposalId = useSetAtom(activeProposalIdAtom);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  useEffect(() => {
    void fetchInterviews().then(setInterviews).catch(() => undefined);
    return () => {
      setActiveProposalId(null);
    };
  }, [setActiveProposalId, setInterviews]);

  return (
    <div className={styles.shell}>
      <ProjectHeader
        activeView="coding"
        actions={
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
        }
      />
      <PageContainer className={styles.content} size="wide">
        <header className={styles.header}>
          <h1 className={styles.title}>
            {t("ai.suggestionsCenterTitle", {
              defaultValue: "Suggestions center",
            })}
          </h1>
          <p className={styles.subtitle}>{project?.name ?? t("common.loading")}</p>
        </header>
        <StagingPanel
          fullHeight
          initialSelectedStatuses={["pending", "accepted", "rejected"]}
        />
      </PageContainer>
    </div>
  );
};
