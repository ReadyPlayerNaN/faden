import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  type CategoryNode,
  type ClusterNode,
  type TagNode,
} from "../../ipc/codebook";
import { useAnalysisData } from "./AnalysisData";
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

export const ThemeMapView = () => {
  const { t } = useTranslation();
  const { codebook: tree, interviews, spanGroups, loading, error } = useAnalysisData();

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

    return spanGroups.map(({ interview, spans }) => {
      const spanIdsByClusterId = new Map<number, Set<number>>();
      const totalSpanIds = new Set<number>();
      for (const span of spans) {
        const clusterIds = new Set<number>();
        for (const tag of span.tags) {
          const clusterId = tagClusterByTagId.get(tag.tagId);
          if (clusterId !== undefined) clusterIds.add(clusterId);
        }
        if (clusterIds.size > 0) totalSpanIds.add(span.id);
        for (const clusterId of clusterIds) {
          const spanIds = spanIdsByClusterId.get(clusterId) ?? new Set<number>();
          spanIds.add(span.id);
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
  }, [spanGroups, tree]);

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

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {t("analysis.themeMap.title", { defaultValue: "Theme map" })}
          </h1>
          <p className={styles.subtitle}>
            {t("analysis.themeMap.subtitle", {
              defaultValue:
                "Read the current analytic hierarchy from clusters to categories to tags. Counts reflect currently coded material.",
            })}
          </p>
        </div>
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
                <ClusterSection key={`cluster-${branch.cluster.id}`} cluster={branch.cluster} />
              ) : (
                <StandaloneCategorySection key={`category-${branch.category.id}`} category={branch.category} />
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
                    <TagRow key={tag.id} tag={tag} />
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
                    <th key={cluster.id}>{cluster.name}</th>
                  ))}
                  <th>{t("analysis.themeMap.matrixTotal", { defaultValue: "Distinct total" })}</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={row.interviewId}>
                    <th>{row.interviewName}</th>
                    {tree.clusters.map((cluster) => {
                      const value = row.countsByClusterId.get(cluster.id) ?? 0;
                      return (
                        <td key={cluster.id} data-has-value={value > 0 ? "true" : "false"}>
                          {value}
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

const ClusterSection = ({ cluster }: { cluster: ClusterNode }) => {
  const { t } = useTranslation();

  return (
    <section className={styles.branchCard}>
      <div className={styles.branchHeader}>
        <div>
          <h2 className={styles.branchTitle}>{cluster.name}</h2>
          <p className={styles.branchMeta}>
            {t("analysis.themeMap.clusterSummary", {
              categories: cluster.categories.length,
              references: cluster.count,
              defaultValue: "Categories: {{categories}} · Coded references: {{references}}",
            })}
          </p>
        </div>
        <CountPill count={cluster.count} />
      </div>
      {cluster.description ? <p className={styles.description}>{cluster.description}</p> : null}
      {cluster.categories.length === 0 ? (
        <p className={styles.nestedEmpty}>
          {t("analysis.themeMap.emptyCluster", {
            defaultValue: "No categories in this cluster yet.",
          })}
        </p>
      ) : (
        <div className={styles.categoryList}>
          {cluster.categories.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      )}
    </section>
  );
};

const StandaloneCategorySection = ({ category }: { category: CategoryNode }) => {
  const { t } = useTranslation();

  return (
    <section className={styles.branchCard}>
      <div className={styles.branchHeader}>
        <div>
          <h2 className={styles.branchTitle}>{category.name}</h2>
          <p className={styles.branchMeta}>
            {t("analysis.themeMap.standaloneCategory", {
              defaultValue: "Category without a cluster",
            })}
          </p>
        </div>
        <CountPill count={category.count} />
      </div>
      {category.description ? <p className={styles.description}>{category.description}</p> : null}
      {category.tags.length === 0 ? (
        <p className={styles.nestedEmpty}>
          {t("analysis.themeMap.emptyCategory", {
            defaultValue: "No tags in this category yet.",
          })}
        </p>
      ) : (
        <ul className={styles.tagList}>
          {category.tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </section>
  );
};

const CategoryCard = ({ category }: { category: CategoryNode }) => {
  const { t } = useTranslation();

  return (
    <article className={styles.categoryCard}>
      <div className={styles.categoryHeader}>
        <div>
          <h3 className={styles.categoryTitle}>{category.name}</h3>
          <p className={styles.categoryMeta}>
            {t("analysis.themeMap.categorySummary", {
              tags: category.tags.length,
              references: category.count,
              defaultValue: "Tags: {{tags}} · Coded references: {{references}}",
            })}
          </p>
        </div>
        <CountPill count={category.count} />
      </div>
      {category.description ? <p className={styles.description}>{category.description}</p> : null}
      {category.tags.length === 0 ? (
        <p className={styles.nestedEmpty}>
          {t("analysis.themeMap.emptyCategory", {
            defaultValue: "No tags in this category yet.",
          })}
        </p>
      ) : (
        <ul className={styles.tagList}>
          {category.tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </article>
  );
};

const TagRow = ({ tag }: { tag: TagNode }) => {
  const { t } = useTranslation();

  return (
    <li className={styles.tagRow}>
      <div>
        <div className={styles.tagName}>{tag.name}</div>
        {tag.description ? <p className={styles.tagDescription}>{tag.description}</p> : null}
      </div>
      <span className={styles.tagCount}>
        {t("analysis.themeMap.tagCount", {
          count: tag.count,
          defaultValue: "Refs: {{count}}",
        })}
      </span>
    </li>
  );
};

const CountPill = ({ count }: { count: number }) => <span className={styles.countPill}>{count}</span>;
