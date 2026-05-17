import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useAnalysisData, type MemoItem } from "./AnalysisData";
import { useAnalysisHierarchyFilters } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
import styles from "./MemoLayerView.module.css";

type MemoGroupBy = "none" | "interview" | "theme" | "density";
type MemoSortBy = "project" | "interview" | "theme" | "density";

type MemoGroup = {
  key: string;
  label: string;
  items: MemoItem[];
};

const firstThemeLabel = (item: MemoItem) => {
  const labels = Array.from(
    new Set(
      item.tagMetas.map((meta) => [meta.cluster?.name, meta.category?.name, meta.tag.name].filter(Boolean).join(" › ")),
    ),
  );
  if (labels.length === 0) return "Other";
  return labels.slice(0, 2).join(" • ");
};

const densityLabel = (item: MemoItem, t: ReturnType<typeof useTranslation>["t"]) => {
  const count = new Set(item.tagMetas.map((meta) => meta.tag.id)).size;
  if (count >= 4) return t("analysis.memos.groupDensityHigh", { defaultValue: "Dense coding (4+)" });
  if (count >= 2) return t("analysis.memos.groupDensityMedium", { defaultValue: "Multi-coded (2-3)" });
  return t("analysis.memos.groupDensityLow", { defaultValue: "Single tag" });
};

export const MemoLayerView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { codebook, interviews, memoItems, loading, error } = useAnalysisData();
  const [groupBy, setGroupBy] = useState<MemoGroupBy>("interview");
  const [sortBy, setSortBy] = useState<MemoSortBy>("project");

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
    items: memoItems,
    search,
  });

  const visibleMemos = useMemo(() => {
    const items = [...visibleItems];
    items.sort((left, right) => {
      if (sortBy === "theme") {
        const themeCompare = firstThemeLabel(left).localeCompare(firstThemeLabel(right), undefined, { sensitivity: "base" });
        if (themeCompare !== 0) return themeCompare;
      }
      if (sortBy === "density") {
        const densityCompare = new Set(right.tagMetas.map((meta) => meta.tag.id)).size - new Set(left.tagMetas.map((meta) => meta.tag.id)).size;
        if (densityCompare !== 0) return densityCompare;
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

  const groupedMemos = useMemo<MemoGroup[]>(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: t("analysis.memos.groupAll", { defaultValue: "All memos" }), items: visibleMemos }];
    }

    const groups = new Map<string, MemoGroup>();
    for (const item of visibleMemos) {
      const label =
        groupBy === "interview"
          ? item.interview.name
          : groupBy === "theme"
            ? firstThemeLabel(item)
            : densityLabel(item, t);
      const key = `${groupBy}:${label}`;
      const group = groups.get(key) ?? { key, label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [groupBy, t, visibleMemos]);

  const categorySelectDisabled = filteredCategoryOptions.length === 0;
  const tagSelectDisabled = filteredTagOptions.length === 0;

  const categoryPlaceholder = categorySelectDisabled
    ? search.clusterId !== undefined
      ? t("analysis.memos.noCategoriesInCluster", { defaultValue: "No categories in current cluster" })
      : t("analysis.memos.noCategoriesInScope", { defaultValue: "No categories in current scope" })
    : t("analysis.memos.allCategories", { defaultValue: "All categories" });

  const tagPlaceholder = tagSelectDisabled
    ? search.categoryId !== undefined
      ? t("analysis.memos.noTagsInCategory", { defaultValue: "No tags in current category" })
      : search.clusterId !== undefined
        ? t("analysis.memos.noTagsInCluster", { defaultValue: "No tags in current cluster" })
        : t("analysis.memos.noTagsInScope", { defaultValue: "No tags in current scope" })
    : t("analysis.memos.allTags", { defaultValue: "All tags" });

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
          <div className={styles.filtersActions}>
            <label className={styles.compactField}>
              <span>{t("analysis.memos.groupBy", { defaultValue: "Group by" })}</span>
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as MemoGroupBy)}>
                <option value="none">{t("analysis.memos.groupByNone", { defaultValue: "No grouping" })}</option>
                <option value="interview">{t("analysis.memos.groupByInterview", { defaultValue: "Interview" })}</option>
                <option value="theme">{t("analysis.memos.groupByTheme", { defaultValue: "Theme" })}</option>
                <option value="density">{t("analysis.memos.groupByDensity", { defaultValue: "Memo density" })}</option>
              </select>
            </label>
            <label className={styles.compactField}>
              <span>{t("analysis.memos.sortBy", { defaultValue: "Sort by" })}</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as MemoSortBy)}>
                <option value="project">{t("analysis.memos.sortProject", { defaultValue: "Project order" })}</option>
                <option value="interview">{t("analysis.memos.sortInterview", { defaultValue: "Interview" })}</option>
                <option value="theme">{t("analysis.memos.sortTheme", { defaultValue: "Theme" })}</option>
                <option value="density">{t("analysis.memos.sortDensity", { defaultValue: "Memo density" })}</option>
              </select>
            </label>
            <Button onClick={clearAllFilters} disabled={Object.keys(search).length === 0}>
              {t("analysis.memos.clearFilters", { defaultValue: "Clear filters" })}
            </Button>
          </div>
        </div>

        <div className={styles.filtersGrid}>
          <label className={styles.filterField}>
            <span>{t("analysis.memos.cluster", { defaultValue: "Cluster" })}</span>
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
              value={search.categoryId ?? ""}
              onChange={(event) => setSearchFilters({ categoryId: event.target.value ? Number(event.target.value) : undefined, tagId: undefined })}
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
            <span>{t("analysis.memos.interview", { defaultValue: "Interview" })}</span>
            <select
              value={search.interviewId ?? ""}
              onChange={(event) => setSearchFilters({ interviewId: event.target.value ? Number(event.target.value) : undefined })}
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
          <div className={styles.groupList}>
            {groupedMemos.map((group) => (
              <section key={group.key} className={styles.groupSection}>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupTitle}>{group.label}</h3>
                  <span className={styles.groupCount}>{group.items.length}</span>
                </div>
                <ul className={styles.resultsList}>
                  {group.items.map((item) => (
                    <li key={item.span.id} className={styles.memoCard}>
                      <div className={styles.memoMeta}>
                        <span className={styles.interviewName}>{item.interview.name}</span>
                        <span className={styles.metaDivider}>•</span>
                        <span>{item.participant.name}</span>
                        <span className={styles.metaDivider}>•</span>
                        <span>
                          {t("analysis.memos.segmentRef", {
                            id: item.span.segmentId,
                            defaultValue: "Segment {{id}}",
                          })}
                        </span>
                      </div>
                      <div className={styles.memoBody}>
                        <h4 className={styles.memoTitle}>{t("analysis.memos.memoLabel", { defaultValue: "Memo" })}</h4>
                        <p className={styles.memoText}>{item.memo}</p>
                      </div>
                      <blockquote className={styles.quote}>{item.span.textSnapshot}</blockquote>
                      <div className={styles.tagList}>
                        {item.tagMetas.map((meta) => (
                          <div key={`${item.span.id}-${meta.tag.id}`} className={styles.tagChipWrap}>
                            <span className={styles.tagChip}>{meta.tag.name}</span>
                            <span className={styles.tagContext}>
                              {meta.cluster ? `${meta.cluster.name} › ` : ""}
                              {meta.category ? `${meta.category.name} › ` : ""}
                              {densityLabel(item, t)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </>
  );
};
