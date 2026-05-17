import { useEffect, useMemo, useState } from "react";
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
  const [mobilePane, setMobilePane] = useState<"edits" | "right">("edits");

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
    let unlisten: (() => void) | null = null;
    void onTranscriptionProgress((p) => {
      setRuns((prev) => {
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

  const interviewOptions = useMemo(
    () =>
      interviews.map((interview) => ({
        value: String(interview.id),
        label: interview.name,
        searchText: `${interview.name} ${interview.recordedAt ?? ""}`,
      })),
    [interviews],
  );

  return (
    <div className={styles.shell}>
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
        <div className={styles.panes}>
          <CenterPane />
          <RightPane />
        </div>
      </div>
    </div>
  );
};