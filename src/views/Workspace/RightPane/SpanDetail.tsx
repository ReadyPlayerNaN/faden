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
    </div>
  );
};
