import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { settingsGet, settingsSet } from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { currentProjectAtom } from "../../state/project";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { PromptEditors } from "./PromptEditors";
import styles from "./Settings.module.css";

type LangChoice = "auto" | "en" | "cs";

export const Settings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [project, setProject] = useAtom(currentProjectAtom);
  const [apiKey, setApiKey] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [uiLanguage, setUiLanguage] = useState<LangChoice>("auto");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!settings) {
      void settingsGet().then((s) => {
        setSettings(s);
        setApiKey(s.geminiApiKey);
        setTranscriptionModel(s.defaultTranscriptionModel);
        setAiModel(s.defaultAiModel);
        setUiLanguage((s.uiLanguage as LangChoice | null) ?? "auto");
      });
    } else {
      setApiKey(settings.geminiApiKey);
      setTranscriptionModel(settings.defaultTranscriptionModel);
      setAiModel(settings.defaultAiModel);
      setUiLanguage((settings.uiLanguage as LangChoice | null) ?? "auto");
    }
  }, [settings, setSettings]);

  const onSave = async () => {
    if (!settings) return;
    const next = {
      ...settings,
      geminiApiKey: apiKey,
      defaultTranscriptionModel: transcriptionModel,
      defaultAiModel: aiModel,
      uiLanguage: uiLanguage === "auto" ? null : uiLanguage,
    };
    await settingsSet(next);
    setSettings(next);
    setSavedAt(Date.now());
  };

  const onRenameProject = async () => {
    if (!project) return;
    const next = window.prompt(t("settings.projectName"), project.name);
    if (!next || next === project.name) return;
    await invoke("project_rename", { name: next });
    setProject({ ...project, name: next });
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("settings.title")}</h1>
        <Button
          onClick={() =>
            void navigate(
              project
                ? {
                    to: "/workspace/$projectPath",
                    params: { projectPath: encodeURIComponent(project.path) },
                  }
                : { to: "/" },
            )
          }
        >
          ← {t("settings.back")}
        </Button>
      </header>

      <section className={styles.section}>
        <div className={styles.field}>
          <TextField
            label={t("settings.geminiApiKey")}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <TextField
            label={t("settings.defaultTranscriptionModel")}
            value={transcriptionModel}
            onChange={(e) => setTranscriptionModel(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <TextField
            label={t("settings.defaultAiModel")}
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>
            {t("settings.uiLanguage")}
            <select
              className={styles.select}
              value={uiLanguage}
              onChange={(e) => setUiLanguage(e.target.value as LangChoice)}
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              <option value="en">{t("settings.languageEn")}</option>
              <option value="cs">{t("settings.languageCs")}</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void onSave()}>
            {t("settings.save")}
          </Button>
          {savedAt && (
            <span className={styles.saved}>{t("settings.saved")}</span>
          )}
        </div>
      </section>

      {project && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("settings.projectSection")}</h2>
          <div className={styles.projectRow}>
            <span className={styles.projectName}>{project.name}</span>
            <Button onClick={() => void onRenameProject()}>
              {t("settings.rename")}
            </Button>
          </div>
        </section>
      )}

      <PromptEditors />
    </div>
  );
};
