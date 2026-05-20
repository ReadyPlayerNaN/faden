import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  spansForCurrentInterviewAtom,
  selectedSpanIdAtom,
} from "../../../state/tagging";
import type { SpanDTO } from "../../../ipc/tagging";
import {
  memoUpsert,
  spanDelete,
  spanListForInterview,
  spanUpdateTags,
} from "../../../ipc/tagging";
import { buildTagMetaMap, listTagMeta } from "../../../ipc/codebook";
import { codebookTreeAtom } from "../../../state/codebook";
import { effectiveSelectedInterviewIdAtom } from "../../../state/interview";
import { Button } from "../../../components/Button/Button";
import { useFindMoreAction } from "../AI/useFindMoreAction";
import { TRANSCRIPTION_FALLBACK_COLOR } from "../CenterPane/transcriptionLens";
import styles from "./SpanDetail.module.css";

type Props = { span: SpanDTO };

export const SpanDetail = ({ span }: Props) => {
  const { t } = useTranslation();
  const codebook = useAtomValue(codebookTreeAtom);
  const interviewId = useAtomValue(effectiveSelectedInterviewIdAtom);
  const setSpans = useSetAtom(spansForCurrentInterviewAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const [memo, setMemo] = useState(span.memo ?? "");
  const [memoSavedAt, setMemoSavedAt] = useState<number | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [filter, setFilter] = useState("");
  const memoSaveRequestIdRef = useRef(0);
  const { busy: findMoreBusy, status: findMoreStatus, launchFindMore, costPreviewModal } = useFindMoreAction();

  useEffect(() => {
    setMemo(span.memo ?? "");
  }, [span.id, span.memo]);

  // Debounced memo save
  useEffect(() => {
    if (memo === (span.memo ?? "")) return;
    const handle = setTimeout(() => {
      const nextMemo = memo;
      const requestId = ++memoSaveRequestIdRef.current;
      void memoUpsert(span.id, nextMemo).then(() => {
        if (memoSaveRequestIdRef.current !== requestId) return;
        setSpans((prev) =>
          prev.map((item) =>
            item.id === span.id ? { ...item, memo: nextMemo } : item,
          ),
        );
        setMemoSavedAt(Date.now());
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [memo, setSpans, span.id, span.memo]);

  const tagMetaById = useMemo(() => buildTagMetaMap(codebook), [codebook]);

  const refreshSpans = async () => {
    if (interviewId !== null) {
      setSpans(await spanListForInterview(interviewId));
    }
  };

  const onRemoveTag = async (tagId: number) => {
    const remaining = span.tags
      .filter((tg) => tg.tagId !== tagId)
      .map((tg) => tg.tagId);
    await spanUpdateTags(span.id, remaining);
    await refreshSpans();
  };

  const onAddTag = async (tagId: number) => {
    const next = Array.from(
      new Set([...span.tags.map((tg) => tg.tagId), tagId]),
    );
    await spanUpdateTags(span.id, next);
    await refreshSpans();
    setAddingTag(false);
    setFilter("");
  };

  const onDeleteSpan = async () => {
    if (!window.confirm(t("tagging.confirmDelete"))) return;
    await spanDelete(span.id);
    setSelectedSpan(null);
    await refreshSpans();
  };

  const allTagsFlat = useMemo(() => {
    return listTagMeta(codebook).map(({ tag, category, cluster, effectiveColor }) => ({
      id: tag.id,
      name: tag.name,
      categoryName: category?.name ?? t("tagging.standalone", { defaultValue: "Standalone (no category)" }),
      clusterName:
        cluster?.name ??
        (category
          ? t("tags.noCluster", { defaultValue: "No cluster" })
          : t("tagging.standalone", { defaultValue: "Standalone (no category)" })),
      color: effectiveColor,
    }));
  }, [codebook, t]);

  const filteredAddable = allTagsFlat
    .filter((tg) => !span.tags.some((s) => s.tagId === tg.id))
    .filter((tg) => {
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      return (
        tg.name.toLowerCase().includes(q) ||
        tg.categoryName.toLowerCase().includes(q) ||
        tg.clusterName.toLowerCase().includes(q)
      );
    });

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return span.tags.flatMap((tg) => {
      const meta = tagMetaById.get(tg.tagId);
      const key = meta?.category ? `category:${meta.category.id}` : "uncategorized";
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        key,
        label: meta?.category?.name ?? t("analysis.peopleLens.uncategorized", { defaultValue: "Uncategorized" }),
        color: meta?.category?.color ?? TRANSCRIPTION_FALLBACK_COLOR,
      }];
    });
  }, [span.tags, t, tagMetaById]);

  const clusters = useMemo(() => {
    const seen = new Set<string>();
    return span.tags.flatMap((tg) => {
      const meta = tagMetaById.get(tg.tagId);
      const key = meta?.cluster ? `cluster:${meta.cluster.id}` : "unclustered";
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        key,
        label: meta?.cluster?.name ?? t("analysis.peopleLens.unclustered", { defaultValue: "Unclustered" }),
        color: meta?.cluster?.color ?? TRANSCRIPTION_FALLBACK_COLOR,
      }];
    });
  }, [span.tags, t, tagMetaById]);

  return (
    <div className={styles.wrap}>
      <blockquote className={styles.quote}>"{span.textSnapshot}"</blockquote>

      <section>
        <h4 className={styles.sectionTitle}>{t("tagging.tags")}</h4>
        <div className={styles.tagList}>
          {span.tags.map((tg) => {
            const meta = tagMetaById.get(tg.tagId);
            const color = meta?.effectiveColor ?? "#5b9aff";
            return (
              <span
                key={tg.tagId}
                className={styles.chip}
                style={{ background: color + "22", borderColor: color }}
              >
                {meta?.tag.name ?? `#${tg.tagId}`}
                <button
                  className={styles.chipRemove}
                  onClick={() => void onRemoveTag(tg.tagId)}
                  aria-label="remove"
                >
                  ×
                </button>
              </span>
            );
          })}
          {!addingTag ? (
            <button
              className={styles.addChip}
              onClick={() => setAddingTag(true)}
            >
              + {t("tagging.applyTag")}
            </button>
          ) : (
            <div className={styles.addBox}>
              <input
                className={styles.addInput}
                autoFocus
                placeholder={t("tagging.search")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setFilter("");
                  }
                }}
              />
              <ul className={styles.addList}>
                {filteredAddable.slice(0, 8).map((tg) => (
                  <li key={tg.id}>
                    <button
                      className={styles.addRow}
                      onClick={() => void onAddTag(tg.id)}
                    >
                      {tg.color && (
                        <span
                          className={styles.swatch}
                          style={{ background: tg.color }}
                        />
                      )}
                      {tg.name}
                      <span className={styles.path}>
                        {tg.clusterName} › {tg.categoryName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className={styles.sectionActions}>
          <Button
            onClick={() => {
              const firstTag = span.tags[0];
              const tagName = firstTag ? tagMetaById.get(firstTag.tagId)?.tag.name ?? null : null;
              void launchFindMore(firstTag?.tagId ?? null, undefined, tagName);
            }}
            disabled={findMoreBusy || span.tags.length === 0}
          >
            {t("ai.findMoreOccurrences", { defaultValue: "Find more occurrences" })}
          </Button>
          {findMoreStatus ? <p className={styles.status}>{findMoreStatus}</p> : null}
        </div>
      </section>

      <section>
        <h4 className={styles.sectionTitle}>{t("tagging.categories", { defaultValue: "Categories" })}</h4>
        <div className={styles.tagList}>
          {categories.map((category) => (
            <span
              key={category.key}
              className={styles.chip}
              style={{ background: `${category.color}22`, borderColor: category.color }}
            >
              {category.label}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h4 className={styles.sectionTitle}>{t("tagging.clusters", { defaultValue: "Clusters" })}</h4>
        <div className={styles.tagList}>
          {clusters.map((cluster) => (
            <span
              key={cluster.key}
              className={styles.chip}
              style={{ background: `${cluster.color}22`, borderColor: cluster.color }}
            >
              {cluster.label}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h4 className={styles.sectionTitle}>{t("tagging.memo")}</h4>
        <textarea
          className={styles.memo}
          rows={4}
          placeholder={t("tagging.memoPlaceholder")}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        {memoSavedAt && (
          <p className={styles.savedLabel}>{t("settings.saved")}</p>
        )}
      </section>

      <section className={styles.danger}>
        <Button variant="danger" onClick={() => void onDeleteSpan()}>
          {t("tagging.deleteSpan")}
        </Button>
      </section>
      {costPreviewModal}
    </div>
  );
};
