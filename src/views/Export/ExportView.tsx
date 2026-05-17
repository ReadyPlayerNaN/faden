import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { PageViewHeader } from "../../components/PageViewHeader/PageViewHeader";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { codebookTree as fetchCodebookTree } from "../../ipc/codebook";
import {
  exportCodebook,
  exportCsv,
  exportMarkdown,
  exportRefi,
  exportStats,
  type ExportScope,
} from "../../ipc/export";
import { projectOpen } from "../../ipc/project";
import { codebookTreeAtom } from "../../state/codebook";
import { effectiveSelectedInterviewIdAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import styles from "./ExportView.module.css";

type ScopeKind = "current" | "all" | "byTag";

export const ExportView = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const [codebook, setCodebook] = useAtom(codebookTreeAtom);
  const selectedInterviewId = useAtomValue(effectiveSelectedInterviewIdAtom);

  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    selectedInterviewId !== null ? "current" : "all",
  );
  const [tagFilter, setTagFilter] = useState<number[]>([]);

  const [doCsv, setDoCsv] = useState(true);
  const [doMd, setDoMd] = useState(false);
  const [doRefi, setDoRefi] = useState(false);
  const [doStats, setDoStats] = useState(false);
  const [statsFormat, setStatsFormat] = useState<"csv" | "markdown">("csv");
  const [doCodebook, setDoCodebook] = useState(false);
  const [codebookFormat, setCodebookFormat] = useState<"json" | "csv">("json");

  const [outDir, setOutDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  useEffect(() => {
    if (codebook) return;
    void fetchCodebookTree().then(setCodebook).catch(() => undefined);
  }, [codebook, setCodebook]);

  const allTags = useMemo(
    () =>
      codebook
        ? [
            ...codebook.standaloneTags,
            ...codebook.standaloneCategories.flatMap((category) => category.tags),
            ...codebook.clusters.flatMap((cluster) =>
              cluster.categories.flatMap((category) => category.tags),
            ),
          ]
        : [],
    [codebook],
  );

  const pickDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (dir && !Array.isArray(dir)) setOutDir(dir);
  };

  const onRun = async () => {
    setError(null);
    setSuccess(null);
    if (!outDir) {
      setError(t("export.noDirectory") as string);
      return;
    }
    const formats = [doCsv, doMd, doRefi, doStats, doCodebook].filter(Boolean).length;
    if (formats === 0) {
      setError(t("export.noFormats") as string);
      return;
    }
    const scope: ExportScope = {
      interviewIds:
        scopeKind === "current" && selectedInterviewId !== null
          ? [selectedInterviewId]
          : null,
      tagIds: scopeKind === "byTag" && tagFilter.length > 0 ? tagFilter : null,
    };
    const base = (project?.name ?? t("export.title")).replace(/[^a-zA-Z0-9_-]/g, "_");
    setBusy(true);
    try {
      let count = 0;
      if (doCsv) {
        await exportCsv(scope, `${outDir}/${base}.csv`);
        count++;
      }
      if (doMd) {
        await exportMarkdown(scope, `${outDir}/${base}.md`);
        count++;
      }
      if (doRefi) {
        await exportRefi(scope, `${outDir}/${base}.refi.xml`);
        count++;
      }
      if (doStats) {
        const ext = statsFormat === "csv" ? "csv" : "md";
        await exportStats(scope, statsFormat, `${outDir}/${base}-stats.${ext}`);
        count++;
      }
      if (doCodebook) {
        await exportCodebook(codebookFormat, `${outDir}/${base}-codebook.${codebookFormat}`);
        count++;
      }
      setSuccess(t("export.success", { count }) as string);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.shell}>
      <ProjectHeader activeView="export" />

      <PageContainer className={styles.wrap}>
        <PageViewHeader
          view="export"
          title={t("export.title", { defaultValue: "Export" })}
          subtitle={t("export.subtitle", {
            defaultValue:
              "Export the current interview, the full project, or a tag-filtered subset into research-friendly formats.",
          })}
          aside={
            <Button variant="primary" onClick={() => void onRun()} disabled={busy}>
              {t("export.run", { defaultValue: "Export" })}
            </Button>
          }
        />

        <div className={styles.card}>
          <div className={styles.sections}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t("export.scope", { defaultValue: "Scope" })}</h2>
              <label className={styles.option}>
                <input
                  type="radio"
                  checked={scopeKind === "current"}
                  onChange={() => setScopeKind("current")}
                  disabled={selectedInterviewId === null}
                />
                <span>{t("export.scopeCurrent", { defaultValue: "Current interview" })}</span>
              </label>
              <label className={styles.option}>
                <input
                  type="radio"
                  checked={scopeKind === "all"}
                  onChange={() => setScopeKind("all")}
                />
                <span>{t("export.scopeAll", { defaultValue: "Whole project" })}</span>
              </label>
              <label className={styles.option}>
                <input
                  type="radio"
                  checked={scopeKind === "byTag"}
                  onChange={() => setScopeKind("byTag")}
                />
                <span>{t("export.scopeByTag", { defaultValue: "By tag" })}</span>
              </label>
              {scopeKind === "byTag" && (
                <select
                  multiple
                  className={styles.tagSelect}
                  value={tagFilter.map(String)}
                  onChange={(e) => {
                    const opts = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                    setTagFilter(opts);
                  }}
                >
                  {allTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t("export.formats", { defaultValue: "Formats" })}</h2>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={doCsv}
                  onChange={(e) => setDoCsv(e.target.checked)}
                />
                <span>{t("export.csv", { defaultValue: "CSV (one row per quote)" })}</span>
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={doMd}
                  onChange={(e) => setDoMd(e.target.checked)}
                />
                <span>{t("export.markdown", { defaultValue: "Markdown transcript" })}</span>
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={doRefi}
                  onChange={(e) => setDoRefi(e.target.checked)}
                />
                <span>{t("export.refi", { defaultValue: "REFI-QDA XML" })}</span>
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={doStats}
                  onChange={(e) => setDoStats(e.target.checked)}
                />
                <span>{t("export.stats", { defaultValue: "Stats report" })}</span>
                {doStats && (
                  <select
                    className={styles.subSelect}
                    value={statsFormat}
                    onChange={(e) => setStatsFormat(e.target.value as "csv" | "markdown")}
                  >
                    <option value="csv">CSV</option>
                    <option value="markdown">Markdown</option>
                  </select>
                )}
              </label>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={doCodebook}
                  onChange={(e) => setDoCodebook(e.target.checked)}
                />
                <span>{t("export.codebook", { defaultValue: "Codebook only" })}</span>
                {doCodebook && (
                  <select
                    className={styles.subSelect}
                    value={codebookFormat}
                    onChange={(e) => setCodebookFormat(e.target.value as "json" | "csv")}
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                )}
              </label>
            </section>
          </div>

          <section className={styles.directorySection}>
            <div>
              <h2 className={styles.sectionTitle}>{t("export.directory", { defaultValue: "Output directory" })}</h2>
              <p className={styles.directoryHelp}>
                {outDir ?? t("export.noDirectorySelected", { defaultValue: "No output directory selected yet." })}
              </p>
            </div>
            <Button onClick={() => void pickDir()}>{t("export.pickDirectory", { defaultValue: "Browse…" })}</Button>
          </section>

          {error && <p className={styles.error}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}
        </div>
      </PageContainer>
    </div>
  );
};
