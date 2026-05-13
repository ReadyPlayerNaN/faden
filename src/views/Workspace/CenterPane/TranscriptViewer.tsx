import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  segmentListForInterview,
  type SegmentDTO,
} from "../../../ipc/segment";
import { transcriptionRunsAtom } from "../../../state/transcription";
import {
  spansForCurrentInterviewAtom,
  selectedSpanIdAtom,
  activeTextSelectionAtom,
} from "../../../state/tagging";
import { codebookTreeAtom } from "../../../state/codebook";
import styles from "./TranscriptViewer.module.css";

type Props = { interviewId: number };

const formatTimestamp = (seconds: number): string => {
  const totalMs = Math.round(seconds * 1000);
  const totalS = Math.floor(totalMs / 1000);
  const h = Math.floor(totalS / 3600);
  const rem = totalS - h * 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
};

type SegmentSpan = {
  spanId: number;
  startOffset: number;
  endOffset: number;
  tagIds: number[];
  source: "manual" | "ai_suggested" | "ai_accepted";
};

const computeRangesForSegment = (text: string, spans: SegmentSpan[]) => {
  const boundaries = new Set<number>([0, text.length]);
  for (const s of spans) {
    boundaries.add(Math.max(0, Math.min(text.length, s.startOffset)));
    boundaries.add(Math.max(0, Math.min(text.length, s.endOffset)));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const ranges: { start: number; end: number; covering: SegmentSpan[] }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const covering = spans.filter(
      (s) => s.startOffset <= start && s.endOffset >= end,
    );
    ranges.push({ start, end, covering });
  }
  return ranges;
};

const findAncestorSegment = (
  node: Node,
  container: HTMLElement,
): HTMLElement | null => {
  let cur: Node | null = node;
  while (cur && cur !== container) {
    if (cur instanceof HTMLElement && cur.dataset.segmentId) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
};

const textOffsetWithin = (
  segmentEl: HTMLElement,
  node: Node,
  offsetInNode: number,
): number | null => {
  const textRoot = segmentEl.querySelector<HTMLElement>(`.${styles.text}`);
  const root: HTMLElement = textRoot ?? segmentEl;
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur: Node | null = walker.nextNode();
  while (cur) {
    if (cur === node) {
      return total + offsetInNode;
    }
    total += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  return null;
};

export const TranscriptViewer = ({ interviewId }: Props) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const spans = useAtomValue(spansForCurrentInterviewAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const setActiveSelection = useSetAtom(activeTextSelectionAtom);
  const runs = useAtomValue(transcriptionRunsAtom);
  const codebook = useAtomValue(codebookTreeAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastProgress = runs[interviewId]?.lastProgress;

  useEffect(() => {
    void segmentListForInterview(interviewId).then(setSegments);
  }, [interviewId, lastProgress?.stage]);

  const spansBySegment = useMemo(() => {
    const map = new Map<number, SegmentSpan[]>();
    for (const s of spans) {
      const arr = map.get(s.segmentId) ?? [];
      arr.push({
        spanId: s.id,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        tagIds: s.tags.map((tg) => tg.tagId),
        source: s.tags[0]?.source ?? "manual",
      });
      map.set(s.segmentId, arr);
    }
    return map;
  }, [spans]);

  const tagColorById = useMemo(() => {
    const m = new Map<number, string>();
    codebook?.clusters.forEach((cl) => {
      cl.categories.forEach((cat) => {
        cat.tags.forEach((tg) => {
          m.set(tg.id, tg.color ?? cat.color ?? cl.color ?? "#5b9aff");
        });
      });
    });
    return m;
  }, [codebook]);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setActiveSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = containerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setActiveSelection(null);
      return;
    }
    const startSeg = findAncestorSegment(range.startContainer, container);
    const endSeg = findAncestorSegment(range.endContainer, container);
    if (!startSeg || !endSeg || startSeg !== endSeg) {
      setActiveSelection(null);
      return;
    }
    const segId = Number(startSeg.dataset.segmentId);
    const segText = startSeg.dataset.text ?? "";
    if (!Number.isFinite(segId) || !segText) {
      setActiveSelection(null);
      return;
    }
    const startOffset = textOffsetWithin(
      startSeg,
      range.startContainer,
      range.startOffset,
    );
    const endOffset = textOffsetWithin(
      startSeg,
      range.endContainer,
      range.endOffset,
    );
    if (
      startOffset === null ||
      endOffset === null ||
      endOffset <= startOffset
    ) {
      setActiveSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setActiveSelection({
      segmentId: segId,
      startOffset,
      endOffset,
      text: segText.slice(startOffset, endOffset),
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  if (segments.length === 0) {
    return <p className={styles.empty}>{t("workspace.noSegments")}</p>;
  }

  return (
    <div
      className={styles.transcript}
      ref={containerRef}
      onMouseUp={handleMouseUp}
    >
      {segments.map((s) => {
        const segSpans = spansBySegment.get(s.id) ?? [];
        const ranges = computeRangesForSegment(s.text, segSpans);
        return (
          <div
            key={s.id}
            className={styles.segment}
            data-segment-id={s.id}
            data-text={s.text}
          >
            <span className={styles.timestamp}>
              [{formatTimestamp(s.startSec)}]
            </span>
            <span className={styles.speaker}>
              {t("workspace.speaker")}{" "}
              {s.speakerDisplayName ?? s.speakerLabelRaw}:
            </span>
            <span className={styles.text}>
              {ranges.map((r, i) => {
                const slice = s.text.slice(r.start, r.end);
                if (r.covering.length === 0) {
                  return <span key={i}>{slice}</span>;
                }
                const first = r.covering[0];
                const firstTagId = first.tagIds[0];
                const color =
                  firstTagId !== undefined
                    ? tagColorById.get(firstTagId)
                    : undefined;
                const isSuggested = first.source === "ai_suggested";
                const markClassName = isSuggested
                  ? `${styles.mark} ${styles.markSuggested}`
                  : styles.mark;
                return (
                  <mark
                    key={i}
                    className={markClassName}
                    style={{ background: (color ?? "#5b9aff") + "33" }}
                    data-span-id={first.spanId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSpan(first.spanId);
                    }}
                    title={
                      r.covering.length > 1
                        ? `${r.covering.length} overlapping spans`
                        : undefined
                    }
                  >
                    {slice}
                    {isSuggested && <sup className={styles.aiBadge}>AI</sup>}
                  </mark>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
};
