import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import {
  codebookTree as fetchTree,
  clusterDelete,
  categoryDelete,
  tagDelete,
  type ClusterNode,
  type CategoryNode,
  type TagNode,
} from "../../ipc/codebook";
import { codebookTreeAtom } from "../../state/codebook";
import { currentProjectAtom } from "../../state/project";
import { AddClusterModal } from "./AddClusterModal";
import { AddCategoryModal } from "./AddCategoryModal";
import { AddTagModal } from "./AddTagModal";
import { EditCategoryModal } from "./EditCategoryModal";
import { EditClusterModal } from "./EditClusterModal";
import { EditTagModal } from "./EditTagModal";
import styles from "./TagsView.module.css";

type DeleteTarget =
  | { kind: "cluster"; id: number; name: string }
  | { kind: "category"; id: number; name: string }
  | { kind: "tag"; id: number; name: string }
  | null;

type TagItem = {
  tag: TagNode;
  category: CategoryNode | null;
  cluster: ClusterNode | null;
};

export const TagsView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tree, setTree] = useAtom(codebookTreeAtom);
  const project = useAtomValue(currentProjectAtom);
  const [error, setError] = useState<string | null>(null);

  const [addClusterOpen, setAddClusterOpen] = useState(false);
  const [addCategoryFor, setAddCategoryFor] = useState<number | null | false>(false);
  const [addTagFor, setAddTagFor] = useState<number | null | false>(false);
  const [editCluster, setEditCluster] = useState<ClusterNode | null>(null);
  const [editCategory, setEditCategory] = useState<CategoryNode | null>(null);
  const [editTag, setEditTag] = useState<TagNode | null>(null);
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
    if (msg.includes("Conflict") || msg.includes("already exists")) {
      setError(
        t("tags.errorDuplicate", {
          defaultValue: "An item with that name already exists",
        }),
      );
    } else if (msg.includes("in use") || msg.includes("has tags") || msg.includes("is in use")) {
      setError(
        t("tags.errorInUse", {
          defaultValue: "Cannot delete: this item is still in use",
        }),
      );
    } else {
      setError(msg);
    }
  };

  const categories = useMemo(() => {
    if (!tree) return [] as Array<{ cluster: ClusterNode | null; category: CategoryNode }>;
    return [
      ...tree.standaloneCategories.map((category) => ({ cluster: null, category })),
      ...tree.clusters.flatMap((cluster) =>
        cluster.categories.map((category) => ({ cluster, category })),
      ),
    ];
  }, [tree]);

  const tags = useMemo(() => {
    if (!tree) return [] as TagItem[];
    return [
      ...tree.standaloneTags.map((tag) => ({ tag, category: null, cluster: null })),
      ...tree.standaloneCategories.flatMap((category) =>
        category.tags.map((tag) => ({ tag, category, cluster: null })),
      ),
      ...tree.clusters.flatMap((cluster) =>
        cluster.categories.flatMap((category) =>
          category.tags.map((tag) => ({ tag, category, cluster })),
        ),
      ),
    ];
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
      if (deleteTarget.kind === "cluster") await clusterDelete(deleteTarget.id);
      else if (deleteTarget.kind === "category") await categoryDelete(deleteTarget.id);
      else await tagDelete(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      if (msg.includes("in use") || msg.includes("has tags") || msg.includes("is in use")) {
        setDeleteError(
          t("tags.errorInUse", {
            defaultValue: "Cannot delete: this item is still in use",
          }),
        );
      } else {
        setDeleteError(msg);
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("tags.title", { defaultValue: "Tags" })}</h1>
        <div className={styles.headerActions}>
          <Button
            onClick={() =>
              void navigate(
                project
                  ? {
                      to: "/workspace/$projectPath",
                      params: { projectPath: encodeURIComponent(project.path) },
                    }
                  : { to: "/" },
              )
            }
          >
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
          {t("tags.clusterManagementSection", { defaultValue: "Cluster management" })}
        </h2>
        <div className={styles.flatList}>
          {tree && tree.clusters.length === 0 ? (
            <p className={styles.empty}>{t("tags.noClusters", { defaultValue: "No clusters yet" })}</p>
          ) : (
            tree?.clusters.map((cluster) => (
              <ManagementRow
                key={cluster.id}
                name={cluster.name}
                color={cluster.color}
                count={cluster.count}
                subtitle={cluster.description ?? null}
                onEdit={() => setEditCluster(cluster)}
                onDelete={() =>
                  requestDelete({ kind: "cluster", id: cluster.id, name: cluster.name })
                }
              />
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("tags.categoryManagementSection", { defaultValue: "Category management" })}
        </h2>
        <div className={styles.flatList}>
          {tree && categories.length === 0 ? (
            <p className={styles.empty}>{t("tags.noCategories", { defaultValue: "No categories yet" })}</p>
          ) : (
            categories.map(({ cluster, category }) => (
              <ManagementRow
                key={category.id}
                name={category.name}
                color={category.color}
                count={category.count}
                subtitle={[
                  cluster?.name ?? t("tags.noCluster", { defaultValue: "No cluster" }),
                  category.description,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onEdit={() => setEditCategory(category)}
                onDelete={() =>
                  requestDelete({ kind: "category", id: category.id, name: category.name })
                }
              />
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("tags.tagManagementSection", { defaultValue: "Tag management" })}
        </h2>
        <div className={styles.flatList}>
          {tree && tags.length === 0 ? (
            <p className={styles.empty}>{t("tags.noTags", { defaultValue: "No tags yet" })}</p>
          ) : (
            tags.map(({ tag, category, cluster }) => (
              <ManagementRow
                key={tag.id}
                name={tag.name}
                color={tag.color}
                count={tag.count}
                subtitle={[
                  category
                    ? cluster
                      ? `${cluster.name} › ${category.name}`
                      : t("tags.noClusterPrefix", {
                          defaultValue: "No cluster › {{name}}",
                          name: category.name,
                        })
                    : t("tags.standalone", { defaultValue: "Standalone (no category)" }),
                  tag.description,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onEdit={() => setEditTag(tag)}
                onDelete={() => requestDelete({ kind: "tag", id: tag.id, name: tag.name })}
              />
            ))
          )}
        </div>
      </section>

      <AddClusterModal open={addClusterOpen} onClose={() => setAddClusterOpen(false)} onCreated={() => void reload()} />
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
          standaloneCategories={tree.standaloneCategories}
          categoryId={addTagFor === false ? null : addTagFor}
        />
      )}
      <EditClusterModal
        open={editCluster !== null}
        onClose={() => setEditCluster(null)}
        onSaved={reload}
        cluster={editCluster}
      />
      {tree && (
        <EditCategoryModal
          open={editCategory !== null}
          onClose={() => setEditCategory(null)}
          onSaved={reload}
          category={editCategory}
          clusters={tree.clusters}
        />
      )}
      {tree && (
        <EditTagModal
          open={editTag !== null}
          onClose={() => setEditTag(null)}
          onSaved={reload}
          tag={editTag}
          clusters={tree.clusters}
          standaloneCategories={tree.standaloneCategories}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("tags.confirmDeleteTitle", { defaultValue: "Confirm delete" })}
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleteBusy}>
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

type ManagementRowProps = {
  name: string;
  color: string | null;
  count: number;
  subtitle: string | null;
  onEdit: () => void;
  onDelete: () => void;
};

const ManagementRow = ({ name, color, count, subtitle, onEdit, onDelete }: ManagementRowProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.managementRow}>
      <div className={styles.managementMeta}>
        <div className={styles.managementTitleRow}>
          {color && <span className={styles.swatch} style={{ background: color }} />}
          <strong>{name}</strong>
          <span className={styles.count}>({count})</span>
        </div>
        {subtitle ? <div className={styles.managementSubtitle}>{subtitle}</div> : null}
      </div>
      <div className={styles.managementActions}>
        <button className={styles.manageBtn} onClick={onEdit}>
          {t("common.edit", { defaultValue: "Edit" })}
        </button>
        <button className={styles.delBtn} onClick={onDelete} title={t("tags.delete", { defaultValue: "Delete" })}>
          ×
        </button>
      </div>
    </div>
  );
};
