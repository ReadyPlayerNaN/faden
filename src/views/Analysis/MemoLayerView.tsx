import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  buildTagMetaMap,
  codebookTree as fetchCodebookTree,
  type CategoryNode,
  type ClusterNode,
  type CodebookTree,
  type TagMeta,
} from "../../ipc/codebook";
import { interviewList as fetchInterviews, type Interview } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { spanListForInterview, type SpanDTO } from "../../ipc/tagging";
import { codebookTreeAtom } from "../../state/codebook";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import styles from "./MemoLayerView.module.css";

type MemoItem = {
  span: SpanDTO;
  interview: Interview;
  tagMetas: TagMeta[];
  memo: string;
};

type CategoryOption = {
  category: CategoryNode;
  cluster: ClusterNode | null;
};

const compareByName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

const hasCluster = (meta: TagMeta, clusterId: number | null) => {
  if (clusterId === null) return true;
  return meta.cluster?.id === clusterId;
};

const hasCategory = (meta: TagMeta, categoryId: number | null) => {
  if (categoryId === null) return true;
  return meta.category?.id === categoryId;
};

const nonEmptyMemo = (memo: string | null | undefined) => memo?.trim() ?? "";

export const MemoLayerView = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const [project, setProject] = useAtom(currentProjectAtom);
  const setCodebook = useSetAtom(codebookTreeAtom);
  const setInterviews = useSetAtom(interviewListAtom);

  const [codebook, setCodebookLocal] = useState<CodebookTree | null>(null);
  const [interviewsLocal, setInterviewsLocal] = useState<Interview[]>([]);
  const [memos, setMemos] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [interviewFilter, setInterviewFilter] = useState<number | null>(null);

  useEffect(() => {
    if (!project || project.path !== decodedProjectPath) {
      void projectOpen(decodedProjectPath)
        .then(setProject)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }
  }, [decodedProjectPath, project, setProject]);

  useEffect(() => {
    if (!project || project.path !== decodedProjectPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void Promise.all([fetchCodebookTree(), fetchInterviews()])
      .then(async ([nextCodebook, nextInterviews]) => {
        const spanGroups = await Promise.all(
          nextInterviews.map(async (interview) => ({
            interview,
            spans: await spanListForInterview(interview.id),
          })),
        );
        if (cancelled) return;

        const tagMetaById = buildTagMetaMap(nextCodebook);
        const nextMemos = spanGroups.flatMap(({ interview, spans }) =>
          spans
            .map((span) => {
              const memo = nonEmptyMemo(span.memo);
              return {
                span,
                interview,
                memo,
                tagMetas: span.tags
                  .map((tagRef) => tagMetaById.get(tagRef.tagId))
                  .filter((meta): meta is TagMeta => meta !== undefined),
              };
            })
            .filter((item) => item.memo.length > 0 && item.tagMetas.length > 0),
        );

        setCodebook(nextCodebook);
        setCodebookLocal(nextCodebook);
        setInterviews(nextInterviews);
        setInterviewsLocal(nextInterviews);
        setMemos(nextMemos);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [decodedProjectPath, project, setCodebook, setInterviews]);

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    if (!codebook) return [];
    return [
      ...codebook.standaloneCategories.map((category) => ({ category, cluster: null })),
      ...codebook.clusters.flatMap((cluster) =>
        cluster.categories.map((category) => ({ category, cluster })),
      ),
    ].sort((a, b) => compareByName(a.category, b.category));
  }, [codebook]);

  const filteredCategoryOptions = useMemo(
    () => categoryOptions.filter(({ cluster }) => clusterFilter === null || cluster?.id === clusterFilter),
    [categoryOptions, clusterFilter],
  );

  const filteredTagOptions = useMemo(() => {
    const unique = new Map<number, TagMeta>();
    for (const item of memos) {
      for (const meta of item.tagMetas) {
        if (!hasCluster(meta, clusterFilter)) continue;
        if (!hasCategory(meta, categoryFilter)) continue;
        if (!unique.has(meta.tag.id)) unique.set(meta.tag.id, meta);
      }
    }
    return Array.from(unique.values()).sort((a, b) => compareByName(a.tag, b.tag));
  }, [categoryFilter, clusterFilter, memos]);

  useEffect(() => {
    if (categoryFilter !== null && !filteredCategoryOptions.some(({ category }) => category.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  }, [categoryFilter, filteredCategoryOptions]);

  useEffect(() => {
    if (tagFilter !== null && !filteredTagOptions.some((meta) => meta.tag.id === tagFilter)) {
      setTagFilter(null);
    }
  }, [tagFilter, filteredTagOptions]);

  const visibleMemos = useMemo(() => {
    return memos.filter((item) => {
      if (interviewFilter !== null && item.interview.id !== interviewFilter) return false;
      if (tagFilter !== null) {
        return item.tagMetas.some((meta) => meta.tag.id === tagFilter);
      }
      if (categoryFilter !== null) {
        return item.tagMetas.some((meta) => meta.category?.id === categoryFilter);
      }
      if (clusterFilter !== null) {
        return item.tagMetas.some((meta) => meta.cluster?.id === clusterFilter);
      }
      return true;
    });
  }, [categoryFilter, clusterFilter, interviewFilter, memos, tagFilter]);

  const interviewOptions = useMemo(() => [...interviewsLocal].sort(compareByName), [interviewsLocal]);

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
              total: memos.length,
              defaultValue: "{{shown}} of {{total}} memos",
            })}
          </span>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <section className={styles.filtersCard}>
        <div className={styles.filtersHeader}>
          <h2 className={styles.sectionTitle}>
            {t("analysis.memos.filters", { defaultValue: "Filters" })}
          </h2>
          <Button
            onClick={() => {
              setClusterFilter(null);
              setCategoryFilter(null);
              setTagFilter(null);
              setInterviewFilter(null);
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
            >
              <option value="">{t("analysis.memos.allCategories", { defaultValue: "All categories" })}</option>
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
            >
              <option value="">{t("analysis.memos.allTags", { defaultValue: "All tags" })}</option>
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
            {memos.length === 0
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
                <div className={styles.memoMeta}>
                  <span className={styles.interviewName}>{item.interview.name}</span>
                  <span className={styles.metaDivider}>•</span>
                  <span>
                    {t("analysis.memos.segmentRef", {
                      id: item.span.segmentId,
                      defaultValue: "Segment {{id}}",
                    })}
                  </span>
                </div>

                <div className={styles.memoBody}>
                  <h2 className={styles.memoTitle}>
                    {t("analysis.memos.memoLabel", { defaultValue: "Memo" })}
                  </h2>
                  <p className={styles.memoText}>{item.memo}</p>
                </div>

                <blockquote className={styles.quote}>
                  “{item.span.textSnapshot}”
                </blockquote>

                <div className={styles.tagList}>
                  {item.tagMetas.map((meta) => (
                    <div key={`${item.span.id}-${meta.tag.id}`} className={styles.tagChipWrap}>
                      <span className={styles.tagChip}>{meta.tag.name}</span>
                      <span className={styles.tagContext}>
                        {meta.cluster?.name ?? t("analysis.memos.noCluster", { defaultValue: "No cluster" })}
                        {" › "}
                        {meta.category?.name ?? t("analysis.memos.noCategory", { defaultValue: "No category" })}
                      </span>
                    </div>
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
