import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ErrorBanner } from "../../components/ErrorBanner";
import type { TagMeta } from "../../ipc/codebook";
import { useAnalysisData } from "./AnalysisData";
import { filterAnalysisItems } from "./analysisFilters";
import { mergeAnalysisSearch, type AnalysisSearch } from "./analysisSearch";
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
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const search = useSearch({ strict: false }) as AnalysisSearch;
  const { evidenceItems, loading, error } = useAnalysisData();

  const baseItems = useMemo(
    () => filterAnalysisItems(evidenceItems, search, { ignorePair: true }),
    [evidenceItems, search],
  );

  const rows = useMemo<PairRow[]>(() => {
    const pairCounts = new Map<string, number>();
    const tagMetaById = new Map<number, TagMeta>();

    for (const item of baseItems) {
      item.tagMetas.forEach((meta) => tagMetaById.set(meta.tag.id, meta));
      const uniqueTags = Array.from(new Set(item.tagMetas.map((meta) => meta.tag.id)))
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

    return Array.from(pairCounts.entries())
      .map(([key, count]) => {
        const [firstId, secondId] = key.split(":").map(Number);
        const tagA = tagMetaById.get(firstId);
        const tagB = tagMetaById.get(secondId);
        if (!tagA || !tagB) return null;
        return { key, tagA, tagB, count } satisfies PairRow;
      })
      .filter((row): row is PairRow => row !== null)
      .sort((a, b) => b.count - a.count || compareTagNames(a.tagA, b.tagA) || compareTagNames(a.tagB, b.tagB));
  }, [baseItems]);

  const summary = useMemo(() => {
    const totalPairs = rows.length;
    const strongest = rows[0]?.count ?? 0;
    return { totalPairs, strongest };
  }, [rows]);

  const openEvidenceForPair = (row: PairRow) => {
    void navigate({
      to: "/workspace/$projectPath/analysis/evidence",
      params: { projectPath },
      search: mergeAnalysisSearch(search, {
        tagId: undefined,
        pairTagAId: row.tagA.tag.id,
        pairTagBId: row.tagB.tag.id,
      }) as never,
    });
  };

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("analysis.cooccurrence.title", { defaultValue: "Co-occurrence" })}</h1>
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

      {error ? <ErrorBanner message={error} onDismiss={() => undefined} /> : null}

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
                {rows.map((row, index) => {
                  const active =
                    search.pairTagAId === row.tagA.tag.id &&
                    search.pairTagBId === row.tagB.tag.id;
                  return (
                    <tr key={row.key} className={active ? styles.activeRow : undefined}>
                      <td className={styles.rankCell}>{index + 1}</td>
                      <td>
                        <div className={styles.tagName}>{row.tagA.tag.name}</div>
                        <div className={styles.context}>{tagContext(row.tagA, t)}</div>
                      </td>
                      <td>
                        <div className={styles.tagName}>{row.tagB.tag.name}</div>
                        <div className={styles.context}>{tagContext(row.tagB, t)}</div>
                      </td>
                      <td className={styles.countCell}>
                        <button type="button" className={styles.countButton} onClick={() => openEvidenceForPair(row)}>
                          {row.count}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};
