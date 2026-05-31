import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { aiProposalAccept, aiProposalList, aiProposalReject } from "../../../ipc/ai";
import { codebookTree as fetchCodebookTree } from "../../../ipc/codebook";
import {
  activeSuggestionReviewAtom,
  pendingProposalsAtom,
} from "../../../state/ai";
import { codebookTreeAtom } from "../../../state/codebook";
import { interviewContentVersionAtom } from "../../../state/interview";
import { activeTextSelectionAtom, selectedSpanIdAtom } from "../../../state/tagging";
import { Button } from "../../../components/Button/Button";
import styles from "./SuggestionReviewPopover.module.css";

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

export const SuggestionReviewPopover = () => {
  const { t } = useTranslation();
  const review = useAtomValue(activeSuggestionReviewAtom);
  const selection = useAtomValue(activeTextSelectionAtom);
  const setReview = useSetAtom(activeSuggestionReviewAtom);
  const setSelection = useSetAtom(activeTextSelectionAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const setInterviewContentVersion = useSetAtom(interviewContentVersionAtom);
  const setCodebookTree = useSetAtom(codebookTreeAtom);
  const setPendingProposals = useSetAtom(pendingProposalsAtom);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setResult(null);
  }, [review?.currentIndex]);

  const currentSuggestion =
    review && review.currentIndex >= 0 ? review.suggestions[review.currentIndex] ?? null : null;

  const progress = useMemo(() => {
    if (!review) return { accepted: 0, declined: 0, undecided: 0 };
    return review.decisions.reduce(
      (acc, decision) => {
        if (decision === "accepted") acc.accepted += 1;
        else if (decision === "declined") acc.declined += 1;
        else acc.undecided += 1;
        return acc;
      },
      { accepted: 0, declined: 0, undecided: 0 },
    );
  }, [review]);

  const closeReview = () => {
    setReview(null);
    setSelectedSpan(null);
    setSelection(null);
  };

  useEffect(() => {
    if (!review) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReview();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      closeReview();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [review]);

  const onCancelPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    closeReview();
  };

  const goToIndex = (nextIndex: number) => {
    if (!review) return;
    const suggestion = review.suggestions[nextIndex];
    if (!suggestion) return;
    setSelectedSpan(null);
    setReview({ ...review, currentIndex: nextIndex });
    setSelection({
      segmentId: suggestion.segmentId,
      startOffset: suggestion.startOffset,
      endOffset: suggestion.endOffset,
      text: "",
      anchorRect: null,
    });
  };

  const moveRelative = (delta: number) => {
    if (!review || review.suggestions.length === 0) return;
    goToIndex((review.currentIndex + delta + review.suggestions.length) % review.suggestions.length);
  };

  const decide = (decision: "accepted" | "declined") => {
    if (!review) return;
    const decisions = [...review.decisions];
    decisions[review.currentIndex] = decision;
    const nextUndecided = decisions.findIndex((value, index) => value === null && index > review.currentIndex);
    const fallbackUndecided = decisions.findIndex((value) => value === null);
    const nextIndex = nextUndecided >= 0 ? nextUndecided : fallbackUndecided >= 0 ? fallbackUndecided : review.currentIndex;
    const nextReview = { ...review, decisions, currentIndex: nextIndex };
    setReview(nextReview);
    const nextSuggestion = nextReview.suggestions[nextIndex];
    if (nextSuggestion) {
      setSelection({
        segmentId: nextSuggestion.segmentId,
        startOffset: nextSuggestion.startOffset,
        endOffset: nextSuggestion.endOffset,
        text: "",
        anchorRect: null,
      });
    }
  };

  const applyReview = async () => {
    if (!review) return;
    setBusy(true);
    setResult(null);
    try {
      const acceptedIndices = review.decisions
        .map((decision, index) => (decision === "accepted" ? index : -1))
        .filter((index) => index >= 0);
      if (acceptedIndices.length > 0) {
        await aiProposalAccept(review.proposalId, { span_indices: acceptedIndices });
      } else {
        await aiProposalReject(review.proposalId);
      }
      setInterviewContentVersion((value) => value + 1);
      setCodebookTree(await fetchCodebookTree());
      setPendingProposals(await aiProposalList());
      closeReview();
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!review || !currentSuggestion || !selection?.anchorRect) return null;

  const audioBar = document.querySelector<HTMLElement>('[data-audio-bar="true"]');
  const audioBarRect = audioBar?.getBoundingClientRect();
  const dockBottom = audioBarRect
    ? Math.max(8, window.innerHeight - audioBarRect.top + 8)
    : 88;

  const style: CSSProperties = {
    bottom: dockBottom,
    left: Math.max(8, Math.min(selection.anchorRect.left, window.innerWidth - 440)),
  };

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={style}
      data-tag-popover-root="true"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>
            {review.proposalKind === "pretag" ? t("ai.preTag") : t("ai.findMore")}
          </h3>
          <p className={styles.progress}>
            {t("ai.reviewingSuggestionProgress", {
              defaultValue: "Suggestion {{current}} of {{total}}",
              current: review.currentIndex + 1,
              total: review.suggestions.length,
            })}
          </p>
        </div>
        <Button onPointerDown={onCancelPointerDown} onClick={closeReview}>{t("common.cancel")}</Button>
      </div>

      <blockquote className={styles.quote}>
        {selection.text || t("ai.selectedRange", { defaultValue: "Selected range" })}
      </blockquote>

      <p className={styles.progress}>
        {currentSuggestion.kind === "extend_span"
          ? t("ai.extendExistingSpan", { defaultValue: "Extend existing span" })
          : t("ai.newSpanSuggestion", { defaultValue: "New span suggestion" })}
      </p>
      <div className={styles.tags}>
        {currentSuggestion.tagNames.map((tagName) => (
          <span key={tagName} className={styles.tag}>
            {tagName}
          </span>
        ))}
      </div>

      {currentSuggestion.rationale ? (
        <p className={styles.rationale}>{currentSuggestion.rationale}</p>
      ) : null}

      <p className={styles.summary}>
        {t("ai.reviewSummaryInline", {
          defaultValue: "Accepted: {{accepted}}, declined: {{declined}}, undecided: {{undecided}}",
          accepted: progress.accepted,
          declined: progress.declined,
          undecided: progress.undecided,
        })}
      </p>

      <div className={styles.actions}>
        <Button onClick={() => decide("declined")} disabled={busy}>
          {t("ai.reject", { defaultValue: "Decline" })}
        </Button>
        <Button variant="primary" onClick={() => decide("accepted")} disabled={busy}>
          {t("ai.accept", { defaultValue: "Accept" })}
        </Button>
        <span className={styles.spacer} />
        <div className={styles.nav}>
          <Button onClick={() => moveRelative(-1)} disabled={busy || review.suggestions.length < 2}>
            {t("common.previous", { defaultValue: "Previous" })}
          </Button>
          <Button onClick={() => moveRelative(1)} disabled={busy || review.suggestions.length < 2}>
            {t("common.next", { defaultValue: "Next" })}
          </Button>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.result}>{result ?? ""}</span>
        <Button
          variant="primary"
          onClick={() => void applyReview()}
          disabled={busy || progress.accepted + progress.declined === 0}
        >
          {progress.accepted > 0
            ? t("ai.applyReviewedSuggestions", { defaultValue: "Apply reviewed suggestions" })
            : t("ai.rejectReviewedSuggestions", { defaultValue: "Reject proposal" })}
        </Button>
      </div>
    </div>
  );
};
