import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  interviewListAtom,
  selectedInterviewIdAtom,
} from "../../../state/interview";
import { activeTagForFindMoreAtom } from "../../../state/tagging";
import { transcriptionRunsAtom } from "../../../state/transcription";
import {
  activeAiOperationsAtom,
  aiRunHistoryAtom,
  skipCostConfirmAtom,
  pendingProposalsAtom,
} from "../../../state/ai";
import {
  aiCodebookGenStart,
  aiPretagStart,
  aiFindMoreStart,
  aiCostEstimate,
  aiProposalList,
  aiRunList,
  type AiRunDTO,
  type CostEstimate,
  type ProposalKind,
} from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import { CostPreviewModal } from "../AI/CostPreviewModal";
import styles from "./AiMenu.module.css";

type PendingAction =
  | {
      kind: "codebook_gen";
      args: { interview_ids: number[]; include_existing_codebook: boolean };
    }
  | { kind: "pretag"; args: { interview_id: number } }
  | { kind: "find_more"; args: { tag_id: number; interview_id: number } };

type DisplayOperation = {
  id: string;
  kind: ProposalKind | "transcribe";
  status: "running" | "complete" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  model: string | null;
  summary: string | null;
  error: string | null;
  label?: string;
  interviewId: number | null;
};

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const isTranscriptionRunning = (
  stage: import("../../../ipc/transcribe").TranscriptionProgress["stage"],
) =>
  stage === "starting" ||
  stage === "normalizing" ||
  stage === "chunking" ||
  stage === "transcribing_chunk" ||
  stage === "chunk_complete";

const formatTimestamp = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const AiMenu = () => {
  const { t } = useTranslation();
  const interviews = useAtomValue(interviewListAtom);
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const activeTagId = useAtomValue(activeTagForFindMoreAtom);
  const transcriptionRuns = useAtomValue(transcriptionRunsAtom);
  const setProposals = useSetAtom(pendingProposalsAtom);
  const skip = useAtomValue(skipCostConfirmAtom);
  const setSkip = useSetAtom(skipCostConfirmAtom);
  const aiRuns = useAtomValue(aiRunHistoryAtom);
  const setAiRuns = useSetAtom(aiRunHistoryAtom);
  const activeOps = useAtomValue(activeAiOperationsAtom);
  const setActiveOps = useSetAtom(activeAiOperationsAtom);
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const refreshProposals = async () => setProposals(await aiProposalList());
  const refreshRuns = async () => setAiRuns(await aiRunList());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const runs = await aiRunList();
        if (!cancelled) setAiRuns(runs);
      } catch {
        // best-effort only
      }
    };
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [setAiRuns]);

  const startLocalOperation = (
    kind: ProposalKind,
    interviewId: number | null,
  ): string => {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActiveOps((prev) => [
      {
        id,
        kind,
        startedAt: new Date().toISOString(),
        interviewId,
        label: t(`ai.kinds.${kind}`),
      },
      ...prev,
    ]);
    return id;
  };

  const finishLocalOperation = (id: string) => {
    setActiveOps((prev) => prev.filter((op) => op.id !== id));
  };

  const actuallyStart = async (action: PendingAction) => {
    const localId = startLocalOperation(
      action.kind,
      "interview_id" in action.args ? action.args.interview_id : null,
    );
    setBusy(true);
    setStatus(t("ai.running"));
    try {
      if (action.kind === "codebook_gen") {
        await aiCodebookGenStart(
          action.args.interview_ids,
          action.args.include_existing_codebook,
        );
      } else if (action.kind === "pretag") {
        await aiPretagStart(action.args.interview_id);
      } else {
        await aiFindMoreStart(action.args.tag_id, action.args.interview_id);
      }
      await Promise.all([refreshProposals(), refreshRuns()]);
      setStatus(null);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setStatus(errorMessage(e));
    } finally {
      finishLocalOperation(localId);
      setBusy(false);
      setPendingAction(null);
      setEstimate(null);
    }
  };

  const launch = async (action: PendingAction) => {
    if (skip[action.kind]) {
      await actuallyStart(action);
      return;
    }
    try {
      const est = await aiCostEstimate(
        action.kind as ProposalKind,
        action.args,
      );
      setEstimate(est);
      setPrompt("");
      setPendingAction(action);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };

  const onSendFromModal = async (dontAsk: boolean) => {
    const action = pendingAction;
    setPendingAction(null);
    setEstimate(null);
    if (!action) return;
    if (dontAsk) {
      setSkip({ ...skip, [action.kind]: true });
    }
    await actuallyStart(action);
  };

  const onCancelModal = () => {
    setPendingAction(null);
    setEstimate(null);
  };

  const onGenerateCodebook = () => {
    setOpen(false);
    if (interviews.length === 0) {
      setStatus(t("ai.selectInterviewFirst"));
      return;
    }
    const ids =
      selectedInterviewId !== null
        ? [selectedInterviewId]
        : interviews.map((i) => i.id);
    void launch({
      kind: "codebook_gen",
      args: { interview_ids: ids, include_existing_codebook: true },
    });
  };

  const onPreTag = () => {
    setOpen(false);
    if (selectedInterviewId === null) {
      setStatus(t("ai.selectInterviewFirst"));
      return;
    }
    void launch({
      kind: "pretag",
      args: { interview_id: selectedInterviewId },
    });
  };

  const onFindMore = () => {
    setOpen(false);
    if (activeTagId === null) {
      setStatus(t("ai.selectTag"));
      return;
    }
    if (selectedInterviewId === null) {
      setStatus(t("ai.selectInterviewFirst"));
      return;
    }
    void launch({
      kind: "find_more",
      args: { tag_id: activeTagId, interview_id: selectedInterviewId },
    });
  };

  const transcriptionOps = useMemo<DisplayOperation[]>(() => {
    return Object.entries(transcriptionRuns)
      .filter(([, run]) => isTranscriptionRunning(run.lastProgress.stage))
      .map(([interviewId, run]) => {
        let label = t("workspace.transcribing");
        if (run.lastProgress.stage === "transcribing_chunk") {
          label = t("workspace.transcribingChunk", {
            index: run.lastProgress.index + 1,
            total: run.lastProgress.total,
          });
        }
        return {
          id: `transcribe-live-${interviewId}`,
          kind: "transcribe",
          status: "running",
          startedAt: new Date(run.updatedAt).toISOString(),
          completedAt: null,
          model: null,
          summary: null,
          error: null,
          label,
          interviewId: Number(interviewId),
        };
      });
  }, [t, transcriptionRuns]);

  const displayedOps = useMemo<DisplayOperation[]>(() => {
    const liveTranscribeIds = new Set(
      transcriptionOps.map((op) => op.interviewId).filter((id) => id !== null),
    );
    const localOps = activeOps.map<DisplayOperation>((op) => ({
      id: op.id,
      kind: op.kind,
      status: "running",
      startedAt: op.startedAt,
      completedAt: null,
      model: null,
      summary: null,
      error: null,
      label: op.label,
      interviewId: op.interviewId,
    }));
    const persisted = aiRuns
      .filter(
        (run) =>
          !(run.kind === "transcribe" &&
            run.status === "running" &&
            run.interviewId !== null &&
            liveTranscribeIds.has(run.interviewId)),
      )
      .map((run: AiRunDTO): DisplayOperation => ({
        id: `run-${run.id}`,
        kind: run.kind,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        model: run.model,
        summary: run.resultSummary,
        error: run.error,
        interviewId: run.interviewId,
      }));
    return [...localOps, ...transcriptionOps, ...persisted].slice(0, 12);
  }, [activeOps, aiRuns, transcriptionOps]);

  const hasOngoing =
    activeOps.length > 0 ||
    transcriptionOps.length > 0 ||
    aiRuns.some((run) => run.status === "running");

  return (
    <div className={styles.root} ref={containerRef}>
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.trigger}
      >
        <span className={styles.triggerContent}>
          {hasOngoing && <span className={styles.loader} aria-hidden="true" />}
          <span>{t("ai.menuLabel", { defaultValue: "AI" })}</span>
          <span aria-hidden="true">▾</span>
        </span>
      </Button>
      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={onGenerateCodebook}
            disabled={busy}
          >
            {t("ai.generateCodebook")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={onPreTag}
            disabled={busy || selectedInterviewId === null}
          >
            {t("ai.preTag")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={onFindMore}
            disabled={busy || activeTagId === null}
          >
            {t("ai.findMore")}
          </button>
          <div className={styles.separator} />
          <div className={styles.opsHeaderRow}>
            <span className={styles.opsHeader}>{t("ai.opsTitle")}</span>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => void refreshRuns()}
            >
              {t("ai.refreshOps")}
            </button>
          </div>
          {displayedOps.length === 0 ? (
            <p className={styles.emptyOps}>{t("ai.noOperations")}</p>
          ) : (
            <ul className={styles.opsList}>
              {displayedOps.map((op) => (
                <li key={op.id} className={styles.opsItem}>
                  <div className={styles.opsTopRow}>
                    <span className={styles.kind}>{t(`ai.kinds.${op.kind}`)}</span>
                    <span
                      className={`${styles.statusBadge} ${styles[`status_${op.status}`]}`}
                    >
                      {op.status === "running" && (
                        <span className={styles.loaderInline} aria-hidden="true" />
                      )}
                      {t(`ai.status.${op.status}`)}
                    </span>
                  </div>
                  {op.label && <div className={styles.summary}>{op.label}</div>}
                  {op.summary && <div className={styles.summary}>{op.summary}</div>}
                  {op.error && <div className={styles.error}>{op.error}</div>}
                  <div className={styles.meta}>
                    <span>
                      {t("ai.startedAt")}: {formatTimestamp(op.startedAt)}
                    </span>
                    {op.completedAt && (
                      <span>
                        {t("ai.completedAt")}: {formatTimestamp(op.completedAt)}
                      </span>
                    )}
                    {op.model && <span>{op.model}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status && <span className={styles.status}>{status}</span>}
      {pendingAction && estimate && (
        <CostPreviewModal
          estimate={estimate}
          prompt={prompt}
          onSend={onSendFromModal}
          onCancel={onCancelModal}
        />
      )}
    </div>
  );
};
