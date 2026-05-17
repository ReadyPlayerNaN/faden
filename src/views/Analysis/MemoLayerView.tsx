import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useAnalysisData } from "./AnalysisData";
import { useAnalysisHierarchyFilters } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
import styles from "./MemoLayerView.module.css";

export const MemoLayerView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { codebook, interviews, memoItems, loading, error } = useAnalysisData();

  const setSearchFilters = (patch: Partial<Record<keyof AnalysisSearch, number | null | undefined>>) => {
    void navigate({
      search: mergeAnalysisSearch(search, patch) as never,
      replace: true,
    });
  };

  const {
    clusterFilter,
    setClusterFilter,
    categoryFilter,
    setCategoryFilter,
    tagFilter,
    setTagFilter,
    interviewFilter,
    setInterviewFilter,
    filteredCategoryOptions,
    filteredTagOptions,
    interviewOptions,
    visibleItems,
  } = useAnalysisHierarchyFilters({
    codebookClusters: codebook?.clusters ?? [],
    standaloneCategories: codebook?.standaloneCategories ?? [],
    interviews,
    items: memoItems,
    clusterFilter: search.clusterId ?? null,
    setClusterFilter: (value) => setSearchFilters({ clusterId: value, categoryId: undefined, tagId: undefined }),
    categoryFilter: search.categoryId ?? null,
    setCategoryFilter: (value) => setSearchFilters({ categoryId: value, tagId: undefined }),
    tagFilter: search.tagId ?? null,
    setTagFilter: (value) => setSearchFilters({ tagId: value }),
    interviewFilter: search.interviewId ?? null,
    setInterviewFilter: (value) => setSearchFilters({ interviewId: value }),
  });

  const visibleMemos = useMemo(() => visibleItems, [visibleItems]);
  const categorySelectDisabled = filteredCategoryOptions.length === 0;
  const tagSelectDisabled = filteredTagOptions.length === 0;

  const categoryPlaceholder = categorySelectDisabled
    ? clusterFilter !== null
      ? t("analysis.memos.noCategoriesInCluster", { defaultValue: "No categories in current cluster" })
      : t("analysis.memos.noCategoriesInScope", { defaultValue: "No categories in current scope" })
    : t("analysis.memos.allCategories", { defaultValue: "All categories" });

  const tagPlaceholder = tagSelectDisabled
    ? categoryFilter !== null
      ? t("analysis.memos.noTagsInCategory", { defaultValue: "No tags in current category" })
      : clusterFilter !== null
        ? t("analysis.memos.noTagsInCluster", { defaultValue: "No tags in current cluster" })
        : t("analysis.memos.noTagsInScope", { defaultValue: "No tags in current scope" })
    : t("analysis.memos.allTags", { defaultValue: "All tags" });

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {t("analysis.memos.title", { defaultValue: "Memos" })}
          </h1>
          <p className={styles.subtitle}>
            {t("analysis.memos.subtitle", {
              defaultValue:
                "Review interpretation notes attached to coded spans and keep them grounded in the underlying evidence.",
            })}
          </p>
        </div>
        <div className={styles.summaryCard}>
          <strong>{visibleMemos.length}</strong>
          <span>
            {t("analysis.memos.resultsSummary", {
              shown: visibleMemos.length,
              total: memoItems.length,
              defaultValue: "{{shown}} of {{total}} memos",
            })}
          </span>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => undefined} /> : null}

      <section className={styles.filtersCard}>
        <div className={styles.filtersHeader}>
          <h2 className={styles.sectionTitle}>
            {t("analysis.memos.filters", { defaultValue: "Filters" })}
          </h2>
          <Button
            onClick={() => {
              setSearchFilters({ clusterId: undefined, categoryId: undefined, tagId: undefined, interviewId: undefined });
            }}
            disabled={
              clusterFilter === null &&
              categoryFilter === null &&
              tagFilter === null &&
              interviewFilter === null
            }
          >
            {t("analysis.memos.clearFilters", { defaultValue: "Clear filters" })}
          </Button>
        </div>

        <div className={styles.filtersGrid}>
          <label className={styles.filterField}>
            <span>{t("analysis.memos.cluster", { defaultValue: "Cluster" })}</span>
            <select
              value={clusterFilter ?? ""}
              onChange={(event) => setClusterFilter(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("analysis.memos.allClusters", { defaultValue: "All clusters" })}</option>
              {codebook?.clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span>{t("analysis.memos.category", { defaultValue: "Category" })}</span>
            <select
              value={categoryFilter ?? ""}
              onChange={(event) => setCategoryFilter(event.target.value ? Number(event.target.value) : null)}
              disabled={categorySelectDisabled}
            >
              <option value="">{categoryPlaceholder}</option>
              {filteredCategoryOptions.map(({ category, cluster }) => (
                <option key={category.id} value={category.id}>
                  {cluster ? `${cluster.name} › ${category.name}` : category.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span>{t("analysis.memos.tag", { defaultValue: "Tag" })}</span>
            <select
              value={tagFilter ?? ""}
              onChange={(event) => setTagFilter(event.target.value ? Number(event.target.value) : null)}
              disabled={tagSelectDisabled}
            >
              <option value="">{tagPlaceholder}</option>
              {filteredTagOptions.map((meta) => (
                <option key={meta.tag.id} value={meta.tag.id}>
                  {meta.tag.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span>{t("analysis.memos.interview", { defaultValue: "Interview" })}</span>
            <select
              value={interviewFilter ?? ""}
              onChange={(event) => setInterviewFilter(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("analysis.memos.allInterviews", { defaultValue: "All interviews" })}</option>
              {interviewOptions.map((interview) => (
                <option key={interview.id} value={interview.id}>
                  {interview.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={styles.resultsCard}>
        {loading ? (
          <p className={styles.empty}>
            {t("analysis.memos.loading", { defaultValue: "Loading memos…" })}
          </p>
        ) : visibleMemos.length === 0 ? (
          <p className={styles.empty}>
            {memoItems.length === 0
              ? t("analysis.memos.emptyProject", {
                  defaultValue: "No memo-backed coded spans yet. Add memos to coded quotes to review them here.",
                })
              : t("analysis.memos.emptyFiltered", {
                  defaultValue: "No memos match the current filters.",
                })}
          </p>
        ) : (
          <ul className={styles.resultsList}>
            {visibleMemos.map((item) => (
              <li key={item.span.id} className={styles.memoCard}>
                <div className={styles.resultMeta}>
                  <span className={styles.interviewName}>{item.interview.name}</span>
                  <span className={styles.metaDivider}>•</span>
                  <span>
                    {t("analysis.memos.segmentRef", {
                      segmentId: item.span.segmentId,
                      defaultValue: "Segment {{segmentId}}",
                    })}
                  </span>
                </div>
                <p className={styles.memoBody}>{item.memo}</p>
                <blockquote className={styles.quote}>{item.span.textSnapshot}</blockquote>
                <div className={styles.tagList}>
                  {item.tagMetas.map((meta) => (
                    <span key={`${item.span.id}-${meta.tag.id}`} className={styles.tagChip}>
                      {meta.cluster ? `${meta.cluster.name} › ` : ""}
                      {meta.category ? `${meta.category.name} › ` : ""}
                      {meta.tag.name}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};
