import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  type CategoryNode,
  type ClusterNode,
  type TagNode,
} from "../../ipc/codebook";
import { useAnalysisData } from "./AnalysisData";
import { filterAnalysisItems } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
import styles from "./ThemeMapView.module.css";

type ThemeBranch =
  | { kind: "cluster"; cluster: ClusterNode }
  | { kind: "category"; category: CategoryNode };

type MatrixRow = {
  interviewId: number;
  interviewName: string;
  countsByClusterId: Map<number, number>;
  total: number;
};

type CountMaps = {
  clusterCounts: Map<number, number>;
  categoryCounts: Map<number, number>;
  tagCounts: Map<number, number>;
  clusterMemoCounts: Map<number, number>;
  categoryMemoCounts: Map<number, number>;
  tagMemoCounts: Map<number, number>;
};

const toggleStoredSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export const ThemeMapView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { codebook: tree, interviews, evidenceItems, loading, error } = useAnalysisData();
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const collapseStorageKey = `faden.analysis.theme-map.collapsed:${decodeURIComponent(projectPath)}`;

  useEffect(() => {
    const raw = window.localStorage.getItem(collapseStorageKey);
    if (!raw) {
      setCollapsedKeys(new Set());
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setCollapsedKeys(Array.isArray(parsed) ? new Set(parsed.filter((item) => typeof item === "string")) : new Set());
    } catch {
      setCollapsedKeys(new Set());
    }
  }, [collapseStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(collapseStorageKey, JSON.stringify(Array.from(collapsedKeys)));
  }, [collapseStorageKey, collapsedKeys]);

  const openEvidenceForHierarchy = (filters: {
    clusterId?: number;
    categoryId?: number;
    tagId?: number;
    interviewId?: number;
    memoOnly?: boolean;
  }) => {
    void navigate({
      to: "/workspace/$projectPath/analysis/evidence",
      params: { projectPath },
      search: mergeAnalysisSearch(search, {
        clusterId: filters.clusterId,
        categoryId: filters.categoryId,
        tagId: filters.tagId,
        interviewId: filters.interviewId,
        memoOnly: filters.memoOnly,
      }) as never,
    });
  };

  const openMemosForHierarchy = (filters: {
    clusterId?: number;
    categoryId?: number;
    tagId?: number;
  }) => {
    void navigate({
      to: "/workspace/$projectPath/analysis/memos",
      params: { projectPath },
      search: mergeAnalysisSearch(search, {
        ...filters,
        memoOnly: true,
      }) as never,
    });
  };

  const branches = useMemo<ThemeBranch[]>(() => {
    if (!tree) return [];
    return [
      ...tree.clusters.map((cluster) => ({ kind: "cluster" as const, cluster })),
      ...tree.standaloneCategories.map((category) => ({ kind: "category" as const, category })),
    ];
  }, [tree]);

  const summary = useMemo(() => {
    if (!tree) {
      return { clusters: 0, categories: 0, tags: 0, codedReferences: 0 };
    }
    const allCategories = [
      ...tree.standaloneCategories,
      ...tree.clusters.flatMap((cluster) => cluster.categories),
    ];
    const allTags = [
      ...tree.standaloneTags,
      ...tree.standaloneCategories.flatMap((category) => category.tags),
      ...tree.clusters.flatMap((cluster) => cluster.categories.flatMap((category) => category.tags)),
    ];
    return {
      clusters: tree.clusters.length,
      categories: allCategories.length,
      tags: allTags.length,
      codedReferences: allTags.reduce((sum, tag) => sum + tag.count, 0),
    };
  }, [tree]);

  const scopedEvidenceItems = useMemo(
    () => filterAnalysisItems(evidenceItems, search),
    [evidenceItems, search],
  );

  const scopedCounts = useMemo<CountMaps>(() => {
    const clusterCounts = new Map<number, Set<number>>();
    const categoryCounts = new Map<number, Set<number>>();
    const tagCounts = new Map<number, Set<number>>();
    const clusterMemoCounts = new Map<number, Set<number>>();
    const categoryMemoCounts = new Map<number, Set<number>>();
    const tagMemoCounts = new Map<number, Set<number>>();

    for (const item of scopedEvidenceItems) {
      const hasMemo = Boolean(item.memo);
      const seenClusters = new Set<number>();
      const seenCategories = new Set<number>();
      const seenTags = new Set<number>();
      for (const meta of item.tagMetas) {
        if (!seenTags.has(meta.tag.id)) {
          (tagCounts.get(meta.tag.id) ?? tagCounts.set(meta.tag.id, new Set()).get(meta.tag.id))?.add(item.span.id);
          if (hasMemo) (tagMemoCounts.get(meta.tag.id) ?? tagMemoCounts.set(meta.tag.id, new Set()).get(meta.tag.id))?.add(item.span.id);
          seenTags.add(meta.tag.id);
        }
        if (meta.category && !seenCategories.has(meta.category.id)) {
          (categoryCounts.get(meta.category.id) ?? categoryCounts.set(meta.category.id, new Set()).get(meta.category.id))?.add(item.span.id);
          if (hasMemo) (categoryMemoCounts.get(meta.category.id) ?? categoryMemoCounts.set(meta.category.id, new Set()).get(meta.category.id))?.add(item.span.id);
          seenCategories.add(meta.category.id);
        }
        if (meta.cluster && !seenClusters.has(meta.cluster.id)) {
          (clusterCounts.get(meta.cluster.id) ?? clusterCounts.set(meta.cluster.id, new Set()).get(meta.cluster.id))?.add(item.span.id);
          if (hasMemo) (clusterMemoCounts.get(meta.cluster.id) ?? clusterMemoCounts.set(meta.cluster.id, new Set()).get(meta.cluster.id))?.add(item.span.id);
          seenClusters.add(meta.cluster.id);
        }
      }
    }

    return {
      clusterCounts: new Map(Array.from(clusterCounts, ([key, value]) => [key, value.size])),
      categoryCounts: new Map(Array.from(categoryCounts, ([key, value]) => [key, value.size])),
      tagCounts: new Map(Array.from(tagCounts, ([key, value]) => [key, value.size])),
      clusterMemoCounts: new Map(Array.from(clusterMemoCounts, ([key, value]) => [key, value.size])),
      categoryMemoCounts: new Map(Array.from(categoryMemoCounts, ([key, value]) => [key, value.size])),
      tagMemoCounts: new Map(Array.from(tagMemoCounts, ([key, value]) => [key, value.size])),
    };
  }, [scopedEvidenceItems]);

  const matrixRows = useMemo<MatrixRow[]>(() => {
    if (!tree) return [];
    const tagClusterByTagId = new Map<number, number>();
    for (const cluster of tree.clusters) {
      for (const category of cluster.categories) {
        for (const tag of category.tags) {
          tagClusterByTagId.set(tag.id, cluster.id);
        }
      }
    }

    return interviews.map((interview) => {
      const spans = scopedEvidenceItems.filter((item) => item.interview.id === interview.id);
      const spanIdsByClusterId = new Map<number, Set<number>>();
      const totalSpanIds = new Set<number>();
      for (const item of spans) {
        const clusterIds = new Set<number>();
        for (const meta of item.tagMetas) {
          const clusterId = tagClusterByTagId.get(meta.tag.id);
          if (clusterId !== undefined) clusterIds.add(clusterId);
        }
        if (clusterIds.size > 0) totalSpanIds.add(item.span.id);
        for (const clusterId of clusterIds) {
          const spanIds = spanIdsByClusterId.get(clusterId) ?? new Set<number>();
          spanIds.add(item.span.id);
          spanIdsByClusterId.set(clusterId, spanIds);
        }
      }

      const countsByClusterId = new Map<number, number>();
      for (const cluster of tree.clusters) {
        countsByClusterId.set(cluster.id, spanIdsByClusterId.get(cluster.id)?.size ?? 0);
      }

      return {
        interviewId: interview.id,
        interviewName: interview.name,
        countsByClusterId,
        total: totalSpanIds.size,
      };
    });
  }, [interviews, scopedEvidenceItems, tree]);

  const matrixHasData = useMemo(
    () => matrixRows.some((row) => Array.from(row.countsByClusterId.values()).some((count) => count > 0)),
    [matrixRows],
  );

  const matrixColumnTotals = useMemo(() => {
    if (!tree) return new Map<number, number>();
    const totals = new Map<number, number>();
    for (const cluster of tree.clusters) {
      totals.set(
        cluster.id,
        matrixRows.reduce((sum, row) => sum + (row.countsByClusterId.get(cluster.id) ?? 0), 0),
      );
    }
    return totals;
  }, [matrixRows, tree]);

  const inScopeMemoCount = scopedEvidenceItems.filter((item) => item.memo).length;

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("analysis.themeMap.title", { defaultValue: "Theme map" })}</h1>
          <p className={styles.subtitle}>
            {t("analysis.themeMap.subtitle", {
              defaultValue:
                "Read the current analytic hierarchy from clusters to categories to tags. Counts reflect currently coded material.",
            })}
          </p>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <strong>{summary.clusters}</strong>
            <span>
              {t("analysis.themeMap.summary", {
                clusters: summary.clusters,
                categories: summary.categories,
                tags: summary.tags,
                defaultValue: "{{clusters}} clusters · {{categories}} categories · {{tags}} tags",
              })}
            </span>
          </div>
          <div className={styles.summaryCard}>
            <strong>{scopedEvidenceItems.length}</strong>
            <span>
              {t("analysis.themeMap.scopeSummary", {
                evidence: scopedEvidenceItems.length,
                memos: inScopeMemoCount,
                defaultValue: "In scope: {{evidence}} quotes · {{memos}} memo-backed",
              })}
            </span>
          </div>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => undefined} /> : null}

      <section className={styles.explainerCard}>
        <p className={styles.explainerText}>
          {t("analysis.themeMap.readOnlyHint", {
            defaultValue:
              "This view is read-only. Use Labels to change the structure, then return here to review the hierarchy.",
          })}
        </p>
        <div className={styles.metrics}>
          <span>
            {t("analysis.themeMap.metricCodedReferences", {
              count: summary.codedReferences,
              defaultValue: "Coded references: {{count}}",
            })}
          </span>
          <span>
            {t("analysis.themeMap.metricCategories", {
              count: summary.categories,
              defaultValue: "Categories: {{count}}",
            })}
          </span>
          <span>
            {t("analysis.themeMap.metricTags", {
              count: summary.tags,
              defaultValue: "Tags: {{count}}",
            })}
          </span>
        </div>
      </section>

      <section className={styles.mapCard}>
        {loading ? (
          <p className={styles.empty}>{t("analysis.themeMap.loading", { defaultValue: "Loading theme map…" })}</p>
        ) : !tree || (branches.length === 0 && tree.standaloneTags.length === 0) ? (
          <p className={styles.empty}>
            {t("analysis.themeMap.emptyProject", {
              defaultValue: "No hierarchy yet. Create clusters, categories, or tags in Labels to see the theme map here.",
            })}
          </p>
        ) : (
          <div className={styles.branchList}>
            {branches.map((branch) =>
              branch.kind === "cluster" ? (
                <ClusterSection
                  key={`cluster-${branch.cluster.id}`}
                  cluster={branch.cluster}
                  collapsed={collapsedKeys.has(`cluster:${branch.cluster.id}`)}
                  onToggle={() => setCollapsedKeys((current) => toggleStoredSet(current, `cluster:${branch.cluster.id}`))}
                  count={scopedCounts.clusterCounts.get(branch.cluster.id) ?? 0}
                  memoCount={scopedCounts.clusterMemoCounts.get(branch.cluster.id) ?? 0}
                  categoryCounts={scopedCounts.categoryCounts}
                  categoryMemoCounts={scopedCounts.categoryMemoCounts}
                  tagCounts={scopedCounts.tagCounts}
                  tagMemoCounts={scopedCounts.tagMemoCounts}
                  collapsedKeys={collapsedKeys}
                  setCollapsedKeys={setCollapsedKeys}
                  onOpenClusterEvidence={() => openEvidenceForHierarchy({ clusterId: branch.cluster.id })}
                  onOpenClusterMemos={() => openMemosForHierarchy({ clusterId: branch.cluster.id })}
                  onOpenCategoryEvidence={(categoryId) =>
                    openEvidenceForHierarchy({ clusterId: branch.cluster.id, categoryId })
                  }
                  onOpenCategoryMemos={(categoryId) =>
                    openMemosForHierarchy({ clusterId: branch.cluster.id, categoryId })
                  }
                  onOpenTagEvidence={(categoryId, tagId) =>
                    openEvidenceForHierarchy({ clusterId: branch.cluster.id, categoryId, tagId })
                  }
                  onOpenTagMemos={(categoryId, tagId) =>
                    openMemosForHierarchy({ clusterId: branch.cluster.id, categoryId, tagId })
                  }
                />
              ) : (
                <StandaloneCategorySection
                  key={`category-${branch.category.id}`}
                  category={branch.category}
                  collapsed={collapsedKeys.has(`category:${branch.category.id}`)}
                  onToggle={() => setCollapsedKeys((current) => toggleStoredSet(current, `category:${branch.category.id}`))}
                  count={scopedCounts.categoryCounts.get(branch.category.id) ?? 0}
                  memoCount={scopedCounts.categoryMemoCounts.get(branch.category.id) ?? 0}
                  tagCounts={scopedCounts.tagCounts}
                  tagMemoCounts={scopedCounts.tagMemoCounts}
                  onOpenCategoryEvidence={() => openEvidenceForHierarchy({ categoryId: branch.category.id })}
                  onOpenCategoryMemos={() => openMemosForHierarchy({ categoryId: branch.category.id })}
                  onOpenTagEvidence={(tagId) => openEvidenceForHierarchy({ categoryId: branch.category.id, tagId })}
                  onOpenTagMemos={(tagId) => openMemosForHierarchy({ categoryId: branch.category.id, tagId })}
                />
              ),
            )}
            {tree.standaloneTags.length > 0 ? (
              <section className={styles.branchCard}>
                <div className={styles.branchHeader}>
                  <div>
                    <h2 className={styles.branchTitle}>
                      {t("analysis.themeMap.standaloneTags", { defaultValue: "Standalone tags" })}
                    </h2>
                    <p className={styles.branchMeta}>
                      {t("analysis.themeMap.standaloneTagsHint", {
                        defaultValue: "Tags without a category yet",
                      })}
                    </p>
                  </div>
                </div>
                <ul className={styles.tagList}>
                  {tree.standaloneTags.map((tag) => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      count={scopedCounts.tagCounts.get(tag.id) ?? 0}
                      memoCount={scopedCounts.tagMemoCounts.get(tag.id) ?? 0}
                      onOpenEvidence={() => openEvidenceForHierarchy({ tagId: tag.id })}
                      onOpenMemos={() => openMemosForHierarchy({ tagId: tag.id })}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </section>

      <section className={styles.matrixCard}>
        <div className={styles.matrixHeader}>
          <div>
            <h2 className={styles.sectionTitle}>
              {t("analysis.themeMap.matrixTitle", { defaultValue: "Theme prevalence matrix" })}
            </h2>
            <p className={styles.sectionSubtitle}>
              {t("analysis.themeMap.matrixSubtitle", {
                defaultValue:
                  "Rows are interviews and columns are clusters. Each cell counts distinct coded spans in that interview for that cluster. These matrix counts are deduplicated within each cluster and may differ from hierarchy reference counts above.",
              })}
            </p>
          </div>
        </div>

        {loading ? (
          <p className={styles.empty}>{t("analysis.themeMap.matrixLoading", { defaultValue: "Loading prevalence matrix…" })}</p>
        ) : !tree || tree.clusters.length === 0 ? (
          <p className={styles.empty}>
            {t("analysis.themeMap.matrixEmptyClusters", {
              defaultValue: "Add clusters in Labels to see the prevalence matrix.",
            })}
          </p>
        ) : interviews.length === 0 ? (
          <p className={styles.empty}>
            {t("analysis.themeMap.matrixEmptyInterviews", {
              defaultValue: "No interviews yet. Add interviews to compare theme prevalence.",
            })}
          </p>
        ) : !matrixHasData ? (
          <p className={styles.empty}>
            {t("analysis.themeMap.matrixEmptyData", {
              defaultValue: "No clustered coded references yet. Tag transcript spans with tags inside clusters to populate the matrix.",
            })}
          </p>
        ) : (
          <div className={styles.matrixWrap}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>{t("analysis.themeMap.matrixInterview", { defaultValue: "Interview" })}</th>
                  {tree.clusters.map((cluster) => (
                    <th key={cluster.id}>
                      <button
                        type="button"
                        className={styles.matrixLinkButton}
                        onClick={() => openEvidenceForHierarchy({ clusterId: cluster.id })}
                      >
                        {cluster.name}
                      </button>
                    </th>
                  ))}
                  <th>{t("analysis.themeMap.matrixTotal", { defaultValue: "Distinct total" })}</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={row.interviewId}>
                    <th>
                      <button
                        type="button"
                        className={styles.matrixLinkButton}
                        onClick={() => openEvidenceForHierarchy({ interviewId: row.interviewId })}
                      >
                        {row.interviewName}
                      </button>
                    </th>
                    {tree.clusters.map((cluster) => {
                      const value = row.countsByClusterId.get(cluster.id) ?? 0;
                      return (
                        <td key={cluster.id} data-has-value={value > 0 ? "true" : "false"}>
                          {value > 0 ? (
                            <button
                              type="button"
                              className={styles.matrixValueButton}
                              onClick={() => openEvidenceForHierarchy({ interviewId: row.interviewId, clusterId: cluster.id })}
                            >
                              {value}
                            </button>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                    <td data-has-value={row.total > 0 ? "true" : "false"}>{row.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t("analysis.themeMap.matrixColumnTotals", { defaultValue: "Cluster totals" })}</th>
                  {tree.clusters.map((cluster) => (
                    <td key={cluster.id} data-has-value={(matrixColumnTotals.get(cluster.id) ?? 0) > 0 ? "true" : "false"}>
                      {matrixColumnTotals.get(cluster.id) ?? 0}
                    </td>
                  ))}
                  <td>{matrixRows.reduce((sum, row) => sum + row.total, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
};

const ClusterSection = ({
  cluster,
  collapsed,
  onToggle,
  count,
  memoCount,
  categoryCounts,
  categoryMemoCounts,
  tagCounts,
  tagMemoCounts,
  collapsedKeys,
  setCollapsedKeys,
  onOpenClusterEvidence,
  onOpenClusterMemos,
  onOpenCategoryEvidence,
  onOpenCategoryMemos,
  onOpenTagEvidence,
  onOpenTagMemos,
}: {
  cluster: ClusterNode;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
  memoCount: number;
  categoryCounts: Map<number, number>;
  categoryMemoCounts: Map<number, number>;
  tagCounts: Map<number, number>;
  tagMemoCounts: Map<number, number>;
  collapsedKeys: Set<string>;
  setCollapsedKeys: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
  onOpenClusterEvidence: () => void;
  onOpenClusterMemos: () => void;
  onOpenCategoryEvidence: (categoryId: number) => void;
  onOpenCategoryMemos: (categoryId: number) => void;
  onOpenTagEvidence: (categoryId: number, tagId: number) => void;
  onOpenTagMemos: (categoryId: number, tagId: number) => void;
}) => {
  const { t } = useTranslation();

  return (
    <section className={styles.branchCard}>
      <div className={styles.branchHeader}>
        <div>
          <button type="button" className={styles.expandButton} onClick={onToggle}>
            {collapsed ? "▸" : "▾"}
          </button>
          <h2 className={styles.branchTitle}>{cluster.name}</h2>
          <p className={styles.branchMeta}>
            {t("analysis.themeMap.clusterSummary", {
              categories: cluster.categories.length,
              references: count,
              defaultValue: "Categories: {{categories}} · Coded references: {{references}}",
            })}
          </p>
        </div>
        <div className={styles.countActions}>
          <CountPill count={count} onClick={count > 0 ? onOpenClusterEvidence : undefined} label={t("analysis.themeMap.viewEvidence", { defaultValue: "View evidence" })} />
          <CountPill count={memoCount} onClick={memoCount > 0 ? onOpenClusterMemos : undefined} label={t("analysis.themeMap.viewMemos", { defaultValue: "View memos" })} tone="memo" />
        </div>
      </div>
      {cluster.description ? <p className={styles.description}>{cluster.description}</p> : null}
      {!collapsed ? (
        cluster.categories.length === 0 ? (
          <p className={styles.nestedEmpty}>
            {t("analysis.themeMap.emptyCluster", {
              defaultValue: "No categories in this cluster yet.",
            })}
          </p>
        ) : (
          <div className={styles.categoryList}>
            {cluster.categories.map((category) => {
              const categoryCollapsed = collapsedKeys.has(`category:${category.id}`);
              return (
                <CategoryCard
                  key={category.id}
                  category={category}
                  collapsed={categoryCollapsed}
                  onToggle={() => setCollapsedKeys((current) => toggleStoredSet(current, `category:${category.id}`))}
                  count={categoryCounts.get(category.id) ?? 0}
                  memoCount={categoryMemoCounts.get(category.id) ?? 0}
                  tagCounts={tagCounts}
                  tagMemoCounts={tagMemoCounts}
                  onOpenEvidence={() => onOpenCategoryEvidence(category.id)}
                  onOpenMemos={() => onOpenCategoryMemos(category.id)}
                  onOpenTagEvidence={(tagId) => onOpenTagEvidence(category.id, tagId)}
                  onOpenTagMemos={(tagId) => onOpenTagMemos(category.id, tagId)}
                />
              );
            })}
          </div>
        )
      ) : null}
    </section>
  );
};

const StandaloneCategorySection = ({
  category,
  collapsed,
  onToggle,
  count,
  memoCount,
  tagCounts,
  tagMemoCounts,
  onOpenCategoryEvidence,
  onOpenCategoryMemos,
  onOpenTagEvidence,
  onOpenTagMemos,
}: {
  category: CategoryNode;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
  memoCount: number;
  tagCounts: Map<number, number>;
  tagMemoCounts: Map<number, number>;
  onOpenCategoryEvidence: () => void;
  onOpenCategoryMemos: () => void;
  onOpenTagEvidence: (tagId: number) => void;
  onOpenTagMemos: (tagId: number) => void;
}) => {
  const { t } = useTranslation();

  return (
    <section className={styles.branchCard}>
      <div className={styles.branchHeader}>
        <div>
          <button type="button" className={styles.expandButton} onClick={onToggle}>
            {collapsed ? "▸" : "▾"}
          </button>
          <h2 className={styles.branchTitle}>{category.name}</h2>
          <p className={styles.branchMeta}>
            {t("analysis.themeMap.standaloneCategory", {
              defaultValue: "Category without a cluster",
            })}
          </p>
        </div>
        <div className={styles.countActions}>
          <CountPill count={count} onClick={count > 0 ? onOpenCategoryEvidence : undefined} label={t("analysis.themeMap.viewEvidence", { defaultValue: "View evidence" })} />
          <CountPill count={memoCount} onClick={memoCount > 0 ? onOpenCategoryMemos : undefined} label={t("analysis.themeMap.viewMemos", { defaultValue: "View memos" })} tone="memo" />
        </div>
      </div>
      {category.description ? <p className={styles.description}>{category.description}</p> : null}
      {!collapsed ? (
        category.tags.length === 0 ? (
          <p className={styles.nestedEmpty}>
            {t("analysis.themeMap.emptyCategory", {
              defaultValue: "No tags in this category yet.",
            })}
          </p>
        ) : (
          <ul className={styles.tagList}>
            {category.tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                count={tagCounts.get(tag.id) ?? 0}
                memoCount={tagMemoCounts.get(tag.id) ?? 0}
                onOpenEvidence={() => onOpenTagEvidence(tag.id)}
                onOpenMemos={() => onOpenTagMemos(tag.id)}
              />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
};

const CategoryCard = ({
  category,
  collapsed,
  onToggle,
  count,
  memoCount,
  tagCounts,
  tagMemoCounts,
  onOpenEvidence,
  onOpenMemos,
  onOpenTagEvidence,
  onOpenTagMemos,
}: {
  category: CategoryNode;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
  memoCount: number;
  tagCounts: Map<number, number>;
  tagMemoCounts: Map<number, number>;
  onOpenEvidence: () => void;
  onOpenMemos: () => void;
  onOpenTagEvidence: (tagId: number) => void;
  onOpenTagMemos: (tagId: number) => void;
}) => {
  const { t } = useTranslation();

  return (
    <article className={styles.categoryCard}>
      <div className={styles.categoryHeader}>
        <div>
          <button type="button" className={styles.expandButton} onClick={onToggle}>
            {collapsed ? "▸" : "▾"}
          </button>
          <h3 className={styles.categoryTitle}>{category.name}</h3>
          <p className={styles.categoryMeta}>
            {t("analysis.themeMap.categorySummary", {
              tags: category.tags.length,
              references: count,
              defaultValue: "Tags: {{tags}} · Coded references: {{references}}",
            })}
          </p>
        </div>
        <div className={styles.countActions}>
          <CountPill count={count} onClick={count > 0 ? onOpenEvidence : undefined} label={t("analysis.themeMap.viewEvidence", { defaultValue: "View evidence" })} />
          <CountPill count={memoCount} onClick={memoCount > 0 ? onOpenMemos : undefined} label={t("analysis.themeMap.viewMemos", { defaultValue: "View memos" })} tone="memo" />
        </div>
      </div>
      {category.description ? <p className={styles.description}>{category.description}</p> : null}
      {!collapsed ? (
        category.tags.length === 0 ? (
          <p className={styles.nestedEmpty}>
            {t("analysis.themeMap.emptyCategory", {
              defaultValue: "No tags in this category yet.",
            })}
          </p>
        ) : (
          <ul className={styles.tagList}>
            {category.tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                count={tagCounts.get(tag.id) ?? 0}
                memoCount={tagMemoCounts.get(tag.id) ?? 0}
                onOpenEvidence={() => onOpenTagEvidence(tag.id)}
                onOpenMemos={() => onOpenTagMemos(tag.id)}
              />
            ))}
          </ul>
        )
      ) : null}
    </article>
  );
};

const TagRow = ({
  tag,
  count,
  memoCount,
  onOpenEvidence,
  onOpenMemos,
}: {
  tag: TagNode;
  count: number;
  memoCount: number;
  onOpenEvidence?: () => void;
  onOpenMemos?: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <li className={styles.tagRow}>
      <div>
        <div className={styles.tagName}>{tag.name}</div>
        {tag.description ? <p className={styles.tagDescription}>{tag.description}</p> : null}
      </div>
      <div className={styles.countActions}>
        <CountPill count={count} onClick={count > 0 ? onOpenEvidence : undefined} label={t("analysis.themeMap.viewEvidence", { defaultValue: "View evidence" })} />
        <CountPill count={memoCount} onClick={memoCount > 0 ? onOpenMemos : undefined} label={t("analysis.themeMap.viewMemos", { defaultValue: "View memos" })} tone="memo" />
      </div>
    </li>
  );
};

const CountPill = ({
  count,
  onClick,
  label,
  tone = "default",
}: {
  count: number;
  onClick?: () => void;
  label?: string;
  tone?: "default" | "memo";
}) =>
  onClick ? (
    <button type="button" className={`${styles.countPill} ${styles.countPillButton} ${tone === "memo" ? styles.countPillMemo : ""}`.trim()} onClick={onClick} title={label}>
      {count}
    </button>
  ) : (
    <span className={`${styles.countPill} ${tone === "memo" ? styles.countPillMemo : ""}`.trim()}>{count}</span>
  );
