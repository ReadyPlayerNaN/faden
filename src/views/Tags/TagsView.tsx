import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import {
  codebookTree as fetchTree,
  clusterRename,
  clusterDelete,
  categoryRename,
  categoryDelete,
  tagRename,
  tagDelete,
  tagMoveToCategory,
  type ClusterNode,
  type CategoryNode,
  type TagNode,
} from "../../ipc/codebook";
import { codebookTreeAtom } from "../../state/codebook";
import { AddClusterModal } from "./AddClusterModal";
import { AddCategoryModal } from "./AddCategoryModal";
import { AddTagModal } from "./AddTagModal";
import { EditCategoryModal } from "./EditCategoryModal";
import styles from "./TagsView.module.css";

type CategoryOption = {
  id: number;
  label: string;
};

type DeleteTarget =
  | { kind: "cluster"; id: number; name: string }
  | { kind: "category"; id: number; name: string }
  | { kind: "tag"; id: number; name: string }
  | null;

type EditableCategory = {
  id: number;
  clusterId: number;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
  count: number;
  tags: TagNode[];
};

export const TagsView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tree, setTree] = useAtom(codebookTreeAtom);
  const [error, setError] = useState<string | null>(null);

  const [addClusterOpen, setAddClusterOpen] = useState(false);
  const [addCategoryFor, setAddCategoryFor] = useState<number | null | false>(
    false,
  );
  const [addTagFor, setAddTagFor] = useState<number | null | false>(false);
  const [editCategory, setEditCategory] = useState<EditableCategory | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setTree(await fetchTree());
    } catch (e) {
      handleError(e);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleError = (e: unknown) => {
    const msg = String((e as { message?: string })?.message ?? e);
    if (msg.includes("Conflict") || msg.includes("already exists"))
      setError(
        t("tags.errorDuplicate", {
          defaultValue: "An item with that name already exists",
        }),
      );
    else if (
      msg.includes("in use") ||
      msg.includes("has tags") ||
      msg.includes("is in use")
    )
      setError(
        t("tags.errorInUse", {
          defaultValue: "Cannot delete: this item is still in use",
        }),
      );
    else setError(msg);
  };

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    if (!tree) return [];
    const out: CategoryOption[] = [];
    tree.clusters.forEach((cl) => {
      cl.categories.forEach((cat) => {
        out.push({ id: cat.id, label: `${cl.name} › ${cat.name}` });
      });
    });
    return out;
  }, [tree]);

  const categories = useMemo(() => {
    if (!tree) return [];
    return tree.clusters.flatMap((cluster) =>
      cluster.categories.map((category) => ({
        cluster,
        category,
      })),
    );
  }, [tree]);

  const requestDelete = (target: DeleteTarget) => {
    setDeleteError(null);
    setDeleteTarget(target);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      if (deleteTarget.kind === "cluster")
        await clusterDelete(deleteTarget.id);
      else if (deleteTarget.kind === "category")
        await categoryDelete(deleteTarget.id);
      else await tagDelete(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      if (
        msg.includes("in use") ||
        msg.includes("has tags") ||
        msg.includes("is in use")
      )
        setDeleteError(
          t("tags.errorInUse", {
            defaultValue: "Cannot delete: this item is still in use",
          }),
        );
      else setDeleteError(msg);
    } finally {
      setDeleteBusy(false);
    }
  };

  const moveTag = async (tagId: number, newCategoryId: number | null) => {
    try {
      await tagMoveToCategory(tagId, newCategoryId);
      await reload();
    } catch (e) {
      handleError(e);
    }
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {t("tags.title", { defaultValue: "Tags" })}
        </h1>
        <div className={styles.headerActions}>
          <Button onClick={() => void navigate({ to: "/" })}>
            ← {t("settings.back")}
          </Button>
        </div>
      </header>

      <div className={styles.topActions}>
        <Button variant="primary" onClick={() => setAddClusterOpen(true)}>
          + {t("tags.addCluster", { defaultValue: "Add cluster" })}
        </Button>
        <Button onClick={() => setAddCategoryFor(null)}>
          + {t("tags.addCategory", { defaultValue: "Add category" })}
        </Button>
        <Button onClick={() => setAddTagFor(null)}>
          + {t("tags.addTag", { defaultValue: "Add tag" })}
        </Button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("tags.clustersSection", { defaultValue: "Clusters" })}
        </h2>
        {tree && tree.clusters.length === 0 ? (
          <p className={styles.empty}>
            {t("tags.noClusters", { defaultValue: "No clusters yet" })}
          </p>
        ) : (
          tree?.clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              categoryOptions={categoryOptions}
              onReload={reload}
              onError={handleError}
              onAddCategory={() => setAddCategoryFor(cluster.id)}
              onAddTag={(categoryId) => setAddTagFor(categoryId)}
              onEditCategory={setEditCategory}
              onRequestDelete={requestDelete}
              onMoveTag={moveTag}
            />
          ))
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("tags.categoriesManagementSection", {
            defaultValue: "Tag Category management",
          })}
        </h2>
        <div className={styles.standaloneList}>
          {tree && categories.length === 0 ? (
            <p className={styles.empty}>
              {t("tags.noCategories", {
                defaultValue: "No categories yet",
              })}
            </p>
          ) : (
            categories.map(({ cluster, category }) => (
              <CategoryManagementRow
                key={category.id}
                cluster={cluster}
                category={category}
                onEdit={() => setEditCategory(category)}
                onRequestDelete={requestDelete}
              />
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("tags.standaloneSection", { defaultValue: "Standalone tags" })}
        </h2>
        <div className={styles.standaloneList}>
          {tree && tree.standaloneTags.length === 0 ? (
            <p className={styles.empty}>
              {t("tags.noStandalone", {
                defaultValue: "No standalone tags",
              })}
            </p>
          ) : (
            tree?.standaloneTags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                categoryOptions={categoryOptions}
                onReload={reload}
                onError={handleError}
                onRequestDelete={requestDelete}
                onMoveTag={moveTag}
              />
            ))
          )}
        </div>
      </section>

      <AddClusterModal
        open={addClusterOpen}
        onClose={() => setAddClusterOpen(false)}
        onCreated={() => void reload()}
      />
      {tree && (
        <AddCategoryModal
          open={addCategoryFor !== false}
          onClose={() => setAddCategoryFor(false)}
          onCreated={() => void reload()}
          clusters={tree.clusters}
          clusterId={addCategoryFor === false ? null : addCategoryFor}
        />
      )}
      {tree && (
        <AddTagModal
          open={addTagFor !== false}
          onClose={() => setAddTagFor(false)}
          onCreated={() => void reload()}
          clusters={tree.clusters}
          categoryId={addTagFor === false ? null : addTagFor}
        />
      )}
      {tree && (
        <EditCategoryModal
          open={editCategory !== null}
          onClose={() => setEditCategory(null)}
          onSaved={reload}
          category={editCategory}
          clusters={tree.clusters}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("tags.confirmDeleteTitle", { defaultValue: "Confirm delete" })}
        footer={
          <>
            <Button
              onClick={() => setDeleteTarget(null)}
              disabled={deleteBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
            >
              {t("tags.delete", { defaultValue: "Delete" })}
            </Button>
          </>
        }
      >
        <p className={styles.confirmText}>
          {t("tags.confirmDelete", {
            defaultValue: "Delete {{name}}?",
            name: deleteTarget?.name ?? "",
          })}
        </p>
        {deleteError && <div className={styles.modalError}>{deleteError}</div>}
      </Modal>
    </div>
  );
};

type ClusterCardProps = {
  cluster: ClusterNode;
  categoryOptions: CategoryOption[];
  onReload: () => Promise<void>;
  onError: (e: unknown) => void;
  onAddCategory: () => void;
  onAddTag: (categoryId: number) => void;
  onEditCategory: (category: EditableCategory) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onMoveTag: (tagId: number, newCategoryId: number | null) => Promise<void>;
};

const ClusterCard = ({
  cluster,
  categoryOptions,
  onReload,
  onError,
  onAddCategory,
  onAddTag,
  onEditCategory,
  onRequestDelete,
  onMoveTag,
}: ClusterCardProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.name);

  const submit = async () => {
    if (draft.trim() && draft !== cluster.name) {
      try {
        await clusterRename(cluster.id, draft.trim());
        await onReload();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  return (
    <div className={styles.clusterCard}>
      <div className={styles.clusterHeader}>
        {editing ? (
          <input
            className={styles.input}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") {
                setDraft(cluster.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className={styles.clusterName}
            onDoubleClick={() => {
              setDraft(cluster.name);
              setEditing(true);
            }}
            title={t("tags.doubleClickRename", {
              defaultValue: "Double-click to rename",
            })}
          >
            {cluster.color && (
              <span
                className={styles.swatch}
                style={{ background: cluster.color }}
              />
            )}
            {cluster.name}
            <span className={styles.count}>({cluster.count})</span>
          </button>
        )}
        <button
          className={styles.delBtn}
          onClick={() =>
            onRequestDelete({
              kind: "cluster",
              id: cluster.id,
              name: cluster.name,
            })
          }
          title={t("tags.delete", { defaultValue: "Delete" })}
        >
          ×
        </button>
      </div>
      {cluster.categories.map((cat) => (
        <CategoryBlock
          key={cat.id}
          category={cat}
          categoryOptions={categoryOptions}
          onReload={onReload}
          onError={onError}
          onAddTag={() => onAddTag(cat.id)}
          onEdit={() => onEditCategory(cat)}
          onRequestDelete={onRequestDelete}
          onMoveTag={onMoveTag}
        />
      ))}
      <button className={styles.addNested} onClick={onAddCategory}>
        + {t("tags.addCategory", { defaultValue: "Add category" })}
      </button>
    </div>
  );
};

type CategoryBlockProps = {
  category: CategoryNode;
  categoryOptions: CategoryOption[];
  onReload: () => Promise<void>;
  onError: (e: unknown) => void;
  onAddTag: () => void;
  onEdit: () => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onMoveTag: (tagId: number, newCategoryId: number | null) => Promise<void>;
};

const CategoryBlock = ({
  category,
  categoryOptions,
  onReload,
  onError,
  onAddTag,
  onEdit,
  onRequestDelete,
  onMoveTag,
}: CategoryBlockProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);

  const submit = async () => {
    if (draft.trim() && draft !== category.name) {
      try {
        await categoryRename(category.id, draft.trim());
        await onReload();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  return (
    <div className={styles.categoryBlock}>
      <div className={styles.categoryHeader}>
        {editing ? (
          <input
            className={styles.input}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") {
                setDraft(category.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className={styles.categoryName}
            onDoubleClick={() => {
              setDraft(category.name);
              setEditing(true);
            }}
            title={t("tags.doubleClickRename", {
              defaultValue: "Double-click to rename",
            })}
          >
            {category.color && (
              <span
                className={styles.swatch}
                style={{ background: category.color }}
              />
            )}
            {category.name}
            <span className={styles.count}>({category.count})</span>
          </button>
        )}
        <button
          className={styles.manageBtn}
          onClick={onEdit}
          title={t("tags.editCategory", { defaultValue: "Edit category" })}
        >
          {t("common.edit", { defaultValue: "Edit" })}
        </button>
        <button
          className={styles.delBtn}
          onClick={() =>
            onRequestDelete({
              kind: "category",
              id: category.id,
              name: category.name,
            })
          }
          title={t("tags.delete", { defaultValue: "Delete" })}
        >
          ×
        </button>
      </div>
      {category.tags.map((tag) => (
        <TagRow
          key={tag.id}
          tag={tag}
          categoryOptions={categoryOptions}
          onReload={onReload}
          onError={onError}
          onRequestDelete={onRequestDelete}
          onMoveTag={onMoveTag}
        />
      ))}
      <button className={styles.addNested} onClick={onAddTag}>
        + {t("tags.addTagToCategory", { defaultValue: "Add tag to category" })}
      </button>
    </div>
  );
};

type CategoryManagementRowProps = {
  cluster: ClusterNode;
  category: CategoryNode;
  onEdit: () => void;
  onRequestDelete: (target: DeleteTarget) => void;
};

const CategoryManagementRow = ({
  cluster,
  category,
  onEdit,
  onRequestDelete,
}: CategoryManagementRowProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.managementRow}>
      <div className={styles.managementMeta}>
        <div className={styles.managementTitleRow}>
          {category.color && (
            <span className={styles.swatch} style={{ background: category.color }} />
          )}
          <strong>{category.name}</strong>
          <span className={styles.count}>({category.count})</span>
        </div>
        <div className={styles.managementSubtitle}>
          {cluster.name}
          {category.description ? ` · ${category.description}` : ""}
        </div>
      </div>
      <div className={styles.managementActions}>
        <button
          className={styles.manageBtn}
          onClick={onEdit}
          title={t("tags.editCategory", { defaultValue: "Edit category" })}
        >
          {t("common.edit", { defaultValue: "Edit" })}
        </button>
        <button
          className={styles.delBtn}
          onClick={() =>
            onRequestDelete({
              kind: "category",
              id: category.id,
              name: category.name,
            })
          }
          title={t("tags.delete", { defaultValue: "Delete" })}
        >
          ×
        </button>
      </div>
    </div>
  );
};

type TagRowProps = {
  tag: TagNode;
  categoryOptions: CategoryOption[];
  onReload: () => Promise<void>;
  onError: (e: unknown) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onMoveTag: (tagId: number, newCategoryId: number | null) => Promise<void>;
};

const TagRow = ({
  tag,
  categoryOptions,
  onReload,
  onError,
  onRequestDelete,
  onMoveTag,
}: TagRowProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);

  const submit = async () => {
    if (draft.trim() && draft !== tag.name) {
      try {
        await tagRename(tag.id, draft.trim());
        await onReload();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  return (
    <div className={styles.tagRow}>
      {tag.color && (
        <span className={styles.swatch} style={{ background: tag.color }} />
      )}
      {editing ? (
        <input
          className={styles.input}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void submit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") {
              setDraft(tag.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className={styles.tagName}
          onDoubleClick={() => {
            setDraft(tag.name);
            setEditing(true);
          }}
          title={t("tags.doubleClickRename", {
            defaultValue: "Double-click to rename",
          })}
        >
          {tag.name}
          <span className={styles.count}> ({tag.count})</span>
        </button>
      )}
      <select
        className={styles.moveSelect}
        value={tag.categoryId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          void onMoveTag(tag.id, v ? Number(v) : null);
        }}
        title={t("tags.movePrompt", { defaultValue: "Move to..." })}
      >
        <option value="">
          {t("tags.standalone", { defaultValue: "Standalone (no category)" })}
        </option>
        {categoryOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        className={styles.delBtn}
        onClick={() =>
          onRequestDelete({ kind: "tag", id: tag.id, name: tag.name })
        }
        title={t("tags.delete", { defaultValue: "Delete" })}
      >
        ×
      </button>
    </div>
  );
};
