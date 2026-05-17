import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { interviewList as fetchInterviewList } from "../../ipc/interview";
import {
  aiCategorizeStart,
  aiClusterStart,
  aiCodebookGenStart,
  aiCostEstimate,
  aiProposalList,
  aiRunList,
  type CostEstimate,
  type ProposalKind,
} from "../../ipc/ai";
import { Button } from "../../components/Button/Button";
import { ActionMenu, type ActionMenuItem } from "../../components/ActionMenu/ActionMenu";
import { Modal } from "../../components/Modal/Modal";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { PageViewHeader } from "../../components/PageViewHeader/PageViewHeader";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
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

type PendingProjectAiAction = {
  kind: Extract<ProposalKind, "categorize" | "cluster" | "codebook_gen">;
  interviewIds?: number[];
};

type SectionMenuItem = ActionMenuItem;

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
  const [detectTagsInterviewIds, setDetectTagsInterviewIds] = useState<number[]>([]);
  const [detectTagsModalOpen, setDetectTagsModalOpen] = useState(false);
  const [pendingProjectAiAction, setPendingProjectAiAction] = useState<PendingProjectAiAction | null>(null);
  const [projectAiEstimate, setProjectAiEstimate] = useState<CostEstimate | null>(null);
  const [projectAiBusy, setProjectAiBusy] = useState(false);
  const [projectAiStatus, setProjectAiStatus] = useState<string | null>(null);
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
  const projectAiStatusText = (kind: PendingProjectAiAction["kind"]) =>
    t("ai.startingKind", {
      kind: t(`ai.kinds.${kind}`),
      defaultValue: `Starting ${t(`ai.kinds.${kind}`)}…`,
    });

  const startLocalProjectAiOperation = (kind: PendingProjectAiAction["kind"]) => {
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

  const finishLocalProjectAiOperation = (id: string) => {
    setActiveAiOperations((prev) => prev.filter((op) => op.id !== id));
  };

  const actuallyStartProjectAiAction = async (action: PendingProjectAiAction) => {
    const localId = startLocalProjectAiOperation(action.kind);
    setProjectAiBusy(true);
    setProjectAiStatus(projectAiStatusText(action.kind));
    try {
      const runId =
        action.kind === "categorize"
          ? await aiCategorizeStart()
          : action.kind === "cluster"
            ? await aiClusterStart()
            : await aiCodebookGenStart(action.interviewIds ?? [], true);
      setLocalOperationRunId(localId, runId);
      await Promise.all([refreshProposals(), refreshRuns()]);
      setProjectAiStatus(null);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setProjectAiStatus(errorMessage(e));
    } finally {
      finishLocalProjectAiOperation(localId);
      setProjectAiBusy(false);
      setPendingProjectAiAction(null);
      setProjectAiEstimate(null);
    }
  };

  const launchProjectAiAction = async (action: PendingProjectAiAction, args: unknown = {}) => {
    if (skipCostConfirm[action.kind]) {
      await actuallyStartProjectAiAction(action);
      return;
    }
    try {
      setProjectAiEstimate(await aiCostEstimate(action.kind, args));
      setPendingProjectAiAction(action);
      setProjectAiStatus(null);
    } catch (e) {
      setProjectAiStatus(errorMessage(e));
    }
  };

  const launchStructureAction = async (kind: Extract<ProposalKind, "categorize" | "cluster">) => {
    await launchProjectAiAction({ kind }, {});
  };

  const onSendProjectAiAction = async (dontAsk: boolean) => {
    const action = pendingProjectAiAction;
    setPendingProjectAiAction(null);
    setProjectAiEstimate(null);
    if (!action) return;
    if (dontAsk) {
      setSkipCostConfirm({ ...skipCostConfirm, [action.kind]: true });
    }
    await actuallyStartProjectAiAction(action);
  };

  const requestDelete = (target: DeleteTarget) => {
    setDeleteError(null);
    setDeleteTarget(target);
  };

  const openFindMoreModal = (tag: TagNode) => {
    setFindMoreTag(tag);
    setSelectedInterviewIds(interviews.map((interview) => interview.id));
  };

  const openDetectTagsModal = () => {
    setDetectTagsInterviewIds(interviews.map((interview) => interview.id));
    setDetectTagsModalOpen(true);
  };

  const closeDetectTagsModal = () => {
    setDetectTagsModalOpen(false);
    setDetectTagsInterviewIds([]);
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

  const onRunDetectTags = async () => {
    if (detectTagsInterviewIds.length === 0) return;
    const interviewIds = [...detectTagsInterviewIds];
    closeDetectTagsModal();
    await launchProjectAiAction(
      { kind: "codebook_gen", interviewIds },
      {
        interview_ids: interviewIds,
        include_existing_codebook: true,
      },
    );
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
      disabled: projectAiBusy || categories.length === 0,
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
      disabled: projectAiBusy || tags.length === 0,
    },
  ];

  const tagMenuItems: SectionMenuItem[] = [
    {
      label: t("tags.createTag", { defaultValue: "Create tag" }),
      onSelect: () => setAddTagFor(null),
    },
    {
      label: t("ai.generateCodebook", { defaultValue: "Derive codebook" }),
      onSelect: openDetectTagsModal,
      disabled: projectAiBusy || interviews.length === 0,
    },
  ];

  return (
    <div className={styles.shell}>
      <ProjectHeader activeView="labels" />

      <PageContainer className={styles.wrap}>
        <PageViewHeader
          view="labels"
          title={t("tags.title", { defaultValue: "Tags" })}
          subtitle={t("tags.subtitle", {
            defaultValue:
              "Manage clusters, categories, and tags across the whole project.",
          })}
        />

        {error && <div className={styles.error}>{error}</div>}
        {findMoreStatus && <div className={styles.notice}>{findMoreStatus}</div>}
        {projectAiStatus && <div className={styles.notice}>{projectAiStatus}</div>}

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
      </PageContainer>

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
        open={detectTagsModalOpen}
        onClose={closeDetectTagsModal}
        title={t("tags.detectTagsTargetsTitle", {
          defaultValue: "Detect tags",
        })}
        footer={
          <>
            <Button onClick={closeDetectTagsModal} disabled={projectAiBusy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void onRunDetectTags()}
              disabled={projectAiBusy || detectTagsInterviewIds.length === 0}
            >
              {t("tags.runDetectTags", { defaultValue: "Run detection" })}
            </Button>
          </>
        }
      >
        <div className={styles.findMoreModal}>
          <p className={styles.findMoreHelp}>
            {t("tags.detectTagsTargetsHelp", {
              defaultValue: "Choose which interviews should be used to detect tags.",
            })}
          </p>
          <div className={styles.findMoreBulkActions}>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => setDetectTagsInterviewIds(interviews.map((interview) => interview.id))}
            >
              {t("tags.selectAll", { defaultValue: "Select all" })}
            </button>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => setDetectTagsInterviewIds([])}
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
                    checked={detectTagsInterviewIds.includes(interview.id)}
                    onChange={() =>
                      setDetectTagsInterviewIds((prev) =>
                        prev.includes(interview.id)
                          ? prev.filter((id) => id !== interview.id)
                          : [...prev, interview.id],
                      )
                    }
                  />
                  <span className={styles.findMoreName}>{interview.name}</span>
                </label>
              ))
            )}
          </div>
          {detectTagsInterviewIds.length === 0 ? (
            <p className={styles.findMoreValidation}>
              {t("ai.selectAtLeastOneInterview", {
                defaultValue: "Select at least one interview",
              })}
            </p>
          ) : null}
        </div>
      </Modal>

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
      {pendingProjectAiAction && projectAiEstimate ? (
        <CostPreviewModal
          estimate={projectAiEstimate}
          prompt=""
          onSend={(dontAsk) => void onSendProjectAiAction(dontAsk)}
          onCancel={() => {
            setPendingProjectAiAction(null);
            setProjectAiEstimate(null);
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

  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ActionMenu
        ariaLabel={t("common.actions", { defaultValue: "Actions" }) as string}
        items={items}
      />
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
  const rowRef = useRef<HTMLDivElement | null>(null);
  const items: ActionMenuItem[] = [
    ...(actionMenu
      ? [
          {
            label: t("ai.findMoreOccurrences", { defaultValue: "Find more occurrences" }),
            disabled: actionMenu.busy,
            onSelect: actionMenu.onFindMore,
          },
        ]
      : []),
    {
      label: t("common.edit", { defaultValue: "Edit" }),
      onSelect: onEdit,
    },
    {
      label: t("common.delete", { defaultValue: "Delete" }),
      onSelect: onDelete,
      destructive: true,
    },
  ];

  return (
    <div className={styles.managementRow} ref={rowRef}>
      <div className={styles.managementMeta}>
        <div className={styles.managementTitleRow}>
          {color && <span className={styles.swatch} style={{ background: color }} />}
          <strong>{name}</strong>
          <span className={styles.count}>({count})</span>
        </div>
        {subtitle ? <div className={styles.managementSubtitle}>{subtitle}</div> : null}
      </div>
      <div className={styles.managementActions}>
        <ActionMenu
          ariaLabel={t("common.actions", { defaultValue: "Actions" }) as string}
          items={items}
          contextMenuTargetRef={rowRef}
        />
      </div>
    </div>
  );
};
