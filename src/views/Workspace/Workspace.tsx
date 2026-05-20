import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useParams } from "@tanstack/react-router";
import { projectOpen } from "../../ipc/project";
import { currentProjectAtom } from "../../state/project";
import { interviewList as fetchInterviews } from "../../ipc/interview";
import { historyRedo, historyStatus, historyUndo } from "../../ipc/history";
import { historyStatusAtom } from "../../state/history";
import {
  interviewContentVersionAtom,
  interviewListAtom,
  selectedInterviewAtom,
  selectedInterviewIdAtom,
} from "../../state/interview";
import { onTranscriptionProgress } from "../../ipc/transcribe";
import { transcriptionRunsAtom } from "../../state/transcription";
import { activeSuggestionReviewAtom } from "../../state/ai";
import {
  activeTextSelectionAtom,
  selectedSpanIdAtom,
} from "../../state/tagging";
import { Button } from "../../components/Button/Button";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { SearchableSelect } from "../../components/SearchableSelect/SearchableSelect";
import { CenterPane } from "./CenterPane/CenterPane";
import { RightPane } from "./RightPane/RightPane";
import styles from "./Workspace.module.css";

const RIGHT_PANE_WIDTH_STORAGE_KEY = "faden.workspace-right-pane-width";
const OPEN_SPAN_HANDOFF_STORAGE_KEY = "faden.workspace.open-span";
const DEFAULT_RIGHT_PANE_WIDTH = 320;

type WorkspaceHandoffPayload = {
  projectPath?: string;
  interviewId?: number;
  spanId?: number;
  selection?: {
    segmentId?: number;
    startOffset?: number;
    endOffset?: number;
    text?: string;
  };
  review?: {
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
const MIN_RIGHT_PANE_WIDTH = 240;
const MAX_RIGHT_PANE_WIDTH = 520;
const MIN_CENTER_PANE_WIDTH = 320;
const KEYBOARD_RESIZE_STEP = 24;

const clampRightPaneWidth = (width: number, containerWidth: number) => {
  if (!Number.isFinite(width)) return DEFAULT_RIGHT_PANE_WIDTH;
  const maxWidth = Math.min(
    MAX_RIGHT_PANE_WIDTH,
    Math.max(MIN_RIGHT_PANE_WIDTH, containerWidth - MIN_CENTER_PANE_WIDTH),
  );
  return Math.min(Math.max(width, MIN_RIGHT_PANE_WIDTH), maxWidth);
};

const readStoredRightPaneWidth = () => {
  if (typeof window === "undefined") return DEFAULT_RIGHT_PANE_WIDTH;
  const raw = window.localStorage.getItem(RIGHT_PANE_WIDTH_STORAGE_KEY);
  if (raw === null) return DEFAULT_RIGHT_PANE_WIDTH;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_RIGHT_PANE_WIDTH;
};

export const Workspace = () => {
  const { t } = useTranslation();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const [project, setProject] = useAtom(currentProjectAtom);
  const [historyState, setHistoryState] = useAtom(historyStatusAtom);
  const setRuns = useSetAtom(transcriptionRunsAtom);
  const setInterviews = useSetAtom(interviewListAtom);
  const interviews = useAtomValue(interviewListAtom);
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const selectedInterview = useAtomValue(selectedInterviewAtom);
  const selectedSpanId = useAtomValue(selectedSpanIdAtom);
  const bumpInterviewContentVersion = useSetAtom(interviewContentVersionAtom);
  const setActiveSelection = useSetAtom(activeTextSelectionAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const setSelectedInterviewId = useSetAtom(selectedInterviewIdAtom);
  const setActiveSuggestionReview = useSetAtom(activeSuggestionReviewAtom);
  const [mobilePane, setMobilePane] = useState<"edits" | "right">("edits");
  const [rightPaneWidth, setRightPaneWidth] = useState(readStoredRightPaneWidth);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const panesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  useEffect(() => {
    void fetchInterviews().then(setInterviews);
  }, [projectPath, setInterviews]);

  useEffect(() => {
    const raw = window.localStorage.getItem(OPEN_SPAN_HANDOFF_STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as WorkspaceHandoffPayload;
      if (payload.projectPath !== decodeURIComponent(projectPath)) return;
      if (typeof payload.interviewId === "number") {
        setSelectedInterviewId(payload.interviewId);
      }
      if (payload.review) {
        setActiveSuggestionReview(payload.review);
      } else {
        setActiveSuggestionReview(null);
      }
      if (typeof payload.spanId === "number") {
        setActiveSelection(null);
        setSelectedSpan(payload.spanId);
        window.dispatchEvent(new Event("workspace:open-right-pane"));
      } else if (
        typeof payload.selection?.segmentId === "number" &&
        typeof payload.selection?.startOffset === "number" &&
        typeof payload.selection?.endOffset === "number"
      ) {
        setSelectedSpan(null);
        setActiveSelection({
          segmentId: payload.selection.segmentId,
          startOffset: payload.selection.startOffset,
          endOffset: payload.selection.endOffset,
          text: payload.selection.text ?? "",
          anchorRect: null,
        });
      }
      window.localStorage.removeItem(OPEN_SPAN_HANDOFF_STORAGE_KEY);
    } catch {
      window.localStorage.removeItem(OPEN_SPAN_HANDOFF_STORAGE_KEY);
    }
  }, [
    projectPath,
    setActiveSelection,
    setActiveSuggestionReview,
    setSelectedInterviewId,
    setSelectedSpan,
    interviews.length,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onTranscriptionProgress((p) => {
      setRuns((prev) => {
        if (p.stage === "complete" || p.stage === "failed" || p.stage === "cancelled") {
          if (!(p.interview_id in prev)) return prev;
          const next = { ...prev };
          delete next[p.interview_id];
          return next;
        }
        const existing = prev[p.interview_id];
        const runId = p.run_id ?? existing?.runId ?? null;
        const startedAt = p.stage === "starting" ? Date.now() : existing?.startedAt ?? Date.now();
        return {
          ...prev,
          [p.interview_id]: {
            runId,
            startedAt,
            lastProgress: p,
            updatedAt: Date.now(),
          },
        };
      });
      if (p.stage === "complete" || p.stage === "failed" || p.stage === "cancelled") {
        void fetchInterviews().then(setInterviews);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHistoryState = async () => {
    if (!project) {
      setHistoryState({ canUndo: false, canRedo: false });
      return;
    }
    setHistoryState(await historyStatus());
  };

  const refreshAfterHistoryMutation = () => {
    bumpInterviewContentVersion((value) => value + 1);
    setActiveSelection(null);
    void fetchInterviews().then(setInterviews);
  };

  const onUndo = async () => {
    await historyUndo();
    refreshAfterHistoryMutation();
  };

  const onRedo = async () => {
    await historyRedo();
    refreshAfterHistoryMutation();
  };

  useEffect(() => {
    void refreshHistoryState();
    const onHistoryChanged = () => {
      void refreshHistoryState();
    };
    window.addEventListener("stt:history-changed", onHistoryChanged);
    return () => window.removeEventListener("stt:history-changed", onHistoryChanged);
  }, [project]);

  useEffect(() => {
    if (selectedInterviewId !== null) {
      setMobilePane("edits");
    }
  }, [selectedInterviewId]);

  useEffect(() => {
    if (selectedSpanId === null) return;
    setMobilePane("right");
  }, [selectedSpanId]);

  useEffect(() => {
    const openRightPane = () => setMobilePane("right");
    window.addEventListener("workspace:open-right-pane", openRightPane);
    return () => window.removeEventListener("workspace:open-right-pane", openRightPane);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const isAccel = e.metaKey || e.ctrlKey;
      if (isAccel && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (historyState.canRedo) {
            void onRedo();
          }
        } else if (historyState.canUndo) {
          void onUndo();
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        window.dispatchEvent(new Event("faden:toggle-play"));
      } else if (e.key === "Escape") {
        setActiveSelection(null);
        setSelectedSpan(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyState.canRedo, historyState.canUndo, setActiveSelection, setSelectedSpan]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_PANE_WIDTH_STORAGE_KEY, String(rightPaneWidth));
  }, [rightPaneWidth]);

  useEffect(() => {
    const syncRightPaneWidth = () => {
      const containerWidth = panesRef.current?.getBoundingClientRect().width;
      if (!containerWidth) return;
      setRightPaneWidth((current) => clampRightPaneWidth(current, containerWidth));
    };

    syncRightPaneWidth();
    window.addEventListener("resize", syncRightPaneWidth);
    return () => window.removeEventListener("resize", syncRightPaneWidth);
  }, []);

  const interviewOptions = useMemo(
    () =>
      interviews.map((interview) => ({
        value: String(interview.id),
        label: interview.name,
        searchText: `${interview.name} ${interview.recordedAt ?? ""}`,
      })),
    [interviews],
  );

  const applyRightPaneWidth = (nextWidth: number) => {
    const containerWidth = panesRef.current?.getBoundingClientRect().width;
    if (!containerWidth) return;
    setRightPaneWidth(clampRightPaneWidth(nextWidth, containerWidth));
  };

  const onRightPaneResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(max-width: 760px)").matches) return;

    event.preventDefault();
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture(pointerId);
    setIsResizingRightPane(true);

    const updateWidthFromPointer = (clientX: number) => {
      const rect = panesRef.current?.getBoundingClientRect();
      if (!rect) return;
      applyRightPaneWidth(rect.right - clientX);
    };

    updateWidthFromPointer(event.clientX);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateWidthFromPointer(moveEvent.clientX);
    };

    const finishResize = () => {
      setIsResizingRightPane(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      finishResize();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const onRightPaneResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const containerWidth = panesRef.current?.getBoundingClientRect().width;
    if (!containerWidth) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setRightPaneWidth((current) => clampRightPaneWidth(current + KEYBOARD_RESIZE_STEP, containerWidth));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setRightPaneWidth((current) => clampRightPaneWidth(current - KEYBOARD_RESIZE_STEP, containerWidth));
    } else if (event.key === "Home") {
      event.preventDefault();
      setRightPaneWidth(clampRightPaneWidth(MAX_RIGHT_PANE_WIDTH, containerWidth));
    } else if (event.key === "End") {
      event.preventDefault();
      setRightPaneWidth(clampRightPaneWidth(MIN_RIGHT_PANE_WIDTH, containerWidth));
    }
  };

  const resetRightPaneWidth = () => applyRightPaneWidth(DEFAULT_RIGHT_PANE_WIDTH);

  return (
    <div className={styles.shell} data-resizing={isResizingRightPane ? "true" : undefined}>
      <ProjectHeader
        activeView="coding"
        viewAccessory={
          <SearchableSelect
            value={selectedInterview ? String(selectedInterview.id) : ""}
            options={interviewOptions}
            variant="header"
            placeholder={t("workspace.selectInterview", {
              defaultValue: "Select an interview to view its transcript.",
            })}
            searchPlaceholder={t("workspace.interviewSearch", {
              defaultValue: "Filter interviews",
            })}
            emptyText={t("workspace.noMatchingInterviews", {
              defaultValue: "No interviews found",
            })}
            onChange={(value) => setSelectedInterviewId(Number(value))}
          />
        }
        leftActions={
          <>
            <Button
              onClick={() => void onUndo()}
              disabled={!historyState.canUndo}
              className={styles.iconButton}
              title={t("workspace.undo", { defaultValue: "Undo" })}
              aria-label={t("workspace.undo", { defaultValue: "Undo" })}
            >
              <span aria-hidden="true">↶</span>
            </Button>
            <Button
              onClick={() => void onRedo()}
              disabled={!historyState.canRedo}
              className={styles.iconButton}
              title={t("workspace.redo", { defaultValue: "Redo" })}
              aria-label={t("workspace.redo", { defaultValue: "Redo" })}
            >
              <span aria-hidden="true">↷</span>
            </Button>
          </>
        }
      />
      <div className={styles.layout} data-mobile-pane={mobilePane}>
        <div className={styles.layoutInner}>
          <div
            ref={panesRef}
            className={styles.panes}
            style={{
              "--workspace-right-pane-width": `${rightPaneWidth}px`,
            } as CSSProperties}
          >
            <CenterPane />
            <div
              className={styles.resizer}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("workspace.rightPaneResizeHandle", {
                defaultValue: "Resize details panel",
              })}
              aria-valuemin={MIN_RIGHT_PANE_WIDTH}
              aria-valuemax={MAX_RIGHT_PANE_WIDTH}
              aria-valuenow={Math.round(rightPaneWidth)}
              tabIndex={0}
              title={t("workspace.rightPaneResizeHandleHint", {
                defaultValue:
                  "Drag to resize the details panel. Use Left/Right arrows to adjust, Home for wider, End for narrower.",
              })}
              onPointerDown={onRightPaneResizePointerDown}
              onKeyDown={onRightPaneResizeKeyDown}
              onDoubleClick={resetRightPaneWidth}
            />
            <RightPane />
          </div>
        </div>
      </div>
    </div>
  );
};