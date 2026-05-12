import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { projectCreate, projectOpen } from "../../ipc/project";
import { settingsAddRecent, settingsGet } from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { currentProjectAtom } from "../../state/project";
import { Button } from "../../components/Button/Button";
import styles from "./ProjectPicker.module.css";

export const ProjectPicker = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [, setCurrent] = useAtom(currentProjectAtom);

  useEffect(() => {
    void settingsGet().then(setSettings);
  }, [setSettings]);

  const goTo = (path: string, name: string) => {
    setCurrent({ path, name });
    void settingsAddRecent(path).then(setSettings);
    void navigate({
      to: "/workspace/$projectPath",
      params: { projectPath: encodeURIComponent(path) },
    });
  };

  const onNew = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    const name = dir.split(/[\\/]/).pop() ?? "project";
    const info = await projectCreate(dir, name);
    goTo(info.path, info.name);
  };

  const onOpenFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    const info = await projectOpen(dir);
    goTo(info.path, info.name);
  };

  const onOpenRecent = async (path: string) => {
    const info = await projectOpen(path);
    goTo(info.path, info.name);
  };

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t("picker.title")}</h1>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void onNew()}>
          {t("picker.newProject")}
        </Button>
        <Button onClick={() => void onOpenFolder()}>
          {t("picker.openFolder")}
        </Button>
      </div>
      <h2 className={styles.subtitle}>{t("picker.recent")}</h2>
      {settings && settings.recentProjects.length > 0 ? (
        <ul className={styles.recents}>
          {settings.recentProjects.map((p) => (
            <li key={p}>
              <button className={styles.recentItem} onClick={() => void onOpenRecent(p)}>
                {p}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t("picker.empty")}</p>
      )}
    </div>
  );
};
