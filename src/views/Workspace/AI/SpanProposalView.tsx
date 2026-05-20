import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { aiProposalAccept, aiRunGet, type ProposalDTO } from "../../../ipc/ai";
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
  const isPending = proposal.status === "pending";

  useEffect(() => {
    let cancelled = false;
    void aiRunGet(proposal.aiRunId)
      .then((run) => {
        if (!cancelled) {
          setTargetInterviewId(run.interviewId);
        }
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
        {suggestions.map((s, i) => (
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
                seg {s.segment_id} [{s.start_offset}–{s.end_offset}]
              </span>
            </label>
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
        ))}
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
