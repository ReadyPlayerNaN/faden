import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  interviewListAtom,
  selectedInterviewIdAtom,
} from "../../../state/interview";
import { selectedCodebookNodeAtom } from "../../../state/codebook";
import {
  skipCostConfirmAtom,
  pendingProposalsAtom,
} from "../../../state/ai";
import {
  aiCodebookGenStart,
  aiPretagStart,
  aiFindMoreStart,
  aiCostEstimate,
  aiProposalList,
  type CostEstimate,
  type ProposalKind,
} from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import { CostPreviewModal } from "./CostPreviewModal";
import styles from "./AiPanel.module.css";

type PendingAction =
  | {
      kind: "codebook_gen";
      args: { interview_ids: number[]; include_existing_codebook: boolean };
    }
  | { kind: "pretag"; args: { interview_id: number } }
  | { kind: "find_more"; args: { tag_id: number; interview_id: number } };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

export const AiPanel = () => {
  const { t } = useTranslation();
  const interviews = useAtomValue(interviewListAtom);
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const selectedNode = useAtomValue(selectedCodebookNodeAtom);
  const setProposals = useSetAtom(pendingProposalsAtom);
  const skip = useAtomValue(skipCostConfirmAtom);
  const setSkip = useSetAtom(skipCostConfirmAtom);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshProposals = async () => setProposals(await aiProposalList());

  const actuallyStart = async (action: PendingAction) => {
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
      await refreshProposals();
      setStatus(null);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
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
    if (!selectedNode || selectedNode.kind !== "tag") {
      setStatus(t("ai.selectTag"));
      return;
    }
    if (selectedInterviewId === null) {
      setStatus(t("ai.selectInterviewFirst"));
      return;
    }
    void launch({
      kind: "find_more",
      args: { tag_id: selectedNode.id, interview_id: selectedInterviewId },
    });
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>{t("ai.panel")}</h3>
      <div className={styles.actions}>
        <Button onClick={onGenerateCodebook} disabled={busy}>
          {t("ai.generateCodebook")}
        </Button>
        <Button
          onClick={onPreTag}
          disabled={busy || selectedInterviewId === null}
        >
          {t("ai.preTag")}
        </Button>
        <Button
          onClick={onFindMore}
          disabled={busy || !selectedNode || selectedNode.kind !== "tag"}
        >
          {t("ai.findMore")}
        </Button>
      </div>
      {status && <p className={styles.status}>{status}</p>}
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
