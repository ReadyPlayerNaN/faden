import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { TextField } from "../../components/TextField/TextField";
import styles from "../ProjectPicker/ProjectCreateModal.module.css";

type Props = {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
};

export const EditProjectModal = ({ open, initialName, onClose, onSave }: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      return;
    }
    setName(initialName);
    setError(null);
    setBusy(false);
  }, [initialName, open]);

  const onSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("errors.invalid") as string);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(trimmedName);
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
        {error ? <p className={styles.error}>{error}</p> : null}
      </form>
    </Modal>
  );
};
