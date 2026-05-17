import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  aiCodebookGenStart,
  aiCostEstimate,
  aiPretagStart,
  aiProposalList,
  aiRunList,
  type CostEstimate,
  type ProposalKind,
} from "../../../ipc/ai";
import {
  interviewDelete,
  interviewList as fetchList,
  interviewSetAudio,
} from "../../../ipc/interview";
import { speakerListForInterview } from "../../../ipc/speaker";
import { spanListForInterview } from "../../../ipc/tagging";
import { transcribeCancel } from "../../../ipc/transcribe";
import {
  activeAiOperationsAtom,
  aiRunHistoryAtom,
  pendingProposalsAtom,
  skipCostConfirmAtom,
} from "../../../state/ai";
import {
  interviewListAtom,
  selectedInterviewIdAtom,
} from "../../../state/interview";
import { transcriptionRunsAtom } from "../../../state/transcription";
import { Button } from "../../../components/Button/Button";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { Modal } from "../../../components/Modal/Modal";
import { CostPreviewModal } from "../AI/CostPreviewModal";
import { EditInterviewModal } from "./EditInterviewModal";
import styles from "./InterviewList.module.css";
import type { Interview } from "../../../ipc/interview";

const PersonIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={styles.metaIcon}
    aria-hidden="true"
  >
    <path d="M16 20a4 4 0 0 0-8 0" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const TagIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={styles.metaIcon}
    aria-hidden="true"
  >
    <path d="M20 10 10 20l-6-6V4h10z" />
    <circle cx="14.5" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
    <path d="M12 6h6a2 2 0 0 1 2 2v6" />
  </svg>
);

type InterviewListProps = {
  onAddInterview: () => void;
  onSelectInterview?: (interview: Interview) => void;
};

export const InterviewList = ({ onAddInterview, onSelectInterview }: InterviewListProps) => {
  const { t } = useTranslation();
  const [list, setList] = useAtom(interviewListAtom);
  const [selected, setSelected] = useAtom(selectedInterviewIdAtom);
  const runs = useAtomValue(transcriptionRunsAtom);
  const skip = useAtomValue(skipCostConfirmAtom);
  const setSkip = useSetAtom(skipCostConfirmAtom);
  const setProposals = useSetAtom(pendingProposalsAtom);
  const aiRuns = useAtomValue(aiRunHistoryAtom);
  const setAiRuns = useSetAtom(aiRunHistoryAtom);
  const activeOps = useAtomValue(activeAiOperationsAtom);
  const setActiveOps = useSetAtom(activeAiOperationsAtom);
  const [pendingAction, setPendingAction] = useState<{
    interview: Interview;
    kind: ProposalKind;
  } | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakerNamesByInterviewId, setSpeakerNamesByInterviewId] = useState<Record<number, string>>({});
  const [taggedSegmentCountByInterviewId, setTaggedSegmentCountByInterviewId] = useState<Record<number, number>>({});

  useEffect(() => {
    void fetchList().then(setList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (list.length === 0) {
      setSpeakerNamesByInterviewId({});
      setTaggedSegmentCountByInterviewId({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      list.map(async (interview) => {
        const [speakers, spans] = await Promise.all([
          speakerListForInterview(interview.id),
          spanListForInterview(interview.id),
        ]);
        const names = Array.from(
          new Set(
            speakers
              .map((speaker) => speaker.effectiveName.trim())
              .filter(Boolean),
          ),
        );
        return {
          interviewId: interview.id,
          speakerNames: names.join(", "),
          taggedSegmentCount: spans.length,
        };
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setSpeakerNamesByInterviewId(
          Object.fromEntries(entries.map(({ interviewId, speakerNames }) => [interviewId, speakerNames])),
        );
        setTaggedSegmentCountByInterviewId(
          Object.fromEntries(entries.map(({ interviewId, taggedSegmentCount }) => [interviewId, taggedSegmentCount])),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSpeakerNamesByInterviewId({});
        setTaggedSegmentCountByInterviewId({});
      });

    return () => {
      cancelled = true;
    };
  }, [list]);

  const refreshProposals = async () => setProposals(await aiProposalList());
  const refreshRuns = async () => setAiRuns(await aiRunList());

  const startLocalOperation = (
    kind: ProposalKind,
    interviewId: number,
    interviewName: string,
  ): string => {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActiveOps((prev) => [
      {
        id,
        runId: null,
        kind,
        startedAt: new Date().toISOString(),
        interviewId,
        label: t("ai.operationWithInterview", {
          kind: t(`ai.kinds.${kind}`),
          name: interviewName,
        }),
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

  const startInterviewAiAction = async (
    interview: Interview,
    kind: ProposalKind,
  ) => {
    const localId = startLocalOperation(kind, interview.id, interview.name);
    try {
      const runId =
        kind === "codebook_gen"
          ? await aiCodebookGenStart([interview.id], true)
          : await aiPretagStart(interview.id);
      setLocalOperationRunId(localId, runId);
      await Promise.all([refreshProposals(), refreshRuns()]);
    } catch (e) {
      await refreshRuns().catch(() => undefined);
      setError(String((e as { message?: string }).message ?? e));
    } finally {
      finishLocalOperation(localId);
    }
  };

  const onInterviewAiAction = async (interview: Interview, kind: ProposalKind) => {
    setSelected(interview.id);
    const hasRunningOperation =
      activeOps.some((op) => op.kind === kind && op.interviewId === interview.id) ||
      aiRuns.some(
        (run) =>
          run.status === "running" &&
          run.kind === kind &&
          run.interviewId === interview.id,
      );
    if (hasRunningOperation) {
      return;
    }
    if (skip[kind]) {
      await startInterviewAiAction(interview, kind);
      return;
    }
    try {
      const args =
        kind === "codebook_gen"
          ? { interview_ids: [interview.id], include_existing_codebook: true }
          : { interview_id: interview.id };
      const nextEstimate = await aiCostEstimate(kind, args);
      setPendingAction({ interview, kind });
      setEstimate(nextEstimate);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  const onCancelModal = () => {
    setPendingAction(null);
    setEstimate(null);
  };

  const onSendFromModal = async (dontAsk: boolean) => {
    const action = pendingAction;
    setPendingAction(null);
    setEstimate(null);
    if (!action) return;
    if (dontAsk) {
      setSkip({ ...skip, [action.kind]: true });
    }
    await startInterviewAiAction(action.interview, action.kind);
  };

  return (
    <div className={styles.wrap}>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {list.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>{t("workspace.noInterviews")}</p>
          <Button variant="primary" onClick={onAddInterview}>
            {t("workspace.createInterview", { defaultValue: "Add interview" })}
          </Button>
        </div>
      ) : (
        <ul className={styles.list}>
          {list.map((i) => (
            <InterviewRow
              key={i.id}
              iv={i}
              selected={selected === i.id}
              onSelect={() => setSelected(i.id)}
              onActivate={() => {
                setSelected(i.id);
                onSelectInterview?.(i);
              }}
              onDeriveCodebook={() => void onInterviewAiAction(i, "codebook_gen")}
              onPretag={() => void onInterviewAiAction(i, "pretag")}
              progress={runs[i.id]}
              activeOps={activeOps}
              aiRuns={aiRuns}
              speakerNames={speakerNamesByInterviewId[i.id] ?? ""}
              taggedSegmentCount={taggedSegmentCountByInterviewId[i.id] ?? 0}
            />
          ))}
        </ul>
      )}
      {pendingAction && estimate && (
        <CostPreviewModal
          estimate={estimate}
          prompt=""
          onSend={onSendFromModal}
          onCancel={onCancelModal}
        />
      )}
    </div>
  );
};

type RowProps = {
  iv: Interview;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onDeriveCodebook: () => void;
  onPretag: () => void;
  progress?: import("../../../state/transcription").RunSnapshot;
  activeOps: import("../../../state/ai").LocalAiOperation[];
  aiRuns: Awaited<ReturnType<typeof aiRunList>>;
  speakerNames: string;
  taggedSegmentCount: number;
};

const InterviewRow = ({
  iv,
  selected,
  onSelect,
  onActivate,
  onDeriveCodebook,
  onPretag,
  progress,
  activeOps,
  aiRuns,
  speakerNames,
  taggedSegmentCount,
}: RowProps) => {
  const { t } = useTranslation();
  const setList = useSetAtom(interviewListAtom);
  const setSelectedInterviewId = useSetAtom(selectedInterviewIdAtom);
  const status = iv.transcriptStatus;
  const hasAudio = iv.audioPath !== null;
  const isInProgress = status === "in_progress" || progress?.lastProgress.stage === "starting"
    || progress?.lastProgress.stage === "analyzing_source"
    || progress?.lastProgress.stage === "preparing_chunks"
    || progress?.lastProgress.stage === "encoding_chunk"
    || progress?.lastProgress.stage === "transcribing_chunk"
    || progress?.lastProgress.stage === "composing_transcript";

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLSpanElement | null>(null);

  const isAiActionRunning = useMemo(
    () => (kind: ProposalKind) =>
      activeOps.some((op) => op.kind === kind && op.interviewId === iv.id) ||
      aiRuns.some(
        (run) =>
          run.status === "running" &&
          run.kind === kind &&
          run.interviewId === iv.id,
      ),
    [activeOps, aiRuns, iv.id],
  );

  const isCodebookRunning = isAiActionRunning("codebook_gen");
  const isPretagRunning = isAiActionRunning("pretag");
  const taggedSegmentsLabel = t("interview.taggedSegments", {
    defaultValue: "Tagged segments",
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const onCancel = async () => {
    try {
      await transcribeCancel(iv.id);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  const addAudio = async () => {
    setMenuOpen(false);
    try {
      const p = await openDialog({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "aac"] }],
      });
      if (!p || Array.isArray(p)) return;
      await interviewSetAudio(iv.id, p);
      setList(await fetchList());
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  const doDeleteInterview = async () => {
    try {
      await interviewDelete(iv.id);
      setList((prev) => prev.filter((item) => item.id !== iv.id));
      setSelectedInterviewId((prev) => (prev === iv.id ? null : prev));
      setConfirmDelete(false);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    }
  };

  const renderRight = () => {
    if (isInProgress) {
      let label = t("workspace.transcribing");
      const p = progress?.lastProgress;
      if (p?.stage === "encoding_chunk") {
        label = t("ai.operationStageProgress", {
          stage: t("ai.operationStages.encode_chunks"),
          completed: p.index + 1,
          total: p.total,
        });
      } else if (p?.stage === "transcribing_chunk") {
        label = t("ai.operationStageProgress", {
          stage: t("ai.operationStages.transcribe_chunks"),
          completed: p.index + 1,
          total: p.total,
        });
      } else if (p?.stage === "preparing_chunks") {
        label = t("ai.operationStageProgress", {
          stage: t("ai.operationStages.prepare_chunks"),
          completed: p.total_chunks,
          total: p.total_chunks,
        });
      } else if (p?.stage === "composing_transcript") {
        label = t("ai.operationStages.compose_transcript");
      }
      return (
        <span className={styles.rowRight}>
          <span className={styles.progressLabel}>{label}</span>
          <button className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); void onCancel(); }}>
            {t("workspace.cancel")}
          </button>
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className={styles.rowRight}>
          <span className={styles.statusFailed}>{t("workspace.transcriptFailed")}</span>
        </span>
      );
    }
    return null;
  };

  return (
    <li>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      <div
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
          setMenuOpen(true);
        }}
      >
        <span className={styles.rowLeft}>
          <button
            type="button"
            className={styles.titleButton}
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
            }}
          >
            <span className={styles.rowTitle}>{iv.name}</span>
          </button>
          {speakerNames || taggedSegmentCount >= 0 ? (
            <span className={styles.rowSubtitle}>
              {speakerNames ? (
                <span className={styles.speakerNames}>
                  <PersonIcon />
                  <span>{speakerNames}</span>
                </span>
              ) : null}
              {speakerNames ? <span aria-hidden="true"> · </span> : null}
              <span
                className={styles.taggedCount}
                title={taggedSegmentsLabel}
                aria-label={`${taggedSegmentsLabel}: ${taggedSegmentCount}`}
              >
                <TagIcon />
                <span>{taggedSegmentCount}</span>
              </span>
            </span>
          ) : null}
        </span>
        {renderRight()}
        <span className={styles.menuWrap} ref={menuWrapRef}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={t("interview.menu", { defaultValue: "Interview actions" }) as string}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            {"⋯"}
          </button>
          {menuOpen && (
            <div className={styles.menuDropdown} role="menu">
              {!hasAudio && (
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); void addAudio(); }}
                >
                  {t("audio.add", { defaultValue: "Add audio…" })}
                </button>
              )}
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                disabled={isCodebookRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onSelect();
                  onDeriveCodebook();
                }}
              >
                <span className={styles.menuItemContent}>
                  {isCodebookRunning && <span className={styles.loaderInline} aria-hidden="true" />}
                  <span>{t("ai.generateCodebook")}</span>
                </span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                disabled={isPretagRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onSelect();
                  onPretag();
                }}
              >
                <span className={styles.menuItemContent}>
                  {isPretagRunning && <span className={styles.loaderInline} aria-hidden="true" />}
                  <span>{t("ai.preTag")}</span>
                </span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setEditOpen(true); }}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }}
              >
                {t("common.delete")}
              </button>
            </div>
          )}
        </span>
      </div>
      {editOpen && <EditInterviewModal interview={iv} onClose={() => setEditOpen(false)} />}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("interview.confirmDelete", {
          name: iv.name,
          defaultValue: 'Delete "{{name}}"?',
        })}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button variant="danger" onClick={() => void doDeleteInterview()}>
              {t("common.delete", { defaultValue: "Delete" })}
            </Button>
          </>
        }
      >
        <p>
          {t("interview.confirmDeleteBody", {
            defaultValue:
              "This will permanently delete the interview, transcript, audio, and tagged spans.",
          })}
        </p>
      </Modal>
    </li>
  );
};
