import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal/Modal";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { categoryCreate, type ClusterNode } from "../../ipc/codebook";
import styles from "./TagsView.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  clusters: ClusterNode[];
  clusterId: number | null;
};

export const AddCategoryModal = ({
  open,
  onClose,
  onCreated,
  clusters,
  clusterId,
}: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#888888");
  const [selectedCluster, setSelectedCluster] = useState<number | null>(
    clusterId,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCluster(clusterId);
      setName("");
      setDescription("");
      setColor("#888888");
      setError(null);
      setBusy(false);
    }
  }, [open, clusterId]);

  const close = () => onClose();

  const onSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(
        t("tags.errorNameRequired", { defaultValue: "Name is required" }),
      );
      return;
    }
    if (selectedCluster === null) {
      setError(
        t("tags.errorClusterRequired", {
          defaultValue: "Cluster is required",
        }),
      );
      return;
    }
    setBusy(true);
    try {
      await categoryCreate(
        selectedCluster,
        name.trim(),
        description.trim() || null,
        color || null,
      );
      onCreated();
      close();
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
      title={t("tags.addCategory", { defaultValue: "Add category" })}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit()}
            disabled={busy}
          >
            {t("tags.create", { defaultValue: "Create" })}
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
          <option value="">--</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
