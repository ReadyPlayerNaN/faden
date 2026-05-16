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
import styles from "./CenterPane.module.css";

export const CenterPane = () => {
  const { t } = useTranslation();
  const interviewId = useAtomValue(effectiveSelectedInterviewIdAtom);
  const interviewContentVersion = useAtomValue(interviewContentVersionAtom);
  const setSpans = useSetAtom(spansForCurrentInterviewAtom);
  const setCodebookTree = useSetAtom(codebookTreeAtom);
  const [speakerVersion, setSpeakerVersion] = useState(0);

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
    <section className={styles.pane}>
      {interviewId === null ? (
        <p className={styles.empty}>{t("workspace.selectInterview")}</p>
      ) : (
        <>
          <SpeakerList
            interviewId={interviewId}
            onChanged={() => setSpeakerVersion((value) => value + 1)}
          />
          <TranscriptViewer
            interviewId={interviewId}
            speakerVersion={speakerVersion}
          />
        </>
      )}
      <TagPopover />
    </section>
  );
};
