import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  segmentListForInterview,
  segmentUpdateText,
  segmentSetSpeaker,
  segmentDelete,
  segmentSplit,
  segmentMerge,
  type SegmentDTO,
} from "../../../ipc/segment";
import {
  speakerListForInterview,
  speakerCreate,
  type Speaker,
} from "../../../ipc/speaker";
import { transcriptionRunsAtom } from "../../../state/transcription";
import {
  segmentPlaybackRequestAtom,
  segmentPlaybackStateAtom,
} from "../../../state/audio";
import {
  spansForCurrentInterviewAtom,
  selectedSpanIdAtom,
  activeTextSelectionAtom,
} from "../../../state/tagging";
import { buildTagMetaMap } from "../../../ipc/codebook";
import { codebookTreeAtom } from "../../../state/codebook";
import { Modal } from "../../../components/Modal/Modal";
import styles from "./TranscriptViewer.module.css";

type Props = {
  interviewId: number;
  speakerVersion?: number;
};

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

const sortCoveringSpans = (spans: SegmentSpan[]) =>
  [...spans].sort((a, b) => {
    if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
    if (a.endOffset !== b.endOffset) return b.endOffset - a.endOffset;
    return a.spanId - b.spanId;
  });

const buildStripeBackground = (colors: string[], selected: boolean) => {
  const layers: string[] = [];
  if (selected) {
    layers.push(
      "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 22%, transparent) 0%, color-mix(in srgb, var(--accent) 22%, transparent) 100%)",
    );
  }
  if (colors.length > 0) {
    const stripeStops = colors.flatMap((color, index) => {
      const start = ((index / colors.length) * 100).toFixed(2);
      const end = (((index + 1) / colors.length) * 100).toFixed(2);
      const tint = `color-mix(in srgb, ${color} 28%, transparent)`;
      return [`${tint} ${start}%`, `${tint} ${end}%`];
    });
    layers.push(`linear-gradient(to bottom, ${stripeStops.join(", ")})`);
  }
  return layers.join(", ");
};

const buildRangeTitle = (
  covering: SegmentSpan[],
  tagLabelById: Map<number, string>,
) => {
  if (covering.length === 0) return undefined;
  const lines = covering.map((span, index) => {
    const labels = span.tagIds.map((tagId) => tagLabelById.get(tagId) ?? `#${tagId}`);
    return `Span ${index + 1}: ${labels.join(", ") || `#${span.spanId}`}`;
  });
  if (covering.length > 1) lines.push("Click to cycle overlapping spans");
  return lines.join("\n");
};

type SegmentSelection = {
  startOffset: number;
  endOffset: number;
} | null;

const computeRangesForSegment = (
  text: string,
  spans: SegmentSpan[],
  selection: SegmentSelection,
) => {
  const boundaries = new Set<number>([0, text.length]);
  for (const s of spans) {
    boundaries.add(Math.max(0, Math.min(text.length, s.startOffset)));
    boundaries.add(Math.max(0, Math.min(text.length, s.endOffset)));
  }
  if (selection) {
    boundaries.add(Math.max(0, Math.min(text.length, selection.startOffset)));
    boundaries.add(Math.max(0, Math.min(text.length, selection.endOffset)));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const ranges: {
    start: number;
    end: number;
    covering: SegmentSpan[];
    selected: boolean;
  }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const covering = spans.filter(
      (s) => s.startOffset <= start && s.endOffset >= end,
    );
    const selected =
      selection !== null &&
      selection.startOffset <= start &&
      selection.endOffset >= end;
    ranges.push({ start, end, covering, selected });
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

type SegmentEditorProps = {
  segment: SegmentDTO;
  speakers: Speaker[];
  interviewId: number;
  isLast: boolean;
  nextSegmentId: number | null;
  onChanged: () => Promise<void> | void;
  onSpeakersChanged: () => Promise<void> | void;
};

const SegmentEditor = ({
  segment,
  speakers,
  interviewId,
  isLast,
  nextSegmentId,
  onChanged,
  onSpeakersChanged,
}: SegmentEditorProps) => {
  const { t } = useTranslation();
  const [text, setText] = useState(segment.text);
  const [addingSpeaker, setAddingSpeaker] = useState(false);
  const [newSpeakerLabel, setNewSpeakerLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText(segment.text);
  }, [segment.text]);

  const onSpeakerSelectChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const value = e.target.value;
    if (value === "__add__") {
      setAddingSpeaker(true);
      return;
    }
    if (value === "__none__") {
      if (segment.speakerId === null) return;
      setError(null);
      try {
        await segmentSetSpeaker(segment.id, null);
        await onChanged();
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    const id = Number(value);
    if (!Number.isFinite(id) || id === segment.speakerId) return;
    setError(null);
    try {
      await segmentSetSpeaker(segment.id, id);
      await onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const submitNewSpeaker = async () => {
    const label = newSpeakerLabel.trim();
    if (!label) {
      setAddingSpeaker(false);
      setNewSpeakerLabel("");
      return;
    }
    setError(null);
    try {
      const created = await speakerCreate(interviewId, label, null);
      await onSpeakersChanged();
      await segmentSetSpeaker(segment.id, created.id);
      await onChanged();
      setAddingSpeaker(false);
      setNewSpeakerLabel("");
    } catch (e) {
      setError(String(e));
    }
  };

  const saveText = async () => {
    if (text === segment.text) return;
    setError(null);
    try {
      await segmentUpdateText(segment.id, text);
      await onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const doDelete = async () => {
    setError(null);
    try {
      await segmentDelete(segment.id);
      setConfirmDeleteOpen(false);
      await onChanged();
    } catch (e) {
      setError(String(e));
      setConfirmDeleteOpen(false);
    }
  };

  const doSplit = async () => {
    setError(null);
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    if (cursor <= 0 || cursor >= segment.text.length) {
      setError(
        t("transcript.splitAtEdge", { defaultValue: "Cannot split at edge" }),
      );
      return;
    }
    const span = segment.endSec - segment.startSec;
    const splitAudioSec =
      segment.startSec + (cursor / segment.text.length) * span;
    try {
      await segmentSplit(segment.id, cursor, splitAudioSec);
      await onChanged();
    } catch (e) {
      const msg = String(e);
      if (msg.toLowerCase().includes("invalid")) {
        setError(
          t("transcript.spanCrosses", {
            defaultValue: "Cannot split: a tagged span crosses the split point",
          }),
        );
      } else {
        setError(msg);
      }
    }
  };

  const doMerge = async () => {
    if (nextSegmentId === null) return;
    setError(null);
    try {
      await segmentMerge(segment.id, nextSegmentId);
      await onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className={styles.editor} data-segment-id={segment.id}>
      <div className={styles.editorRow}>
        <span className={styles.timestamp}>
          [{formatTimestamp(segment.startSec)}]
        </span>
        {addingSpeaker ? (
          <input
            className={styles.newSpeakerInput}
            value={newSpeakerLabel}
            autoFocus
            placeholder={t("transcript.addSpeaker", {
              defaultValue: "Add speaker…",
            })}
            onChange={(e) => setNewSpeakerLabel(e.target.value)}
            onBlur={() => void submitNewSpeaker()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNewSpeaker();
              if (e.key === "Escape") {
                setAddingSpeaker(false);
                setNewSpeakerLabel("");
              }
            }}
          />
        ) : (
          <select
            value={segment.speakerId === null ? "__none__" : String(segment.speakerId)}
            onChange={(e) => void onSpeakerSelectChange(e)}
          >
            <option value="__none__">
              {t("speakers.unassigned", { defaultValue: "Unassigned" })}
            </option>
            {speakers.map((sp) => (
              <option key={sp.id} value={String(sp.id)}>
                {sp.displayName ?? sp.labelRaw}
              </option>
            ))}
            <option value="__add__">
              {t("transcript.addSpeaker", { defaultValue: "Add speaker…" })}
            </option>
          </select>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className={styles.editorTextarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void saveText()}
      />
      <div className={styles.editorActions}>
        <button type="button" onClick={() => setConfirmDeleteOpen(true)}>
          {t("transcript.delete", { defaultValue: "Delete" })}
        </button>
        <button type="button" onClick={() => void doSplit()}>
          {t("transcript.split", { defaultValue: "Split here" })}
        </button>
        <button
          type="button"
          disabled={isLast || nextSegmentId === null}
          onClick={() => void doMerge()}
        >
          {t("transcript.mergeNext", { defaultValue: "Merge with next" })}
        </button>
      </div>
      {error && <div className={styles.inlineError}>{error}</div>}
      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title={t("transcript.confirmDelete", {
          defaultValue: "Delete segment?",
        })}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" onClick={() => void doDelete()}>
              {t("transcript.delete", { defaultValue: "Delete" })}
            </button>
          </>
        }
      >
        <p>
          {t("transcript.confirmDeleteBody", {
            defaultValue:
              "This will permanently remove this segment and any tags on it.",
          })}
        </p>
      </Modal>
    </div>
  );
};

export const TranscriptViewer = ({ interviewId, speakerVersion = 0 }: Props) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [segmentPlaybackState] = useAtom(segmentPlaybackStateAtom);
  const setSegmentPlaybackRequest = useSetAtom(segmentPlaybackRequestAtom);
  const spans = useAtomValue(spansForCurrentInterviewAtom);
  const activeSelection = useAtomValue(activeTextSelectionAtom);
  const selectedSpanId = useAtomValue(selectedSpanIdAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const setActiveSelection = useSetAtom(activeTextSelectionAtom);
  const runs = useAtomValue(transcriptionRunsAtom);
  const codebook = useAtomValue(codebookTreeAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastProgress = runs[interviewId]?.lastProgress;

  const refetchSegments = async () => {
    setSegments(await segmentListForInterview(interviewId));
  };

  const refetchSpeakers = async () => {
    setSpeakers(await speakerListForInterview(interviewId));
  };

  useEffect(() => {
    void segmentListForInterview(interviewId).then(setSegments);
  }, [interviewId, lastProgress?.stage, speakerVersion]);

  useEffect(() => {
    void speakerListForInterview(interviewId).then(setSpeakers);
  }, [interviewId, lastProgress?.stage, speakerVersion]);

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

  const tagMetaById = useMemo(() => {
    const m = new Map<number, { color: string; label: string }>();
    buildTagMetaMap(codebook).forEach((meta, tagId) => {
      m.set(tagId, {
        color: meta.effectiveColor ?? "#5b9aff",
        label: meta.tag.name,
      });
    });
    return m;
  }, [codebook]);

  const tagLabelById = useMemo(
    () => new Map(Array.from(tagMetaById.entries()).map(([tagId, meta]) => [tagId, meta.label])),
    [tagMetaById],
  );

  const handleMouseUp = () => {
    if (editMode) return;
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

  const requestSegmentPlayback = (segment: SegmentDTO, loop: boolean) => {
    setSegmentPlaybackRequest({
      requestId: Date.now(),
      interviewId,
      segmentId: segment.id,
      startSec: segment.startSec,
      endSec: segment.endSec,
      loop,
    });
  };

  const toolbar = (
    <div className={styles.toolbar}>
      <label className={styles.editToggle}>
        <input
          type="checkbox"
          checked={editMode}
          onChange={(e) => setEditMode(e.target.checked)}
        />
        {t("transcript.editMode", { defaultValue: "Edit transcript" })}
      </label>
    </div>
  );

  if (segments.length === 0) {
    return (
      <>
        {toolbar}
        <p className={styles.empty}>{t("workspace.noSegments")}</p>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <div
        className={styles.transcript}
        ref={containerRef}
        onMouseUp={handleMouseUp}
      >
        {segments.map((s, idx) => {
          if (editMode) {
            const next = segments[idx + 1];
            return (
              <SegmentEditor
                key={s.id}
                segment={s}
                speakers={speakers}
                interviewId={interviewId}
                isLast={idx === segments.length - 1}
                nextSegmentId={next ? next.id : null}
                onChanged={refetchSegments}
                onSpeakersChanged={refetchSpeakers}
              />
            );
          }
          const segSpans = spansBySegment.get(s.id) ?? [];
          const selection =
            activeSelection?.segmentId === s.id
              ? {
                  startOffset: activeSelection.startOffset,
                  endOffset: activeSelection.endOffset,
                }
              : null;
          const ranges = computeRangesForSegment(s.text, segSpans, selection);
          const isActiveSegment = segmentPlaybackState.activeSegmentId === s.id;
          const isPlayingSegment = isActiveSegment && segmentPlaybackState.playing;
          const segmentDuration = Math.max(0, s.endSec - s.startSec);
          const segmentProgress =
            isActiveSegment && segmentPlaybackState.currentTime >= s.startSec
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    (segmentPlaybackState.currentTime - s.startSec) /
                      (segmentDuration || 1),
                  ),
                )
              : 0;
          return (
            <div
              key={s.id}
              className={`${styles.segment} ${isActiveSegment ? styles.segmentActive : ""}`}
              data-segment-id={s.id}
              data-text={s.text}
            >
              <div className={styles.segmentControls}>
                <button
                  type="button"
                  className={styles.segmentPlayButton}
                  onClick={() => requestSegmentPlayback(s, false)}
                  aria-label={
                    isPlayingSegment
                      ? t("transcript.pauseTurn", { defaultValue: "Pause turn" })
                      : t("transcript.playTurn", { defaultValue: "Play turn" })
                  }
                  title={t("transcript.playTurn", { defaultValue: "Play turn" })}
                >
                  {isPlayingSegment ? "⏸" : "▶"}
                </button>
                <button
                  type="button"
                  className={`${styles.segmentLoopButton} ${isActiveSegment && segmentPlaybackState.loop ? styles.segmentLoopButtonActive : ""}`}
                  onClick={() => requestSegmentPlayback(s, true)}
                  aria-label={t("transcript.loopTurn", { defaultValue: "Loop turn" })}
                  title={t("transcript.loopTurn", { defaultValue: "Loop turn" })}
                >
                  ↻
                </button>
              </div>
              <span className={styles.timestamp}>
                [{formatTimestamp(s.startSec)}]
              </span>
              <span className={styles.speaker}>
                {s.speakerDisplayName ??
                  s.speakerLabelRaw ??
                  t("speakers.unassigned", { defaultValue: "Unassigned" })}
                :
              </span>
              <span className={styles.text}>
                {ranges.map((r, i) => {
                  const slice = s.text.slice(r.start, r.end);
                  if (r.covering.length === 0 && !r.selected) {
                    return <span key={i}>{slice}</span>;
                  }
                  const covering = sortCoveringSpans(r.covering);
                  const selectedCoveringSpan =
                    selectedSpanId !== null
                      ? covering.find((span) => span.spanId === selectedSpanId)
                      : undefined;
                  const activeSpan = selectedCoveringSpan ?? covering[0];
                  const stripeColors = covering
                    .flatMap((span) => span.tagIds)
                    .map((tagId) => tagMetaById.get(tagId)?.color ?? "#5b9aff");
                  const hasSuggested = covering.some(
                    (span) => span.source === "ai_suggested",
                  );
                  const isSuggestedOnly =
                    covering.length > 0 &&
                    covering.every((span) => span.source === "ai_suggested");
                  const markClassName = [
                    styles.mark,
                    isSuggestedOnly ? styles.markSuggested : "",
                    selectedCoveringSpan ? styles.markSelected : "",
                    covering.length > 1 ? styles.markOverlapping : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const activeColor =
                    activeSpan?.tagIds
                      .map((tagId) => tagMetaById.get(tagId)?.color)
                      .find((color): color is string => Boolean(color)) ?? "#5b9aff";
                  return (
                    <mark
                      key={i}
                      className={markClassName}
                      style={{
                        backgroundImage: buildStripeBackground(
                          stripeColors,
                          r.selected,
                        ),
                        borderBottomColor: activeColor,
                        color: activeColor,
                      }}
                      data-span-id={activeSpan?.spanId}
                      data-overlap-count={covering.length > 1 ? covering.length : undefined}
                      onClick={
                        activeSpan
                          ? (e) => {
                              e.stopPropagation();
                              if (covering.length === 1) {
                                setSelectedSpan(activeSpan.spanId);
                                return;
                              }
                              const currentIndex = covering.findIndex(
                                (span) => span.spanId === selectedSpanId,
                              );
                              const nextSpan =
                                currentIndex >= 0
                                  ? covering[(currentIndex + 1) % covering.length]
                                  : covering[0];
                              setSelectedSpan(nextSpan.spanId);
                            }
                          : undefined
                      }
                      title={buildRangeTitle(covering, tagLabelById)}
                    >
                      {slice}
                      {hasSuggested && <sup className={styles.aiBadge}>AI</sup>}
                    </mark>
                  );
                })}
                {isActiveSegment && (
                  <span
                    className={styles.segmentProgress}
                    aria-hidden="true"
                    style={{ transform: `scaleX(${segmentProgress})` }}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};
