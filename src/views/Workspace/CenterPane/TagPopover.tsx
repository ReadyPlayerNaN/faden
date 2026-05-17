import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activeTextSelectionAtom,
  spansForCurrentInterviewAtom,
  selectedSpanIdAtom,
} from "../../../state/tagging";
import { codebookTreeAtom } from "../../../state/codebook";
import { effectiveSelectedInterviewIdAtom } from "../../../state/interview";
import { spanCreate, spanListForInterview } from "../../../ipc/tagging";
import { tagCreate, codebookTree as fetchTree } from "../../../ipc/codebook";
import styles from "./TagPopover.module.css";

type FlatTag = {
  id: number;
  name: string;
  description: string | null;
  categoryName: string;
  clusterName: string;
  color: string | null;
};

export const TagPopover = () => {
  const { t } = useTranslation();
  const [selection, setSelection] = useAtom(activeTextSelectionAtom);
  const interviewId = useAtomValue(effectiveSelectedInterviewIdAtom);
  const [tree, setTree] = useAtom(codebookTreeAtom);
  const setSpans = useSetAtom(spansForCurrentInterviewAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const standaloneLabel = t("tagging.standalone", {
    defaultValue: "Standalone (no category)",
  });
  const noClusterLabel = t("tags.noCluster", { defaultValue: "No cluster" });

  useEffect(() => {
    setFilter("");
    setCreating(false);
    setNewName("");
    setNewDescription("");
    setError(null);
  }, [selection?.segmentId, selection?.startOffset, selection?.endOffset]);

  const flatTags = useMemo<FlatTag[]>(() => {
    if (!tree) return [];
    const out: FlatTag[] = [];

    tree.standaloneTags.forEach((tg) => {
      out.push({
        id: tg.id,
        name: tg.name,
        description: tg.description,
        categoryName: standaloneLabel,
        clusterName: standaloneLabel,
        color: tg.color,
      });
    });

    tree.standaloneCategories.forEach((cat) => {
      cat.tags.forEach((tg) => {
        out.push({
          id: tg.id,
          name: tg.name,
          description: tg.description,
          categoryName: cat.name,
          clusterName: noClusterLabel,
          color: tg.color,
        });
      });
    });

    tree.clusters.forEach((cl) => {
      cl.categories.forEach((cat) => {
        cat.tags.forEach((tg) => {
          out.push({
            id: tg.id,
            name: tg.name,
            description: tg.description,
            categoryName: cat.name,
            clusterName: cl.name,
            color: tg.color,
          });
        });
      });
    });
    return out;
  }, [noClusterLabel, standaloneLabel, tree]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return flatTags;
    return flatTags.filter(
      (tg) =>
        tg.name.toLowerCase().includes(q) ||
        tg.categoryName.toLowerCase().includes(q) ||
        tg.clusterName.toLowerCase().includes(q),
    );
  }, [flatTags, filter]);

  const close = () => setSelection(null);

  const applyTag = async (tagId: number) => {
    if (!selection || interviewId === null) return;
    try {
      const createdSpan = await spanCreate({
        interviewId,
        segmentId: selection.segmentId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        tagIds: [tagId],
      });
      const refreshed = await spanListForInterview(interviewId);
      setSpans(refreshed);
      setSelectedSpan(createdSpan.id);
      close();
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  const createAndApply = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setError(t("tagging.search") + "?");
      return;
    }

    const existingTag = flatTags.find(
      (tag) => tag.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    if (existingTag) {
      await applyTag(existingTag.id);
      return;
    }

    try {
      const tg = await tagCreate(
        null,
        trimmedName,
        newDescription.trim() || null,
      );
      setTree(await fetchTree());
      await applyTag(tg.id);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  if (!selection) return null;
  const anchor = selection.anchorRect;
  if (!anchor) return null;

  const style: CSSProperties = {
    top: anchor.bottom + window.scrollY + 4,
    left: Math.max(8, anchor.left + window.scrollX),
  };

  return (
    <div
      className={styles.popover}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <span className={styles.quote}>
          "{selection.text.slice(0, 60)}
          {selection.text.length > 60 ? "…" : ""}"
        </span>
        <button
          className={styles.closeBtn}
          onClick={close}
          aria-label="close"
        >
          ×
        </button>
      </div>
      {!creating ? (
        <>
          <input
            className={styles.search}
            type="text"
            placeholder={t("tagging.search")}
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />
          {error && <div className={styles.error}>{error}</div>}
          {filtered.length === 0 ? (
            <p className={styles.noResults}>{t("tagging.noResults")}</p>
          ) : (
            <ul className={styles.list}>
              {filtered.slice(0, 12).map((tg) => (
                <li key={tg.id}>
                  <button
                    className={styles.tagBtn}
                    onClick={() => void applyTag(tg.id)}
                    title={tg.description ?? undefined}
                  >
                    {tg.color && (
                      <span
                        className={styles.swatch}
                        style={{ background: tg.color }}
                      />
                    )}
                    <span className={styles.tagName}>{tg.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className={styles.newBtn}
            onClick={() => {
              setCreating(true);
              setNewName(filter.trim());
              setNewDescription("");
              setError(null);
            }}
          >
            {t("tagging.createNewTag")}
          </button>
        </>
      ) : (
        <div className={styles.createForm}>
          <input
            className={styles.search}
            type="text"
            placeholder={t("tags.name", { defaultValue: "Name" })}
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <textarea
            className={styles.search}
            rows={3}
            placeholder={t("tags.description", { defaultValue: "Description" })}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formActions}>
            <button
              className={styles.tagBtn}
              onClick={() => setCreating(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              className={styles.newBtn}
              onClick={() => void createAndApply()}
            >
              {t("tagging.applyTag")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
