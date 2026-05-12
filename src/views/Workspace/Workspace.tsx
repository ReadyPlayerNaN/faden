import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { projectOpen } from "../../ipc/project";
import { currentProjectAtom } from "../../state/project";
import { Button } from "../../components/Button/Button";
import { LeftPane } from "./LeftPane/LeftPane";
import styles from "./Workspace.module.css";

export const Workspace = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

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
        <section className={styles.center}>
          <p className={styles.empty}>{t("workspace.centerPaneEmpty")}</p>
        </section>
        <aside className={styles.right}>
          <p className={styles.empty}>{t("workspace.rightPaneEmpty")}</p>
        </aside>
      </div>
    </div>
  );
};
