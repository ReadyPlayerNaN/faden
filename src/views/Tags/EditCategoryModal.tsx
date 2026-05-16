import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal/Modal";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import {
  categoryMoveToCluster,
  categoryRename,
  categorySetColor,
  categorySetDescription,
  type CategoryNode,
  type ClusterNode,
} from "../../ipc/codebook";
import styles from "./TagsView.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  category: CategoryNode | null;
  clusters: ClusterNode[];
};

export const EditCategoryModal = ({
  open,
  onClose,
  onSaved,
  category,
  clusters,
}: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#888888");
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !category) return;
    setName(category.name);
    setDescription(category.description ?? "");
    setColor(category.color ?? "#888888");
    setSelectedCluster(category.clusterId);
    setError(null);
    setBusy(false);
  }, [open, category]);

  const hasChanges = useMemo(() => {
    if (!category) return false;
    return (
      name.trim() !== category.name ||
      description.trim() !== (category.description ?? "") ||
      color !== (category.color ?? "#888888") ||
      selectedCluster !== category.clusterId
    );
  }, [category, color, description, name, selectedCluster]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const onSubmit = async () => {
    if (!category) return;
    setError(null);

    if (!name.trim()) {
      setError(
        t("tags.errorNameRequired", { defaultValue: "Name is required" }),
      );
      return;
    }
    setBusy(true);
    try {
      const nextName = name.trim();
      const nextDescription = description.trim() || null;
      const nextColor = color || null;

      if (nextName !== category.name) {
        await categoryRename(category.id, nextName);
      }
      if (nextDescription !== (category.description ?? null)) {
        await categorySetDescription(category.id, nextDescription);
      }
      if (nextColor !== (category.color ?? null)) {
        await categorySetColor(category.id, nextColor);
      }
      if (selectedCluster !== category.clusterId) {
        await categoryMoveToCluster(category.id, selectedCluster);
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
      title={t("tags.editCategory", { defaultValue: "Edit category" })}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit()}
            disabled={busy || !hasChanges}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <label className={styles.modalField}>
        <span className={styles.modalLabel}>
          {t("tags.cluster", { defaultValue: "Cluster" })}
        </span>
        <select
          className={styles.modalSelect}
          value={selectedCluster ?? ""}
          onChange={(e) =>
            setSelectedCluster(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">
            {t("tags.noCluster", { defaultValue: "No cluster" })}
          </option>
          {clusters.map((cluster) => (
            <option key={cluster.id} value={cluster.id}>
              {cluster.name}
            </option>
          ))}
        </select>
      </label>
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
        <span className={styles.modalLabel}>
          {t("tags.color", { defaultValue: "Color" })}
        </span>
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
