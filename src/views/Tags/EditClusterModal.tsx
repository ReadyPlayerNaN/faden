import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal/Modal";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import {
  clusterRename,
  clusterSetColor,
  clusterSetDescription,
  type ClusterNode,
} from "../../ipc/codebook";
import styles from "./TagsView.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  cluster: ClusterNode | null;
};

export const EditClusterModal = ({ open, onClose, onSaved, cluster }: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#888888");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !cluster) return;
    setName(cluster.name);
    setDescription(cluster.description ?? "");
    setColor(cluster.color ?? "#888888");
    setError(null);
    setBusy(false);
  }, [open, cluster]);

  const hasChanges = useMemo(() => {
    if (!cluster) return false;
    return (
      name.trim() !== cluster.name ||
      description.trim() !== (cluster.description ?? "") ||
      color !== (cluster.color ?? "#888888")
    );
  }, [cluster, color, description, name]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const onSubmit = async () => {
    if (!cluster) return;
    setError(null);

    if (!name.trim()) {
      setError(t("tags.errorNameRequired", { defaultValue: "Name is required" }));
      return;
    }

    setBusy(true);
    try {
      const nextName = name.trim();
      const nextDescription = description.trim() || null;
      const nextColor = color || null;

      if (nextName !== cluster.name) {
        await clusterRename(cluster.id, nextName);
      }
      if (nextDescription !== (cluster.description ?? null)) {
        await clusterSetDescription(cluster.id, nextDescription);
      }
      if (nextColor !== (cluster.color ?? null)) {
        await clusterSetColor(cluster.id, nextColor);
      }

      await onSaved();
      onClose();
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("tags.editCluster", { defaultValue: "Edit cluster" })}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={busy || !hasChanges}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <TextField
        label={t("tags.name", { defaultValue: "Name" }) as string}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className={styles.modalField}>
        <span className={styles.modalLabel}>
          {t("tags.description", { defaultValue: "Description" })}
        </span>
        <textarea
          className={styles.modalTextarea}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className={styles.modalField}>
        <span className={styles.modalLabel}>{t("tags.color", { defaultValue: "Color" })}</span>
        <div className={styles.colorRow}>
          <input
            className={styles.colorInput}
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <span>{color}</span>
        </div>
      </label>
      {error && <div className={styles.modalError}>{error}</div>}
    </Modal>
  );
};
