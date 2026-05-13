import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { settingsGet, settingsSet } from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { PromptEditors } from "./PromptEditors";
import styles from "./Settings.module.css";

export const Settings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [apiKey, setApiKey] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!settings) {
      void settingsGet().then((s) => {
        setSettings(s);
        setApiKey(s.geminiApiKey);
      });
    } else {
      setApiKey(settings.geminiApiKey);
    }
  }, [settings, setSettings]);

  const onSave = async () => {
    if (!settings) return;
    const next = { ...settings, geminiApiKey: apiKey };
    await settingsSet(next);
    setSettings(next);
    setSavedAt(Date.now());
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("settings.title")}</h1>
        <Button onClick={() => void navigate({ to: "/" })}>
          ← {t("settings.back")}
        </Button>
      </header>
      <div className={styles.field}>
        <TextField
          label={t("settings.geminiApiKey")}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void onSave()}>
          {t("settings.save")}
        </Button>
        {savedAt && <span className={styles.saved}>{t("settings.saved")}</span>}
      </div>
      <PromptEditors />
    </div>
  );
};
