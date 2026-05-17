import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { useAnalysisData } from "./AnalysisData";
import { useAnalysisHierarchyFilters } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
import styles from "./EvidenceBrowserView.module.css";

export const EvidenceBrowserContent = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { codebook, interviews, evidenceItems, loading, error } = useAnalysisData();

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
    items: evidenceItems,
    clusterFilter: search.clusterId ?? null,
    setClusterFilter: (value) => setSearchFilters({ clusterId: value, categoryId: undefined, tagId: undefined }),
    categoryFilter: search.categoryId ?? null,
    setCategoryFilter: (value) => setSearchFilters({ categoryId: value, tagId: undefined }),
    tagFilter: search.tagId ?? null,
    setTagFilter: (value) => setSearchFilters({ tagId: value }),
    interviewFilter: search.interviewId ?? null,
    setInterviewFilter: (value) => setSearchFilters({ interviewId: value }),
  });

  const totalTaggedQuotes = evidenceItems.length;
  const visibleEvidence = useMemo(() => visibleItems, [visibleItems]);
  const categorySelectDisabled = filteredCategoryOptions.length === 0;
  const tagSelectDisabled = filteredTagOptions.length === 0;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
    const cluster = codebook?.clusters.find((item) => item.id === clusterFilter);
    if (cluster) {
      chips.push({
        key: `cluster-${cluster.id}`,
        label: `${t("analysis.evidence.cluster", { defaultValue: "Cluster" })}: ${cluster.name}`,
        onClear: () => setSearchFilters({ clusterId: undefined, categoryId: undefined, tagId: undefined }),
      });
    }
    const categoryOption = filteredCategoryOptions.find(({ category }) => category.id === categoryFilter);
    if (categoryOption) {
      chips.push({
        key: `category-${categoryOption.category.id}`,
        label: `${t("analysis.evidence.category", { defaultValue: "Category" })}: ${categoryOption.category.name}`,
        onClear: () => setSearchFilters({ categoryId: undefined, tagId: undefined }),
      });
    }
    const tagOption = filteredTagOptions.find((meta) => meta.tag.id === tagFilter);
    if (tagOption) {
      chips.push({
        key: `tag-${tagOption.tag.id}`,
        label: `${t("analysis.evidence.tag", { defaultValue: "Tag" })}: ${tagOption.tag.name}`,
        onClear: () => setSearchFilters({ tagId: undefined }),
      });
    }
    const interview = interviewOptions.find((item) => item.id === interviewFilter);
    if (interview) {
      chips.push({
        key: `interview-${interview.id}`,
        label: `${t("analysis.evidence.interview", { defaultValue: "Interview" })}: ${interview.name}`,
        onClear: () => setSearchFilters({ interviewId: undefined }),
      });
    }
    return chips;
  }, [clusterFilter, codebook?.clusters, categoryFilter, filteredCategoryOptions, tagFilter, filteredTagOptions, interviewFilter, interviewOptions, t]);

  const categoryPlaceholder = categorySelectDisabled
    ? clusterFilter !== null
      ? t("analysis.evidence.noCategoriesInCluster", { defaultValue: "No categories in current cluster" })
      : t("analysis.evidence.noCategoriesInScope", { defaultValue: "No categories in current scope" })
    : t("analysis.evidence.allCategories", { defaultValue: "All categories" });

  const tagPlaceholder = tagSelectDisabled
    ? categoryFilter !== null
      ? t("analysis.evidence.noTagsInCategory", { defaultValue: "No tags in current category" })
      : clusterFilter !== null
        ? t("analysis.evidence.noTagsInCluster", { defaultValue: "No tags in current cluster" })
        : t("analysis.evidence.noTagsInScope", { defaultValue: "No tags in current scope" })
    : t("analysis.evidence.allTags", { defaultValue: "All tags" });

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {t("analysis.evidence.title", { defaultValue: "Evidence browser" })}
          </h1>
          <p className={styles.subtitle}>
            {t("analysis.evidence.subtitle", {
              defaultValue:
                "Browse coded quotes across the project and narrow them by the current codebook structure.",
            })}
          </p>
        </div>
        <div className={styles.summaryCard}>
          <strong>{visibleEvidence.length}</strong>
          <span>
            {t("analysis.evidence.resultsSummary", {
              shown: visibleEvidence.length,
              total: totalTaggedQuotes,
              defaultValue: "{{shown}} of {{total}} coded quotes",
            })}
          </span>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => undefined} /> : null}

      <section className={styles.filtersCard}>
        <div className={styles.filtersHeader}>
          <h2 className={styles.sectionTitle}>
            {t("analysis.evidence.filters", { defaultValue: "Filters" })}
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
            {t("analysis.evidence.clearFilters", { defaultValue: "Clear filters" })}
          </Button>
        </div>

        <div className={styles.filtersGrid}>
          <label className={styles.filterField}>
            <span>{t("analysis.evidence.cluster", { defaultValue: "Cluster" })}</span>
            <select
              value={clusterFilter ?? ""}
              onChange={(event) => setClusterFilter(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("analysis.evidence.allClusters", { defaultValue: "All clusters" })}</option>
              {codebook?.clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span>{t("analysis.evidence.category", { defaultValue: "Category" })}</span>
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
            <span>{t("analysis.evidence.tag", { defaultValue: "Tag" })}</span>
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
            <span>{t("analysis.evidence.interview", { defaultValue: "Interview" })}</span>
            <select
              value={interviewFilter ?? ""}
              onChange={(event) => setInterviewFilter(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("analysis.evidence.allInterviews", { defaultValue: "All interviews" })}</option>
              {interviewOptions.map((interview) => (
                <option key={interview.id} value={interview.id}>
                  {interview.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ActiveFilterChips items={activeFilterChips} />
      </section>

      <section className={styles.resultsCard}>
        {loading ? (
          <p className={styles.empty}>
            {t("analysis.evidence.loading", { defaultValue: "Loading coded evidence…" })}
          </p>
        ) : visibleEvidence.length === 0 ? (
          <p className={styles.empty}>
            {totalTaggedQuotes === 0
              ? t("analysis.evidence.emptyProject", {
                  defaultValue: "No coded quotes yet. Tag some transcript spans to browse evidence here.",
                })
              : t("analysis.evidence.emptyFiltered", {
                  defaultValue: "No coded quotes match the current filters.",
                })}
          </p>
        ) : (
          <ul className={styles.resultsList}>
            {visibleEvidence.map((item) => (
              <li key={item.span.id} className={styles.resultCard}>
                <div className={styles.resultMeta}>
                  <span className={styles.interviewName}>{item.interview.name}</span>
                  <span className={styles.metaDivider}>•</span>
                  <span>
                    {t("analysis.evidence.segmentRef", {
                      segmentId: item.span.segmentId,
                      defaultValue: "Segment {{segmentId}}",
                    })}
                  </span>
                  {item.span.memo?.trim() ? (
                    <>
                      <span className={styles.metaDivider}>•</span>
                      <span>{t("analysis.evidence.hasMemo", { defaultValue: "Has memo" })}</span>
                    </>
                  ) : null}
                </div>
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
                {item.span.memo?.trim() ? <p className={styles.memo}>{item.span.memo.trim()}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};
