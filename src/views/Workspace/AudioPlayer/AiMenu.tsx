import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { interviewListAtom } from "../../../state/interview";
import { currentProjectAtom } from "../../../state/project";
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
  aiProposalList,
  aiRunList,
  type CostEstimate,
  type ProposalKind,
} from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import {
  StatusMenu,
  StatusMenuEmpty,
  StatusMenuFooter,
  StatusMenuHeader,
} from "../../../components/StatusMenu/StatusMenu";
import { CostPreviewModal } from "../AI/CostPreviewModal";
import { buildDisplayOperations } from "../../AI/aiOperations";
import styles from "./AiMenu.module.css";

type PendingAction =
  | {
      kind: "codebook_gen";
      args: { interview_ids: number[]; include_existing_codebook: boolean };
    }
  | { kind: "pretag"; args: { interview_id: number } };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

export const AiMenu = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const interviews = useAtomValue(interviewListAtom);
  const project = useAtomValue(currentProjectAtom);
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
  const [prompt] = useState<string>("");
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
        runId: null,
        kind,
        startedAt: new Date().toISOString(),
        interviewId,
        label: t(`ai.kinds.${kind}`),
      },
      ...prev,
    ]);
    return id;
  };

  const setLocalOperationRunId = (id: string, runId: number) => {
    setActiveOps((prev) => prev.map((op) => (op.id === id ? { ...op, runId } : op)));
  };

  const finishLocalOperation = (id: string) => {
    setActiveOps((prev) => prev.filter((op) => op.id !== id));
  };

  const actuallyStart = async (action: PendingAction) => {
    const localId = startLocalOperation(
      action.kind,
      "interview_id" in action.args ? action.args.interview_id : null,
    );
    setStatus(t("ai.running"));
    try {
      const runId =
        action.kind === "codebook_gen"
          ? await aiCodebookGenStart(
              action.args.interview_ids,
              action.args.include_existing_codebook,
            )
          : await aiPretagStart(action.args.interview_id);
      setLocalOperationRunId(localId, runId);
      await Promise.all([refreshProposals(), refreshRuns()]);
      setStatus(null);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setStatus(errorMessage(e));
    } finally {
      finishLocalOperation(localId);
      setPendingAction(null);
      setEstimate(null);
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

  const { ongoing } = useMemo(
    () =>
      buildDisplayOperations({
        interviews,
        transcriptionRuns,
        activeOps,
        aiRuns,
        t,
      }),
    [activeOps, aiRuns, interviews, t, transcriptionRuns],
  );

  const runningCount = ongoing.length;
  const triggerTitle = t("ai.triggerTitle", { defaultValue: "Operations" });

  return (
    <div className={styles.root} ref={containerRef}>
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${triggerTitle} (${runningCount})`}
        title={triggerTitle}
        className={styles.trigger}
      >
        <span className={styles.triggerContent}>
          <span className={styles.triggerIcon} aria-hidden="true">⚙</span>
          <span className={styles.triggerCount} aria-label={`${runningCount} running operations`}>
            {runningCount}
          </span>
        </span>
      </Button>
      {open && (
        <StatusMenu role="menu">
          <StatusMenuHeader>
            {t("ai.ongoingTitle", { defaultValue: "Ongoing" })}
          </StatusMenuHeader>
          {ongoing.length === 0 ? (
            <StatusMenuEmpty>
              {t("ai.noOngoing", { defaultValue: "No ongoing operations" })}
            </StatusMenuEmpty>
          ) : (
            <ul className={styles.ongoingList}>
              {ongoing.map((op) => (
                <li key={op.id} className={styles.ongoingItem}>
                  <span className={styles.loaderInline} aria-hidden="true" />
                  <span className={styles.ongoingLabel}>{op.title}</span>
                </li>
              ))}
            </ul>
          )}
          <StatusMenuFooter>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (!project) return;
                void navigate({
                  to: "/workspace/$projectPath/ai-ops",
                  params: { projectPath: encodeURIComponent(project.path) },
                });
              }}
              disabled={!project}
            >
              {t("ai.viewAllOps", { defaultValue: "Open AI ops" })}
            </button>
          </StatusMenuFooter>
        </StatusMenu>
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
