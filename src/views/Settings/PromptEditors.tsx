import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  projectSettingsGet,
  projectSettingsSet,
  type ProjectSettings,
} from "../../ipc/projectSettings";
import { Button } from "../../components/Button/Button";
import styles from "./PromptEditors.module.css";

const FIELDS = [
  {
    key: "transcriptionSystem",
    labelKey: "settings.prompts.transcriptionSystem",
  },
  { key: "transcriptionUser", labelKey: "settings.prompts.transcriptionUser" },
  { key: "codebookGen", labelKey: "settings.prompts.codebookGen" },
  { key: "pretag", labelKey: "settings.prompts.pretag" },
  { key: "findMore", labelKey: "settings.prompts.findMore" },
  { key: "categorize", labelKey: "settings.prompts.categorize" },
  { key: "cluster", labelKey: "settings.prompts.cluster" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export const PromptEditors = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void projectSettingsGet()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  if (!settings) return <p>{t("common.loading")}</p>;

  const onChange = (key: FieldKey, value: string | null) => {
    setSettings({
      ...settings,
      prompts: { ...settings.prompts, [key]: value },
    });
  };

  const onSave = async () => {
    await projectSettingsSet(settings);
    setSavedAt(Date.now());
  };

  return (
    <section className={styles.wrap}>
      <h2>{t("settings.prompts.title")}</h2>
      {FIELDS.map((f) => (
        <div key={f.key} className={styles.field}>
          <div className={styles.head}>
            <label className={styles.label}>{t(f.labelKey)}</label>
            <Button onClick={() => onChange(f.key, null)}>
              {t("settings.reset")}
            </Button>
          </div>
          <textarea
            className={styles.textarea}
            value={settings.prompts[f.key] ?? ""}
            placeholder={t("settings.prompts.usesDefault") as string}
            onChange={(e) => onChange(f.key, e.target.value || null)}
            rows={6}
          />
        </div>
      ))}
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void onSave()}>
          {t("settings.save")}
        </Button>
        {savedAt && <span className={styles.saved}>{t("settings.saved")}</span>}
      </div>
    </section>
  );
};
