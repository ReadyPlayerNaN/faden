import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { settingsGet, settingsSet } from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { currentProjectAtom } from "../../state/project";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { ErrorBanner } from "../../components/ErrorBanner";
import { PromptEditors } from "./PromptEditors";
import styles from "./Settings.module.css";

type LangChoice = "auto" | "en" | "cs";

export const Settings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath: backProjectPath } = useParams({ strict: false }) as {
    projectPath?: string;
  };
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [project, setProject] = useAtom(currentProjectAtom);
  const [apiKey, setApiKey] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [uiLanguage, setUiLanguage] = useState<LangChoice>("auto");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const applySettings = (next: NonNullable<typeof settings>) => {
    setSettings(next);
    setApiKey(next.geminiApiKey);
    setTranscriptionModel(next.defaultTranscriptionModel);
    setAiModel(next.defaultAiModel);
    setUiLanguage((next.uiLanguage as LangChoice | null) ?? "auto");
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setSaveError(null);
    void settingsGet()
      .then((s) => {
        if (cancelled) return;
        applySettings(s);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSaveError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  const onSave = async () => {
    if (!settings || isLoading || isSaving) return;
    const next = {
      ...settings,
      geminiApiKey: apiKey,
      defaultTranscriptionModel: transcriptionModel,
      defaultAiModel: aiModel,
      uiLanguage: uiLanguage === "auto" ? null : uiLanguage,
    };
    setIsSaving(true);
    setSaveError(null);
    try {
      await settingsSet(next);
      const confirmed = await settingsGet();
      applySettings(confirmed);
      setSavedAt(Date.now());
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
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
              backProjectPath
                ? {
                    to: "/workspace/$projectPath",
                    params: { projectPath: backProjectPath },
                  }
                : { to: "/" },
            )
          }
        >
          ← {t("settings.back")}
        </Button>
      </header>

      <section className={styles.section}>
        {saveError ? (
          <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
        ) : null}
        <div className={styles.field}>
          <TextField
            label={t("settings.geminiApiKey")}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isLoading || isSaving}
          />
        </div>
        <div className={styles.field}>
          <TextField
            label={t("settings.defaultTranscriptionModel")}
            value={transcriptionModel}
            onChange={(e) => setTranscriptionModel(e.target.value)}
            disabled={isLoading || isSaving}
          />
        </div>
        <div className={styles.field}>
          <TextField
            label={t("settings.defaultAiModel")}
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            disabled={isLoading || isSaving}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>
            {t("settings.uiLanguage")}
            <select
              className={styles.select}
              value={uiLanguage}
              onChange={(e) => setUiLanguage(e.target.value as LangChoice)}
              disabled={isLoading || isSaving}
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              <option value="en">{t("settings.languageEn")}</option>
              <option value="cs">{t("settings.languageCs")}</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => void onSave()}
            disabled={isLoading || isSaving || !settings}
          >
            {isSaving ? t("common.loading") : t("settings.save")}
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
