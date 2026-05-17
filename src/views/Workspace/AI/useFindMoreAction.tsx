import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  aiCostEstimate,
  aiFindMoreStart,
  aiProposalList,
  aiRunList,
  type CostEstimate,
} from "../../../ipc/ai";
import {
  activeAiOperationsAtom,
  aiRunHistoryAtom,
  pendingProposalsAtom,
  skipCostConfirmAtom,
} from "../../../state/ai";
import {
  effectiveSelectedInterviewIdAtom,
  interviewListAtom,
} from "../../../state/interview";
import { CostPreviewModal } from "./CostPreviewModal";

type PendingFindMoreAction = {
  tagId: number;
  tagName?: string | null;
  interviewIds: number[];
};

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const aggregateEstimate = (estimates: CostEstimate[]): CostEstimate => {
  const [first] = estimates;
  return estimates.slice(1).reduce(
    (acc, estimate) => ({
      ...acc,
      pricingKnown: acc.pricingKnown && estimate.pricingKnown,
      estimatedInputTokens: acc.estimatedInputTokens + estimate.estimatedInputTokens,
      estimatedOutputTokens: acc.estimatedOutputTokens + estimate.estimatedOutputTokens,
      estimatedUsd: acc.estimatedUsd + estimate.estimatedUsd,
    }),
    first,
  );
};

export const useFindMoreAction = () => {
  const { t } = useTranslation();
  const interviews = useAtomValue(interviewListAtom);
  const selectedInterviewId = useAtomValue(effectiveSelectedInterviewIdAtom);
  const setProposals = useSetAtom(pendingProposalsAtom);
  const setAiRuns = useSetAtom(aiRunHistoryAtom);
  const setActiveOps = useSetAtom(activeAiOperationsAtom);
  const skip = useAtomValue(skipCostConfirmAtom);
  const setSkip = useSetAtom(skipCostConfirmAtom);
  const [pendingAction, setPendingAction] = useState<PendingFindMoreAction | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshProposals = async () => setProposals(await aiProposalList());
  const refreshRuns = async () => setAiRuns(await aiRunList());

  const interviewName = (interviewId: number) =>
    interviews.find((interview) => interview.id === interviewId)?.name ?? `#${interviewId}`;

  const findMoreTitle = (tagName?: string | null) =>
    tagName
      ? t("ai.findMoreTagTitle", {
          name: tagName,
          defaultValue: 'Find more "{{name}}"',
        })
      : t("ai.kinds.find_more");

  const startLocalOperation = (interviewId: number, tagName?: string | null) => {
    const id = `find_more-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActiveOps((prev) => [
      {
        id,
        runId: null,
        kind: "find_more",
        startedAt: new Date().toISOString(),
        interviewId,
        label: t("ai.running"),
        title: findMoreTitle(tagName),
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

  const actuallyStart = async (action: PendingFindMoreAction) => {
    setBusy(true);
    setStatus(t("ai.running"));
    const errors: string[] = [];

    try {
      for (const interviewId of action.interviewIds) {
        const localId = startLocalOperation(interviewId, action.tagName);
        try {
          const runId = await aiFindMoreStart(action.tagId, interviewId);
          setLocalOperationRunId(localId, runId);
        } catch (e) {
          errors.push(`${interviewName(interviewId)}: ${errorMessage(e)}`);
        } finally {
          finishLocalOperation(localId);
        }
      }
      await Promise.all([refreshProposals(), refreshRuns()]);
      setStatus(errors.length > 0 ? errors.join(" · ") : null);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
      setPendingAction(null);
      setEstimate(null);
    }
  };

  const requestStart = async (
    tagId: number | null,
    interviewIds: number[],
    tagName?: string | null,
  ) => {
    if (tagId === null) {
      setStatus(t("ai.selectTag"));
      return;
    }
    if (interviewIds.length === 0) {
      setStatus(t("ai.selectAtLeastOneInterview", { defaultValue: "Select at least one interview" }));
      return;
    }

    const action = { tagId, tagName, interviewIds };
    if (skip.find_more) {
      await actuallyStart(action);
      return;
    }

    try {
      const estimates = await Promise.all(
        interviewIds.map((interviewId) =>
          aiCostEstimate("find_more", {
            tag_id: tagId,
            interview_id: interviewId,
          }),
        ),
      );
      setEstimate(aggregateEstimate(estimates));
      setPendingAction(action);
      setStatus(null);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };

  const launchFindMore = async (
    tagId: number | null,
    interviewId = selectedInterviewId,
    tagName?: string | null,
  ) => {
    await requestStart(tagId, interviewId === null ? [] : [interviewId], tagName);
  };

  const launchFindMoreForInterviews = async (
    tagId: number | null,
    interviewIds: number[],
    tagName?: string | null,
  ) => {
    await requestStart(tagId, interviewIds, tagName);
  };

  const onSendFromModal = async (dontAsk: boolean) => {
    const action = pendingAction;
    setPendingAction(null);
    setEstimate(null);
    if (!action) return;
    if (dontAsk) {
      setSkip({ ...skip, find_more: true });
    }
    await actuallyStart(action);
  };

  const onCancelModal = () => {
    setPendingAction(null);
    setEstimate(null);
  };

  return {
    busy,
    status,
    clearStatus: () => setStatus(null),
    launchFindMore,
    launchFindMoreForInterviews,
    costPreviewModal:
      pendingAction && estimate ? (
        <CostPreviewModal
          estimate={estimate}
          prompt=""
          onSend={(dontAsk) => void onSendFromModal(dontAsk)}
          onCancel={onCancelModal}
        />
      ) : null,
  };
};
