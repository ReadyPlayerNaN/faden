import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { TextField } from "../../components/TextField/TextField";
import { SearchableSelect } from "../../components/SearchableSelect/SearchableSelect";
import { getProjectLanguageOptions } from "../../i18n/projectLanguages";
import styles from "../ProjectPicker/ProjectCreateModal.module.css";

type Props = {
  open: boolean;
  initialName: string;
  initialLanguage: string;
  onClose: () => void;
  onSave: (name: string, language: string) => Promise<void>;
};

export const EditProjectModal = ({
  open,
  initialName,
  initialLanguage,
  onClose,
  onSave,
}: Props) => {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(initialName);
  const [language, setLanguage] = useState(initialLanguage);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const languageOptions = useMemo(
    () => getProjectLanguageOptions(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  );

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      return;
    }
    setName(initialName);
    setLanguage(initialLanguage);
    setError(null);
    setBusy(false);
  }, [initialLanguage, initialName, open]);

  const onSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !language) {
      setError(t("errors.invalid") as string);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(trimmedName, language);
      onClose();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t("workspace.editProject", { defaultValue: "Edit project" })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={busy}>
            {t("common.save", { defaultValue: "Save" })}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <TextField
          label={t("settings.projectName") as string}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SearchableSelect
          label={t("settings.projectLanguage") as string}
          value={language}
          options={languageOptions}
          placeholder={t("settings.projectLanguagePlaceholder") as string}
          searchPlaceholder={t("settings.projectLanguageSearch") as string}
          emptyText={t("settings.projectLanguageEmpty") as string}
          helpText={t("settings.projectLanguageHelp") as string}
          onChange={setLanguage}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
      </form>
    </Modal>
  );
};
