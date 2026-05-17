import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  codebookTree as fetchCodebookTree,
  type CategoryNode,
  type ClusterNode,
  type CodebookTree,
  type TagNode,
} from "../../ipc/codebook";
import { projectOpen } from "../../ipc/project";
import { codebookTreeAtom } from "../../state/codebook";
import { currentProjectAtom } from "../../state/project";
import { useParams } from "@tanstack/react-router";
import styles from "./ThemeMapView.module.css";

type ThemeBranch =
  | { kind: "cluster"; cluster: ClusterNode }
  | { kind: "category"; category: CategoryNode };

export const ThemeMapView = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const [project, setProject] = useAtom(currentProjectAtom);
  const setCodebook = useSetAtom(codebookTreeAtom);
  const [tree, setTree] = useState<CodebookTree | null>(null);
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
    void fetchCodebookTree()
      .then((nextTree) => {
        if (cancelled) return;
        setTree(nextTree);
        setCodebook(nextTree);
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
  }, [decodedProjectPath, project, setCodebook]);

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

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

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

const CountPill = ({ count }: { count: number }) => (
  <span className={styles.countPill}>{count}</span>
);
