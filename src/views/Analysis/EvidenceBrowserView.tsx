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
import styles from "./EvidenceBrowserView.module.css";

type EvidenceItem = {
  span: SpanDTO;
  interview: Interview;
  tagMetas: TagMeta[];
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

export const EvidenceBrowserContent = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const [project, setProject] = useAtom(currentProjectAtom);
  const setCodebook = useSetAtom(codebookTreeAtom);
  const setInterviews = useSetAtom(interviewListAtom);

  const [codebook, setCodebookLocal] = useState<CodebookTree | null>(null);
  const [interviewsLocal, setInterviewsLocal] = useState<Interview[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
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
        const nextEvidence = spanGroups.flatMap(({ interview, spans }) =>
          spans
            .map((span) => ({
              span,
              interview,
              tagMetas: span.tags
                .map((tagRef) => tagMetaById.get(tagRef.tagId))
                .filter((meta): meta is TagMeta => meta !== undefined),
            }))
            .filter((item) => item.tagMetas.length > 0),
        );

        setCodebook(nextCodebook);
        setCodebookLocal(nextCodebook);
        setInterviews(nextInterviews);
        setInterviewsLocal(nextInterviews);
        setEvidence(nextEvidence);
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
    const allTags = evidence.flatMap((item) => item.tagMetas);
    const unique = new Map<number, TagMeta>();
    for (const meta of allTags) {
      if (!hasCluster(meta, clusterFilter)) continue;
      if (!hasCategory(meta, categoryFilter)) continue;
      if (!unique.has(meta.tag.id)) unique.set(meta.tag.id, meta);
    }
    return Array.from(unique.values()).sort((a, b) => compareByName(a.tag, b.tag));
  }, [categoryFilter, clusterFilter, evidence]);

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

  const visibleEvidence = useMemo(() => {
    return evidence.filter((item) => {
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
  }, [categoryFilter, clusterFilter, evidence, interviewFilter, tagFilter]);

  const interviewOptions = useMemo(
    () => [...interviewsLocal].sort(compareByName),
    [interviewsLocal],
  );

  const totalTaggedQuotes = evidence.length;

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

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <section className={styles.filtersCard}>
          <div className={styles.filtersHeader}>
            <h2 className={styles.sectionTitle}>
              {t("analysis.evidence.filters", { defaultValue: "Filters" })}
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
              >
                <option value="">{t("analysis.evidence.allCategories", { defaultValue: "All categories" })}</option>
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
              >
                <option value="">{t("analysis.evidence.allTags", { defaultValue: "All tags" })}</option>
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
                        id: item.span.segmentId,
                        defaultValue: "Segment {{id}}",
                      })}
                    </span>
                    {item.span.memo ? (
                      <>
                        <span className={styles.metaDivider}>•</span>
                        <span>{t("analysis.evidence.hasMemo", { defaultValue: "Memo attached" })}</span>
                      </>
                    ) : null}
                  </div>

                  <blockquote className={styles.quote}>
                    “{item.span.textSnapshot}”
                  </blockquote>

                  <div className={styles.tagList}>
                    {item.tagMetas.map((meta) => (
                      <div
                        key={`${item.span.id}-${meta.tag.id}`}
                        className={styles.tagChip}
                        style={{
                          borderColor: meta.effectiveColor ?? "var(--border)",
                          backgroundColor: meta.effectiveColor ? `${meta.effectiveColor}22` : "var(--bg-muted)",
                        }}
                      >
                        <strong>{meta.tag.name}</strong>
                        <span className={styles.tagPath}>
                          {meta.cluster?.name ?? t("analysis.evidence.noCluster", { defaultValue: "No cluster" })}
                          {" › "}
                          {meta.category?.name ?? t("analysis.evidence.noCategory", { defaultValue: "No category" })}
                        </span>
                      </div>
                    ))}
                  </div>

                  {item.span.memo ? <p className={styles.memo}>{item.span.memo}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
    </>
  );
};

export const EvidenceBrowserView = () => <EvidenceBrowserContent />;
