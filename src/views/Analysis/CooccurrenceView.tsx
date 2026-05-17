import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { useParams } from "@tanstack/react-router";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  buildTagMetaMap,
  codebookTree as fetchCodebookTree,
  type TagMeta,
} from "../../ipc/codebook";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { spanListForInterview } from "../../ipc/tagging";
import { codebookTreeAtom } from "../../state/codebook";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import styles from "./CooccurrenceView.module.css";

type PairRow = {
  key: string;
  tagA: TagMeta;
  tagB: TagMeta;
  count: number;
};

const compareTagNames = (a: TagMeta, b: TagMeta) =>
  a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: "base" });

const tagContext = (meta: TagMeta, t: ReturnType<typeof useTranslation>["t"]) => {
  const clusterName = meta.cluster?.name ?? t("analysis.evidence.noCluster", { defaultValue: "No cluster" });
  const categoryName = meta.category?.name ?? t("analysis.evidence.noCategory", { defaultValue: "No category" });
  return `${clusterName} › ${categoryName}`;
};

export const CooccurrenceView = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const [project, setProject] = useAtom(currentProjectAtom);
  const setCodebook = useSetAtom(codebookTreeAtom);
  const setInterviews = useSetAtom(interviewListAtom);
  const [rows, setRows] = useState<PairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const tagMetaById = buildTagMetaMap(nextCodebook);
        const spanGroups = await Promise.all(
          nextInterviews.map(async (interview) => spanListForInterview(interview.id)),
        );
        if (cancelled) return;

        const pairCounts = new Map<string, number>();
        for (const spans of spanGroups) {
          for (const span of spans) {
            const uniqueTags = Array.from(new Set(span.tags.map((tagRef) => tagRef.tagId)))
              .map((tagId) => tagMetaById.get(tagId))
              .filter((meta): meta is TagMeta => meta !== undefined)
              .sort(compareTagNames);
            if (uniqueTags.length < 2) continue;
            for (let i = 0; i < uniqueTags.length - 1; i += 1) {
              for (let j = i + 1; j < uniqueTags.length; j += 1) {
                const key = `${uniqueTags[i].tag.id}:${uniqueTags[j].tag.id}`;
                pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
              }
            }
          }
        }

        const nextRows = Array.from(pairCounts.entries())
          .map(([key, count]) => {
            const [firstId, secondId] = key.split(":").map(Number);
            const tagA = tagMetaById.get(firstId);
            const tagB = tagMetaById.get(secondId);
            if (!tagA || !tagB) return null;
            return { key, tagA, tagB, count } satisfies PairRow;
          })
          .filter((row): row is PairRow => row !== null)
          .sort((a, b) => b.count - a.count || compareTagNames(a.tagA, b.tagA) || compareTagNames(a.tagB, b.tagB));

        setCodebook(nextCodebook);
        setInterviews(nextInterviews);
        setRows(nextRows);
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

  const summary = useMemo(() => {
    const totalPairs = rows.length;
    const strongest = rows[0]?.count ?? 0;
    return { totalPairs, strongest };
  }, [rows]);

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {t("analysis.cooccurrence.title", { defaultValue: "Co-occurrence" })}
          </h1>
          <p className={styles.subtitle}>
            {t("analysis.cooccurrence.subtitle", {
              defaultValue:
                "See which tag pairs most often appear together on the same coded span. Counts are unordered and each pair is counted once per span.",
            })}
          </p>
        </div>
        <div className={styles.summaryCard}>
          <strong>{summary.totalPairs}</strong>
          <span>
            {t("analysis.cooccurrence.summary", {
              total: summary.totalPairs,
              strongest: summary.strongest,
              defaultValue: "{{total}} pairs · top count {{strongest}}",
            })}
          </span>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <section className={styles.explainerCard}>
        <p className={styles.explainerText}>
          {t("analysis.cooccurrence.readOnlyHint", {
            defaultValue:
              "This view is read-only. Use transcript coding and Labels to change the underlying structure, then return here to inspect relationships.",
          })}
        </p>
      </section>

      <section className={styles.tableCard}>
        {loading ? (
          <p className={styles.empty}>{t("analysis.cooccurrence.loading", { defaultValue: "Loading co-occurrence…" })}</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty}>
            {t("analysis.cooccurrence.empty", {
              defaultValue:
                "No co-occurring tag pairs yet. Apply at least two tags to the same coded span to populate this view.",
            })}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.rankCell}>{t("analysis.cooccurrence.rank", { defaultValue: "#" })}</th>
                  <th>{t("analysis.cooccurrence.tagA", { defaultValue: "Tag A" })}</th>
                  <th>{t("analysis.cooccurrence.tagB", { defaultValue: "Tag B" })}</th>
                  <th className={styles.countCell}>{t("analysis.cooccurrence.count", { defaultValue: "Count" })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key}>
                    <td className={styles.rankCell}>{index + 1}</td>
                    <td>
                      <div className={styles.tagName}>{row.tagA.tag.name}</div>
                      <div className={styles.context}>{tagContext(row.tagA, t)}</div>
                    </td>
                    <td>
                      <div className={styles.tagName}>{row.tagB.tag.name}</div>
                      <div className={styles.context}>{tagContext(row.tagB, t)}</div>
                    </td>
                    <td className={styles.countCell}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};
