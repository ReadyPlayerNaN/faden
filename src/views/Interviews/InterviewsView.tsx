import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { PageViewHeader } from "../../components/PageViewHeader/PageViewHeader";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { projectOpen } from "../../ipc/project";
import { currentProjectAtom } from "../../state/project";
import { AddInterviewModal } from "../Workspace/LeftPane/AddInterviewModal";
import { InterviewList } from "../Workspace/LeftPane/InterviewList";
import styles from "./InterviewsView.module.css";

export const InterviewsView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const decodedProjectPath = decodeURIComponent(projectPath);
    if (!project || project.path !== decodedProjectPath) {
      void projectOpen(decodedProjectPath).then(setProject);
    }
  }, [projectPath, project, setProject]);

  return (
    <div className={styles.shell}>
      <ProjectHeader activeView="interviews" />
      <PageContainer className={styles.wrap}>
        <PageViewHeader
          view="interviews"
          title={t("workspace.interviews", { defaultValue: "Interviews" })}
          subtitle={t("workspace.interviewsSubtitle", {
            defaultValue:
              "Manage interviews here. Select one to open it in Coding view.",
          })}
          aside={
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              + {t("workspace.createInterview", { defaultValue: "Add interview" })}
            </Button>
          }
        />

        <div className={styles.listCard}>
          <InterviewList
            onAddInterview={() => setModalOpen(true)}
            onSelectInterview={() => {
              void navigate({
                to: "/workspace/$projectPath",
                params: { projectPath },
              });
            }}
          />
        </div>
      </PageContainer>
      {modalOpen && <AddInterviewModal onClose={() => setModalOpen(false)} />}
    </div>
  );
};