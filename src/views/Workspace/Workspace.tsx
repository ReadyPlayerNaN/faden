import { useEffect, useState } from "react";
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
import { LeftPane } from "./LeftPane/LeftPane";
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
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const selectedSpanId = useAtomValue(selectedSpanIdAtom);
  const bumpInterviewContentVersion = useSetAtom(interviewContentVersionAtom);
  const setActiveSelection = useSetAtom(activeTextSelectionAtom);
  const setSelectedSpan = useSetAtom(selectedSpanIdAtom);
  const [mobilePane, setMobilePane] = useState<"left" | "edits" | "right">("edits");

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

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

  const focusEditsPane = () => {
    setMobilePane("edits");
    window.requestAnimationFrame(() => {
      document.getElementById("workspace-center-pane")?.focus();
    });
  };

  return (
    <div className={styles.shell}>
      <ProjectHeader
        activeView="coding"
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
        <div className={styles.panesToolbar}>
          <Button
            onClick={() => setMobilePane("left")}
            className={`${styles.paneSwitchButton} ${mobilePane === "left" ? styles.paneSwitchButtonActive : ""}`.trim()}
          >
            {t("workspace.interviews")}
          </Button>
          <Button
            onClick={focusEditsPane}
            className={`${styles.paneSwitchButton} ${mobilePane === "edits" ? styles.paneSwitchButtonActive : ""}`.trim()}
          >
            {t("workspace.edits", { defaultValue: "Edits" })}
          </Button>
        </div>
        <div className={styles.panes}>
          <LeftPane />
          <CenterPane />
          <RightPane />
        </div>
      </div>
    </div>
  );
};
