import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { aiProposalAccept, aiRunGet, type ProposalDTO } from "../../../ipc/ai";
import { buildTagMetaMap, codebookTree, type CodebookTree } from "../../../ipc/codebook";
import { segmentListForInterview, type SegmentDTO } from "../../../ipc/segment";
import { spanListForInterview, type SpanDTO } from "../../../ipc/tagging";
import { activeSuggestionReviewAtom } from "../../../state/ai";
import { currentProjectAtom } from "../../../state/project";
import { selectedInterviewIdAtom } from "../../../state/interview";
import {
  activeTextSelectionAtom,
  selectedSpanIdAtom,
} from "../../../state/tagging";
import { Button } from "../../../components/Button/Button";
import styles from "./SpanProposalView.module.css";

type Props = {
  proposal: ProposalDTO;
  onAccepted?: () => Promise<void> | void;
  onReject?: () => Promise<void> | void;
  onDone: () => void;
};

type Suggestion = {
  kind?: "new_span" | "extend_span" | null;
  existing_span_id?: number | null;
  segment_id: number;
  start_offset: number;
  end_offset: number;
  tag_names: string[];
  rationale?: string | null;
};

type SpanPayload = { suggestions?: Suggestion[] };

type WorkspaceHandoffPayload = {
  projectPath: string;
  interviewId: number;
  selection: {
    segmentId: number;
    startOffset: number;
    endOffset: number;
    text: string;
  };
  review: {
    proposalId: number;
    proposalKind: "pretag" | "find_more";
    interviewId: number;
    suggestions: Array<{
      segmentId: number;
      startOffset: number;
      endOffset: number;
      tagNames: string[];
      rationale?: string | null;
    }>;
    currentIndex: number;
    decisions: Array<"accepted" | "declined" | null>;
  };
};

const OPEN_SPAN_HANDOFF_STORAGE_KEY = "faden.workspace.open-span";

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const sliceText = (text: string, start: number, end: number): string =>
  Array.from(text).slice(start, end).join("");

export const SpanProposalView = ({
  proposal,
  onAccepted,
  onReject,
  onDone,
}: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const project = useAtomValue(currentProjectAtom);
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const setActiveSelection = useSetAtom(activeTextSelectionAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const setSelectedInterviewId = useSetAtom(selectedInterviewIdAtom);
  const setActiveSuggestionReview = useSetAtom(activeSuggestionReviewAtom);
  const payload = (proposal.payload ?? {}) as SpanPayload;
  const suggestions: Suggestion[] = payload.suggestions ?? [];
  const [selected, setSelected] = useState<boolean[]>(
    suggestions.map(() => true),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [targetInterviewId, setTargetInterviewId] = useState<number | null>(null);
  const [segments, setSegments] = useState<Map<number, SegmentDTO>>(new Map());
  const [spans, setSpans] = useState<Map<number, SpanDTO>>(new Map());
  const [codebook, setCodebook] = useState<CodebookTree | null>(null);
  const isPending = proposal.status === "pending";

  useEffect(() => {
    let cancelled = false;
    void aiRunGet(proposal.aiRunId)
      .then(async (run) => {
        if (cancelled) return;
        setTargetInterviewId(run.interviewId);
        if (run.interviewId == null) return;
        const [segmentRows, spanRows, codebookData] = await Promise.all([
          segmentListForInterview(run.interviewId),
          spanListForInterview(run.interviewId),
          codebookTree(),
        ]);
        if (cancelled) return;
        setSegments(new Map(segmentRows.map((segment) => [segment.id, segment])));
        setSpans(new Map(spanRows.map((span) => [span.id, span])));
        setCodebook(codebookData);
      })
      .catch((e) => {
        if (!cancelled) {
          setResult(errorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.aiRunId]);

  const tagMetaMap = buildTagMetaMap(codebook);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };
  const setAll = (v: boolean) => setSelected(suggestions.map(() => v));

  const startInlineReview = async (startIndex: number) => {
    if (!project || targetInterviewId === null) {
      setResult(
        t("ai.openInCodingViewUnavailable", {
          defaultValue: "Couldn’t resolve the interview for this suggestion.",
        }),
      );
      return;
    }

    const current = suggestions[startIndex];
    if (!current) return;

    const review = {
      proposalId: proposal.id,
      proposalKind: proposal.kind as "pretag" | "find_more",
      interviewId: targetInterviewId,
      suggestions: suggestions.map((suggestion) => ({
        segmentId: suggestion.segment_id,
        startOffset: suggestion.start_offset,
        endOffset: suggestion.end_offset,
        tagNames: suggestion.tag_names,
        kind: suggestion.kind,
        existingSpanId: suggestion.existing_span_id,
        rationale: suggestion.rationale,
      })),
      currentIndex: startIndex,
      decisions: suggestions.map(() => null),
    } as const;

    const selection = {
      segmentId: current.segment_id,
      startOffset: current.start_offset,
      endOffset: current.end_offset,
      text: "",
      anchorRect: null,
    } as const;

    if (location.pathname.startsWith("/workspace/") && !location.pathname.includes("/suggestions")) {
      setSelectedInterviewId(targetInterviewId);
      setSelectedSpan(null);
      setActiveSuggestionReview(review);
      setActiveSelection(selection);
      onDone();
      return;
    }

    const handoff: WorkspaceHandoffPayload = {
      projectPath: project.path,
      interviewId: targetInterviewId,
      selection: {
        segmentId: current.segment_id,
        startOffset: current.start_offset,
        endOffset: current.end_offset,
        text: "",
      },
      review,
    };
    window.localStorage.setItem(
      OPEN_SPAN_HANDOFF_STORAGE_KEY,
      JSON.stringify(handoff),
    );
    onDone();
    await navigate({
      to: "/workspace/$projectPath",
      params: { projectPath: encodeURIComponent(project.path) },
    });
  };

  const onAccept = async () => {
    setBusy(true);
    const indices = selected
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    try {
      const r = await aiProposalAccept(proposal.id, { span_indices: indices });
      await onAccepted?.();
      setResult(
        t("ai.accepted", {
          created: r.created_count,
          skipped: r.skipped.length,
        }),
      );
      setTimeout(onDone, 1500);
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    setBusy(true);
    try {
      await onReject?.();
      setResult(t("ai.rejected"));
      setTimeout(onDone, 1000);
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <h2>
        {proposal.kind === "pretag" ? t("ai.preTag") : t("ai.findMore")}
      </h2>
      <p>{t(`ai.proposalStatus.${proposal.status === "pending" ? "new" : proposal.status}`)}</p>
      {isPending && (
        <div className={styles.bulk}>
          <Button onClick={() => setAll(true)}>{t("ai.acceptAll")}</Button>
          <Button onClick={() => setAll(false)}>{t("ai.rejectAll")}</Button>
        </div>
      )}
      <ul className={styles.list}>
        {suggestions.map((s, i) => {
          const segment = segments.get(s.segment_id) ?? null;
          const existingSpan = s.existing_span_id ? (spans.get(s.existing_span_id) ?? null) : null;
          const existingTagNames = existingSpan
            ? existingSpan.tags
                .map((tagOnSpan) => tagMetaMap.get(tagOnSpan.tagId)?.tag.name)
                .filter((value): value is string => Boolean(value))
            : [];
          const proposedNewTagNames = s.tag_names.filter((name) => !existingTagNames.includes(name));
          const beforeText = existingSpan && segment
            ? sliceText(segment.text, existingSpan.startOffset, existingSpan.endOffset)
            : null;
          const afterText = segment ? sliceText(segment.text, s.start_offset, s.end_offset) : null;
          const leftAdded = existingSpan && segment && s.start_offset < existingSpan.startOffset
            ? sliceText(segment.text, s.start_offset, existingSpan.startOffset)
            : "";
          const rightAdded = existingSpan && segment && s.end_offset > existingSpan.endOffset
            ? sliceText(segment.text, existingSpan.endOffset, s.end_offset)
            : "";
          return (
            <li key={i} className={styles.item}>
              <label className={styles.row}>
                <input
                  type="checkbox"
                  checked={selected[i] ?? false}
                  onChange={() => toggle(i)}
                  disabled={!isPending}
                />
                <span className={styles.tags}>
                  {s.tag_names.map((n) => (
                    <span key={n} className={styles.tag}>
                      {n}
                    </span>
                  ))}
                </span>
                <span className={styles.location}>
                  {s.kind === "extend_span"
                    ? t("ai.extendExistingSpan", { defaultValue: "Extend existing span" })
                    : t("ai.newSpanSuggestion", { defaultValue: "New span suggestion" })}{" "}
                  · seg {s.segment_id} [{s.start_offset}–{s.end_offset}]
                  {s.existing_span_id ? ` → span ${s.existing_span_id}` : ""}
                </span>
              </label>
              {existingSpan && beforeText && afterText ? (
                <div className={styles.previewBlock}>
                  <div className={styles.previewRow}>
                    <strong>{t("ai.existingSpanPreview", { defaultValue: "Existing" })}:</strong> {beforeText}
                  </div>
                  <div className={styles.previewRow}>
                    <strong>{t("ai.proposedSpanPreview", { defaultValue: "Proposed" })}:</strong>{" "}
                    {leftAdded ? <mark>{leftAdded}</mark> : null}
                    <span>{beforeText}</span>
                    {rightAdded ? <mark>{rightAdded}</mark> : null}
                  </div>
                  <div className={styles.previewRow}>
                    <strong>{t("ai.existingTags", { defaultValue: "Already on span" })}:</strong>{" "}
                    {existingTagNames.length > 0 ? existingTagNames.join(", ") : "—"}
                  </div>
                  <div className={styles.previewRow}>
                    <strong>{t("ai.newTags", { defaultValue: "Newly proposed" })}:</strong>{" "}
                    {proposedNewTagNames.length > 0 ? proposedNewTagNames.join(", ") : "—"}
                  </div>
                </div>
              ) : afterText ? (
                <div className={styles.previewBlock}>
                  <div className={styles.previewRow}>
                    <strong>{t("ai.proposedSpanPreview", { defaultValue: "Proposed" })}:</strong> {afterText}
                  </div>
                </div>
              ) : null}
              {s.rationale && <p className={styles.rationale}>{s.rationale}</p>}
              <div className={styles.itemActions}>
                <Button
                  onClick={() => void startInlineReview(i)}
                  disabled={targetInterviewId === null || busy}
                  className={styles.jumpButton}
                >
                  {t("ai.reviewInline", { defaultValue: "Review inline" })}
                </Button>
                {selectedInterviewId === targetInterviewId && location.pathname.startsWith("/workspace/") && !location.pathname.includes("/suggestions") ? (
                  <span className={styles.itemHint}>
                    {t("ai.revealInCurrentTranscript", {
                      defaultValue: "Review in current transcript",
                    })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        {result && <span className={styles.result}>{result}</span>}
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        {isPending && (
          <Button variant="danger" onClick={() => void onDecline()} disabled={busy}>
            {t("ai.reject")}
          </Button>
        )}
        {isPending && (
          <Button
            variant="primary"
            onClick={() => void onAccept()}
            disabled={busy}
          >
            {t("ai.accept")}
          </Button>
        )}
      </div>
    </div>
  );
};
