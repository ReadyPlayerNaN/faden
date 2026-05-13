import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAtomValue } from "jotai";
import { Button } from "../../../components/Button/Button";
import { selectedInterviewIdAtom } from "../../../state/interview";
import { codebookTreeAtom } from "../../../state/codebook";
import {
  exportCsv,
  exportMarkdown,
  exportRefi,
  exportStats,
  exportCodebook,
  type ExportScope,
} from "../../../ipc/export";
import styles from "./ExportMenu.module.css";

type ScopeKind = "current" | "all" | "byTag";

type Props = {
  onClose: () => void;
  projectName: string;
};

export const ExportMenu = ({ onClose, projectName }: Props) => {
  const { t } = useTranslation();
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const codebook = useAtomValue(codebookTreeAtom);

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

  const allTags = codebook
    ? codebook.clusters.flatMap((cl) =>
        cl.categories.flatMap((cat) => cat.tags),
      )
    : [];

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
    const formats = [doCsv, doMd, doRefi, doStats, doCodebook].filter(
      Boolean,
    ).length;
    if (formats === 0) {
      setError(t("export.noFormats") as string);
      return;
    }
    const scope: ExportScope = {
      interviewIds:
        scopeKind === "current" && selectedInterviewId !== null
          ? [selectedInterviewId]
          : null,
      tagIds:
        scopeKind === "byTag" && tagFilter.length > 0 ? tagFilter : null,
    };
    const base = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
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
        const ext = codebookFormat;
        await exportCodebook(
          codebookFormat,
          `${outDir}/${base}-codebook.${ext}`,
        );
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
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>{t("export.title")}</h2>

        <section>
          <h3 className={styles.section}>{t("export.scope")}</h3>
          <label>
            <input
              type="radio"
              checked={scopeKind === "current"}
              onChange={() => setScopeKind("current")}
              disabled={selectedInterviewId === null}
            />{" "}
            {t("export.scopeCurrent")}
          </label>
          <label>
            <input
              type="radio"
              checked={scopeKind === "all"}
              onChange={() => setScopeKind("all")}
            />{" "}
            {t("export.scopeAll")}
          </label>
          <label>
            <input
              type="radio"
              checked={scopeKind === "byTag"}
              onChange={() => setScopeKind("byTag")}
            />{" "}
            {t("export.scopeByTag")}
          </label>
          {scopeKind === "byTag" && (
            <select
              multiple
              className={styles.tagSelect}
              value={tagFilter.map(String)}
              onChange={(e) => {
                const opts = Array.from(e.target.selectedOptions).map((o) =>
                  Number(o.value),
                );
                setTagFilter(opts);
              }}
            >
              {allTags.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.name}
                </option>
              ))}
            </select>
          )}
        </section>

        <section>
          <h3 className={styles.section}>{t("export.formats")}</h3>
          <label>
            <input
              type="checkbox"
              checked={doCsv}
              onChange={(e) => setDoCsv(e.target.checked)}
            />{" "}
            {t("export.csv")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={doMd}
              onChange={(e) => setDoMd(e.target.checked)}
            />{" "}
            {t("export.markdown")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={doRefi}
              onChange={(e) => setDoRefi(e.target.checked)}
            />{" "}
            {t("export.refi")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={doStats}
              onChange={(e) => setDoStats(e.target.checked)}
            />{" "}
            {t("export.stats")}
            {doStats && (
              <select
                className={styles.subSelect}
                value={statsFormat}
                onChange={(e) =>
                  setStatsFormat(e.target.value as "csv" | "markdown")
                }
              >
                <option value="csv">CSV</option>
                <option value="markdown">Markdown</option>
              </select>
            )}
          </label>
          <label>
            <input
              type="checkbox"
              checked={doCodebook}
              onChange={(e) => setDoCodebook(e.target.checked)}
            />{" "}
            {t("export.codebook")}
            {doCodebook && (
              <select
                className={styles.subSelect}
                value={codebookFormat}
                onChange={(e) =>
                  setCodebookFormat(e.target.value as "json" | "csv")
                }
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
            )}
          </label>
        </section>

        <section className={styles.dirRow}>
          <Button onClick={() => void pickDir()}>
            {t("export.pickDirectory")}
          </Button>
          {outDir && <span className={styles.path}>{outDir}</span>}
        </section>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <div className={styles.actions}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => void onRun()}
            disabled={busy}
          >
            {t("export.run")}
          </Button>
        </div>
      </div>
    </div>
  );
};
