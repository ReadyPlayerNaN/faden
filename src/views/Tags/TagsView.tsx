import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { interviewList as fetchInterviewList } from "../../ipc/interview";
import {
  aiCategorizeStart,
  aiClusterStart,
  aiCostEstimate,
  aiProposalList,
  aiRunList,
  type CostEstimate,
  type ProposalKind,
} from "../../ipc/ai";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { ViewModeLabel } from "../../components/ViewModeIcon/ViewModeIcon";
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
import { interviewListAtom } from "../../state/interview";
import {
  activeAiOperationsAtom,
  aiRunHistoryAtom,
  pendingProposalsAtom,
  skipCostConfirmAtom,
} from "../../state/ai";
import { AddClusterModal } from "./AddClusterModal";
import { AddCategoryModal } from "./AddCategoryModal";
import { AddTagModal } from "./AddTagModal";
import { EditCategoryModal } from "./EditCategoryModal";
import { EditClusterModal } from "./EditClusterModal";
import { EditTagModal } from "./EditTagModal";
import { useFindMoreAction } from "../Workspace/AI/useFindMoreAction";
import { CostPreviewModal } from "../Workspace/AI/CostPreviewModal";
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

type PendingStructureAction = {
  kind: Extract<ProposalKind, "categorize" | "cluster">;
};

type SectionMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

export const TagsView = () => {
  const { t } = useTranslation();
  const [tree, setTree] = useAtom(codebookTreeAtom);
  const [interviews, setInterviews] = useAtom(interviewListAtom);
  const skipCostConfirm = useAtomValue(skipCostConfirmAtom);
  const setSkipCostConfirm = useSetAtom(skipCostConfirmAtom);
  const setPendingProposals = useSetAtom(pendingProposalsAtom);
  const setAiRunHistory = useSetAtom(aiRunHistoryAtom);
  const setActiveAiOperations = useSetAtom(activeAiOperationsAtom);
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
  const [findMoreTag, setFindMoreTag] = useState<TagNode | null>(null);
  const [selectedInterviewIds, setSelectedInterviewIds] = useState<number[]>([]);
  const [pendingStructureAction, setPendingStructureAction] = useState<PendingStructureAction | null>(null);
  const [structureEstimate, setStructureEstimate] = useState<CostEstimate | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [structureStatus, setStructureStatus] = useState<string | null>(null);
  const {
    busy: findMoreBusy,
    status: findMoreStatus,
    launchFindMoreForInterviews,
    costPreviewModal,
  } = useFindMoreAction();

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

  useEffect(() => {
    if (interviews.length > 0) return;
    void fetchInterviewList().then(setInterviews).catch(() => undefined);
  }, [interviews.length, setInterviews]);

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

  const refreshProposals = async () => setPendingProposals(await aiProposalList());
  const refreshRuns = async () => setAiRunHistory(await aiRunList());
  const structureStatusText = (kind: PendingStructureAction["kind"]) =>
    t("ai.startingKind", {
      kind: t(`ai.kinds.${kind}`),
      defaultValue: `Starting ${t(`ai.kinds.${kind}`)}…`,
    });

  const startLocalStructureOperation = (kind: PendingStructureAction["kind"]) => {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActiveAiOperations((prev) => [
      {
        id,
        runId: null,
        kind,
        startedAt: new Date().toISOString(),
        interviewId: null,
        label: t("ai.running"),
        title: t(`ai.kinds.${kind}`),
      },
      ...prev,
    ]);
    return id;
  };

  const setLocalOperationRunId = (id: string, runId: number) => {
    setActiveAiOperations((prev) => prev.map((op) => (op.id === id ? { ...op, runId } : op)));
  };

  const finishLocalStructureOperation = (id: string) => {
    setActiveAiOperations((prev) => prev.filter((op) => op.id !== id));
  };

  const actuallyStartStructureAction = async (action: PendingStructureAction) => {
    const localId = startLocalStructureOperation(action.kind);
    setStructureBusy(true);
    setStructureStatus(structureStatusText(action.kind));
    try {
      const runId =
        action.kind === "categorize"
          ? await aiCategorizeStart()
          : await aiClusterStart();
      setLocalOperationRunId(localId, runId);
      await Promise.all([refreshProposals(), refreshRuns()]);
      setStructureStatus(null);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setStructureStatus(errorMessage(e));
    } finally {
      finishLocalStructureOperation(localId);
      setStructureBusy(false);
      setPendingStructureAction(null);
      setStructureEstimate(null);
    }
  };

  const launchStructureAction = async (kind: PendingStructureAction["kind"]) => {
    const action = { kind };
    if (skipCostConfirm[kind]) {
      await actuallyStartStructureAction(action);
      return;
    }
    try {
      setStructureEstimate(await aiCostEstimate(kind, {}));
      setPendingStructureAction(action);
      setStructureStatus(null);
    } catch (e) {
      setStructureStatus(errorMessage(e));
    }
  };

  const onSendStructureAction = async (dontAsk: boolean) => {
    const action = pendingStructureAction;
    setPendingStructureAction(null);
    setStructureEstimate(null);
    if (!action) return;
    if (dontAsk) {
      setSkipCostConfirm({ ...skipCostConfirm, [action.kind]: true });
    }
    await actuallyStartStructureAction(action);
  };

  const requestDelete = (target: DeleteTarget) => {
    setDeleteError(null);
    setDeleteTarget(target);
  };

  const openFindMoreModal = (tag: TagNode) => {
    setFindMoreTag(tag);
    setSelectedInterviewIds(interviews.map((interview) => interview.id));
  };

  const closeFindMoreModal = () => {
    setFindMoreTag(null);
    setSelectedInterviewIds([]);
  };

  const toggleInterview = (interviewId: number) => {
    setSelectedInterviewIds((prev) =>
      prev.includes(interviewId)
        ? prev.filter((id) => id !== interviewId)
        : [...prev, interviewId],
    );
  };

  const onRunFindMore = async () => {
    if (!findMoreTag || selectedInterviewIds.length === 0) return;
    const tagId = findMoreTag.id;
    const interviewIds = [...selectedInterviewIds];
    closeFindMoreModal();
    await launchFindMoreForInterviews(tagId, interviewIds, findMoreTag.name);
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

  const clusterMenuItems: SectionMenuItem[] = [
    {
      label: t("tags.createCluster", { defaultValue: "Create cluster" }),
      onSelect: () => setAddClusterOpen(true),
    },
    {
      label: t("ai.cluster", { defaultValue: "Cluster categories" }),
      onSelect: () => void launchStructureAction("cluster"),
      disabled: structureBusy || categories.length === 0,
    },
  ];

  const categoryMenuItems: SectionMenuItem[] = [
    {
      label: t("tags.createCategory", { defaultValue: "Create category" }),
      onSelect: () => setAddCategoryFor(null),
    },
    {
      label: t("ai.categorize", { defaultValue: "Categorize tags" }),
      onSelect: () => void launchStructureAction("categorize"),
      disabled: structureBusy || tags.length === 0,
    },
  ];

  const tagMenuItems: SectionMenuItem[] = [
    {
      label: t("tags.createTag", { defaultValue: "Create tag" }),
      onSelect: () => setAddTagFor(null),
    },
  ];

  return (
    <div className={styles.shell}>
      <ProjectHeader activeView="labels" />

      <div className={styles.wrap}>
        <h1 className={styles.title}>
          <ViewModeLabel view="labels">{t("tags.title", { defaultValue: "Tags" })}</ViewModeLabel>
        </h1>

        {error && <div className={styles.error}>{error}</div>}
        {findMoreStatus && <div className={styles.notice}>{findMoreStatus}</div>}
        {structureStatus && <div className={styles.notice}>{structureStatus}</div>}

        <section className={styles.section}>
          <SectionHeader
            title={t("tags.clusterManagementSection", { defaultValue: "Cluster management" })}
            items={clusterMenuItems}
          />
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
          <SectionHeader
            title={t("tags.categoryManagementSection", { defaultValue: "Category management" })}
            items={categoryMenuItems}
          />
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
          <SectionHeader
            title={t("tags.tagManagementSection", { defaultValue: "Tag management" })}
            items={tagMenuItems}
          />
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
                  actionMenu={{
                    busy: findMoreBusy,
                    onFindMore: () => openFindMoreModal(tag),
                  }}
                />
              ))
            )}
          </div>
        </section>
      </div>

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
        open={findMoreTag !== null}
        onClose={closeFindMoreModal}
        title={t("tags.findMoreTargetsTitle", {
          defaultValue: "Find more occurrences",
        })}
        footer={
          <>
            <Button onClick={closeFindMoreModal} disabled={findMoreBusy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void onRunFindMore()}
              disabled={findMoreBusy || selectedInterviewIds.length === 0}
            >
              {t("tags.runFindMore", { defaultValue: "Run search" })}
            </Button>
          </>
        }
      >
        <div className={styles.findMoreModal}>
          <p className={styles.findMoreHelp}>
            {t("tags.findMoreTargetsHelp", {
              defaultValue: "Choose which interviews should be searched for this tag.",
            })}
          </p>
          <div className={styles.findMoreBulkActions}>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => setSelectedInterviewIds(interviews.map((interview) => interview.id))}
            >
              {t("tags.selectAll", { defaultValue: "Select all" })}
            </button>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => setSelectedInterviewIds([])}
            >
              {t("tags.selectNone", { defaultValue: "Select none" })}
            </button>
          </div>
          <div className={styles.findMoreList}>
            {interviews.length === 0 ? (
              <p className={styles.empty}>{t("tags.noInterviews", { defaultValue: "No interviews yet" })}</p>
            ) : (
              interviews.map((interview) => (
                <label key={interview.id} className={styles.findMoreRow}>
                  <input
                    type="checkbox"
                    checked={selectedInterviewIds.includes(interview.id)}
                    onChange={() => toggleInterview(interview.id)}
                  />
                  <span className={styles.findMoreName}>{interview.name}</span>
                </label>
              ))
            )}
          </div>
          {selectedInterviewIds.length === 0 ? (
            <p className={styles.findMoreValidation}>
              {t("ai.selectAtLeastOneInterview", {
                defaultValue: "Select at least one interview",
              })}
            </p>
          ) : null}
        </div>
      </Modal>

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
      {costPreviewModal}
      {pendingStructureAction && structureEstimate ? (
        <CostPreviewModal
          estimate={structureEstimate}
          prompt=""
          onSend={(dontAsk) => void onSendStructureAction(dontAsk)}
          onCancel={() => {
            setPendingStructureAction(null);
            setStructureEstimate(null);
          }}
        />
      ) : null}
    </div>
  );
};

type SectionHeaderProps = {
  title: string;
  items: SectionMenuItem[];
};

const SectionHeader = ({ title, items }: SectionHeaderProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.menuWrap} ref={menuRef}>
        <button
          type="button"
          className={styles.menuBtn}
          aria-label={t("common.actions", { defaultValue: "Actions" }) as string}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          ⋯
        </button>
        {open && (
          <div className={styles.menuDropdown} role="menu">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                className={styles.menuItem}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
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
  actionMenu?: {
    busy?: boolean;
    onFindMore: () => void;
  };
};

const ManagementRow = ({ name, color, count, subtitle, onEdit, onDelete, actionMenu }: ManagementRowProps) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
        {actionMenu ? (
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.menuBtn}
              aria-label={t("common.actions", { defaultValue: "Actions" }) as string}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className={styles.menuDropdown} role="menu">
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  disabled={actionMenu.busy}
                  onClick={() => {
                    setMenuOpen(false);
                    actionMenu.onFindMore();
                  }}
                >
                  {t("ai.findMoreOccurrences", { defaultValue: "Find more occurrences" })}
                </button>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                >
                  {t("common.edit", { defaultValue: "Edit" })}
                </button>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  {t("common.delete", { defaultValue: "Delete" })}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button className={styles.manageBtn} onClick={onEdit}>
              {t("common.edit", { defaultValue: "Edit" })}
            </button>
            <button className={styles.delBtn} onClick={onDelete} title={t("tags.delete", { defaultValue: "Delete" })}>
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
};
