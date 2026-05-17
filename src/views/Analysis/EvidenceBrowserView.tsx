import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useAnalysisData } from "./AnalysisData";
import { useAnalysisHierarchyFilters } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
import styles from "./EvidenceBrowserView.module.css";

type EvidenceSort = "project" | "interview" | "memo" | "theme";

const WORKSPACE_HANDOFF_KEY = "faden.workspace.open-span";

export const EvidenceBrowserContent = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { codebook, interviews, evidenceItems, loading, error } = useAnalysisData();
  const [sortBy, setSortBy] = useState<EvidenceSort>("project");

  const setSearchFilters = (patch: Partial<Record<keyof AnalysisSearch, number | string | boolean | null | undefined>>) => {
    void navigate({
      search: mergeAnalysisSearch(search, patch) as never,
      replace: true,
    });
  };

  const {
    filteredCategoryOptions,
    filteredTagOptions,
    interviewOptions,
    visibleItems,
  } = useAnalysisHierarchyFilters({
    codebookClusters: codebook?.clusters ?? [],
    standaloneCategories: codebook?.standaloneCategories ?? [],
    interviews,
    items: evidenceItems,
    search,
  });

  const categorySelectDisabled = filteredCategoryOptions.length === 0;
  const tagSelectDisabled = filteredTagOptions.length === 0;

  const visibleEvidence = useMemo(() => {
    const items = [...visibleItems];
    items.sort((left, right) => {
      if (sortBy === "memo") {
        const memoCompare = Number(Boolean(right.memo)) - Number(Boolean(left.memo));
        if (memoCompare !== 0) return memoCompare;
      }
      if (sortBy === "theme") {
        const leftTheme = left.tagMetas[0]?.tag.name ?? "";
        const rightTheme = right.tagMetas[0]?.tag.name ?? "";
        const themeCompare = leftTheme.localeCompare(rightTheme, undefined, { sensitivity: "base" });
        if (themeCompare !== 0) return themeCompare;
      }
      if (sortBy === "interview") {
        const interviewCompare = left.interview.name.localeCompare(right.interview.name, undefined, { sensitivity: "base" });
        if (interviewCompare !== 0) return interviewCompare;
      }
      return (
        left.interview.name.localeCompare(right.interview.name, undefined, { sensitivity: "base" }) ||
        left.span.segmentId - right.span.segmentId ||
        left.span.startOffset - right.span.startOffset
      );
    });
    return items;
  }, [sortBy, visibleItems]);

  const categoryPlaceholder = categorySelectDisabled
    ? search.clusterId !== undefined
      ? t("analysis.evidence.noCategoriesInCluster", { defaultValue: "No categories in current cluster" })
      : t("analysis.evidence.noCategoriesInScope", { defaultValue: "No categories in current scope" })
    : t("analysis.evidence.allCategories", { defaultValue: "All categories" });

  const tagPlaceholder = tagSelectDisabled
    ? search.categoryId !== undefined
      ? t("analysis.evidence.noTagsInCategory", { defaultValue: "No tags in current category" })
      : search.clusterId !== undefined
        ? t("analysis.evidence.noTagsInCluster", { defaultValue: "No tags in current cluster" })
        : t("analysis.evidence.noTagsInScope", { defaultValue: "No tags in current scope" })
    : t("analysis.evidence.allTags", { defaultValue: "All tags" });

  const matchedTagIds = useMemo(() => {
    const ids = new Set<number>();
    if (search.tagId !== undefined) ids.add(search.tagId);
    if (search.pairTagAId !== undefined) ids.add(search.pairTagAId);
    if (search.pairTagBId !== undefined) ids.add(search.pairTagBId);
    return ids;
  }, [search.pairTagAId, search.pairTagBId, search.tagId]);

  const clearAllFilters = () => {
    setSearchFilters({
      clusterId: undefined,
      categoryId: undefined,
      tagId: undefined,
      interviewId: undefined,
      participantKey: undefined,
      memoOnly: undefined,
      pairTagAId: undefined,
      pairTagBId: undefined,
    });
  };

  const openInCodingView = (item: (typeof visibleEvidence)[number]) => {
    window.localStorage.setItem(
      WORKSPACE_HANDOFF_KEY,
      JSON.stringify({
        projectPath: decodeURIComponent(projectPath),
        interviewId: item.interview.id,
        spanId: item.span.id,
        savedAt: Date.now(),
      }),
    );
    void navigate({
      to: "/workspace/$projectPath",
      params: { projectPath },
    });
  };

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
              total: evidenceItems.length,
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
          <div className={styles.filtersActions}>
            <label className={styles.sortField}>
              <span>{t("analysis.evidence.sortBy", { defaultValue: "Sort by" })}</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as EvidenceSort)}>
                <option value="project">{t("analysis.evidence.sortProject", { defaultValue: "Project order" })}</option>
                <option value="interview">{t("analysis.evidence.sortInterview", { defaultValue: "Interview" })}</option>
                <option value="memo">{t("analysis.evidence.sortMemo", { defaultValue: "Memo first" })}</option>
                <option value="theme">{t("analysis.evidence.sortTheme", { defaultValue: "Theme" })}</option>
              </select>
            </label>
            <Button
              onClick={() => setSearchFilters({ memoOnly: search.memoOnly ? undefined : true })}
            >
              {search.memoOnly
                ? t("analysis.evidence.showAllEvidence", { defaultValue: "Show all evidence" })
                : t("analysis.evidence.onlyMemoBacked", { defaultValue: "Only memo-backed" })}
            </Button>
            <Button onClick={clearAllFilters} disabled={Object.keys(search).length === 0}>
              {t("analysis.evidence.clearFilters", { defaultValue: "Clear filters" })}
            </Button>
          </div>
        </div>

        <div className={styles.filtersGrid}>
          <label className={styles.filterField}>
            <span>{t("analysis.evidence.cluster", { defaultValue: "Cluster" })}</span>
            <select
              value={search.clusterId ?? ""}
              onChange={(event) =>
                setSearchFilters({
                  clusterId: event.target.value ? Number(event.target.value) : undefined,
                  categoryId: undefined,
                  tagId: undefined,
                })
              }
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
              value={search.categoryId ?? ""}
              onChange={(event) =>
                setSearchFilters({
                  categoryId: event.target.value ? Number(event.target.value) : undefined,
                  tagId: undefined,
                })
              }
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
              value={search.tagId ?? ""}
              onChange={(event) => setSearchFilters({ tagId: event.target.value ? Number(event.target.value) : undefined })}
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
              value={search.interviewId ?? ""}
              onChange={(event) => setSearchFilters({ interviewId: event.target.value ? Number(event.target.value) : undefined })}
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
      </section>

      <section className={styles.resultsCard}>
        {loading ? (
          <p className={styles.empty}>
            {t("analysis.evidence.loading", { defaultValue: "Loading coded evidence…" })}
          </p>
        ) : visibleEvidence.length === 0 ? (
          <p className={styles.empty}>
            {evidenceItems.length === 0
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
                      id: item.span.segmentId,
                      defaultValue: "Segment {{id}}",
                    })}
                  </span>
                  <span className={styles.metaDivider}>•</span>
                  <span>{item.participant.name}</span>
                  {item.memo ? (
                    <>
                      <span className={styles.metaDivider}>•</span>
                      <span>{t("analysis.evidence.hasMemo", { defaultValue: "Has memo" })}</span>
                    </>
                  ) : null}
                </div>
                <blockquote className={styles.quote}>{item.span.textSnapshot}</blockquote>
                <div className={styles.tagList}>
                  {item.tagMetas.map((meta) => {
                    const matched = matchedTagIds.has(meta.tag.id);
                    const inScope =
                      matched ||
                      meta.cluster?.id === search.clusterId ||
                      meta.category?.id === search.categoryId;
                    return (
                      <span
                        key={`${item.span.id}-${meta.tag.id}`}
                        className={`${styles.tagChip} ${inScope ? styles.tagChipMatch : ""}`.trim()}
                      >
                        <span className={styles.tagPath}>
                          {meta.cluster ? `${meta.cluster.name} › ` : ""}
                          {meta.category ? `${meta.category.name} › ` : ""}
                        </span>
                        <span>{meta.tag.name}</span>
                      </span>
                    );
                  })}
                </div>
                {item.memo ? <p className={styles.memo}>{item.memo}</p> : null}
                <div className={styles.cardActions}>
                  <Button onClick={() => openInCodingView(item)}>
                    {t("analysis.evidence.openInCodingView", { defaultValue: "Open in coding view" })}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};
