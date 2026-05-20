import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import {
  effectiveSelectedInterviewIdAtom,
  interviewContentVersionAtom,
} from "../../../state/interview";
import { codebookTreeAtom } from "../../../state/codebook";
import { spansForCurrentInterviewAtom } from "../../../state/tagging";
import { codebookTree as fetchCodebookTree } from "../../../ipc/codebook";
import { spanListForInterview } from "../../../ipc/tagging";
import { TranscriptViewer } from "./TranscriptViewer";
import { TagPopover } from "./TagPopover";
import { SpeakerList } from "./SpeakerList";
import { SuggestionReviewPopover } from "../AI/SuggestionReviewPopover";
import type { TranscriptionLens } from "./transcriptionLens";
import styles from "./CenterPane.module.css";

export const CenterPane = () => {
  const { t } = useTranslation();
  const interviewId = useAtomValue(effectiveSelectedInterviewIdAtom);
  const interviewContentVersion = useAtomValue(interviewContentVersionAtom);
  const setSpans = useSetAtom(spansForCurrentInterviewAtom);
  const setCodebookTree = useSetAtom(codebookTreeAtom);
  const [speakerVersion, setSpeakerVersion] = useState(0);
  const [transcriptionLens, setTranscriptionLens] = useState<TranscriptionLens>("codes");

  useEffect(() => {
    void fetchCodebookTree().then(setCodebookTree);
  }, [setCodebookTree]);

  useEffect(() => {
    if (interviewId === null) {
      setSpans([]);
      return;
    }
    void spanListForInterview(interviewId).then(setSpans);
  }, [interviewId, interviewContentVersion, setSpans]);

  return (
    <section className={styles.pane} id="workspace-center-pane" tabIndex={-1}>
      {interviewId === null ? (
        <p className={styles.empty}>{t("workspace.selectInterview")}</p>
      ) : (
        <>
          <SpeakerList
            interviewId={interviewId}
            transcriptionLens={transcriptionLens}
            onTranscriptionLensChange={setTranscriptionLens}
            onChanged={() => setSpeakerVersion((value) => value + 1)}
          />
          <TranscriptViewer
            interviewId={interviewId}
            speakerVersion={speakerVersion}
            transcriptionLens={transcriptionLens}
          />
        </>
      )}
      <TagPopover />
      <SuggestionReviewPopover />
    </section>
  );
};
