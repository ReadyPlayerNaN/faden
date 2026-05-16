import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { projectCreate, projectOpen } from "../../ipc/project";
import {
  settingsAddRecent,
  settingsGet,
  settingsRecentRemove,
} from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { currentProjectAtom } from "../../state/project";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ProjectCreateModal } from "./ProjectCreateModal";
import styles from "./ProjectPicker.module.css";

export const ProjectPicker = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [, setCurrent] = useAtom(currentProjectAtom);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setCurrent(null);
    void settingsGet().then(setSettings);
  }, [setCurrent, setSettings]);

  const goTo = (path: string, name: string) => {
    setCurrent({ path, name });
    void settingsAddRecent(path, name).then(setSettings);
    void navigate({
      to: "/workspace/$projectPath",
      params: { projectPath: encodeURIComponent(path) },
    });
  };

  const onCreateProject = async (name: string) => {
    setError(null);
    const info = await projectCreate(name);
    goTo(info.path, info.name);
  };

  const onOpenFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    setError(null);
    try {
      const info = await projectOpen(dir);
      goTo(info.path, info.name);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const onOpenRecent = async (path: string) => {
    setError(null);
    try {
      const info = await projectOpen(path);
      goTo(info.path, info.name);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const onRemoveRecent = async (path: string) => {
    if (!window.confirm(t("picker.confirmRemove"))) return;
    const updated = await settingsRecentRemove(path);
    setSettings(updated);
  };

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t("picker.title")}</h1>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          {t("picker.newProject")}
        </Button>
        <Button onClick={() => void onOpenFolder()}>
          {t("picker.openFolder")}
        </Button>
      </div>
      <ProjectCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateProject}
      />
      <h2 className={styles.subtitle}>{t("picker.recent")}</h2>
      {settings && settings.recentProjects.length > 0 ? (
        <ul className={styles.recents}>
          {settings.recentProjects.map((p) => (
            <li key={p.path} className={styles.recentRow}>
              <button
                className={styles.recentItem}
                onClick={() => void onOpenRecent(p.path)}
              >
                <span className={styles.recentName}>{p.displayName}</span>
                <span className={styles.recentPath}>{p.path}</span>
              </button>
              <span className={styles.recentActions}>
                <button
                  className={styles.recentAction}
                  onClick={() => void onRemoveRecent(p.path)}
                >
                  {t("picker.remove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t("picker.empty")}</p>
      )}
    </div>
  );
};
