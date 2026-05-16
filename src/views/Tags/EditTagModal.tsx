import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal/Modal";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import {
  tagMoveToCategory,
  tagRename,
  tagSetColor,
  tagSetDescription,
  type ClusterNode,
  type TagNode,
  type CategoryNode,
} from "../../ipc/codebook";
import styles from "./TagsView.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  tag: TagNode | null;
  clusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
};

export const EditTagModal = ({
  open,
  onClose,
  onSaved,
  tag,
  clusters,
  standaloneCategories,
}: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#888888");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !tag) return;
    setName(tag.name);
    setDescription(tag.description ?? "");
    setColor(tag.color ?? "#888888");
    setSelectedCategory(tag.categoryId);
    setError(null);
    setBusy(false);
  }, [open, tag]);

  const hasChanges = useMemo(() => {
    if (!tag) return false;
    return (
      name.trim() !== tag.name ||
      description.trim() !== (tag.description ?? "") ||
      color !== (tag.color ?? "#888888") ||
      selectedCategory !== tag.categoryId
    );
  }, [tag, color, description, name, selectedCategory]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const onSubmit = async () => {
    if (!tag) return;
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

      if (nextName !== tag.name) {
        await tagRename(tag.id, nextName);
      }
      if (nextDescription !== (tag.description ?? null)) {
        await tagSetDescription(tag.id, nextDescription);
      }
      if (nextColor !== (tag.color ?? null)) {
        await tagSetColor(tag.id, nextColor);
      }
      if (selectedCategory !== tag.categoryId) {
        await tagMoveToCategory(tag.id, selectedCategory);
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
      title={t("tags.editTag", { defaultValue: "Edit tag" })}
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
      <label className={styles.modalField}>
        <span className={styles.modalLabel}>{t("tags.category", { defaultValue: "Category" })}</span>
        <select
          className={styles.modalSelect}
          value={selectedCategory ?? ""}
          onChange={(e) => setSelectedCategory(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t("tags.standalone", { defaultValue: "Standalone (no category)" })}</option>
          {standaloneCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {t("tags.noClusterPrefix", {
                defaultValue: "No cluster › {{name}}",
                name: category.name,
              })}
            </option>
          ))}
          {clusters.flatMap((cluster) =>
            cluster.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {cluster.name} › {category.name}
              </option>
            )),
          )}
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
