import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedInterviewIdAtom } from "../../../state/interview";
import { spansForCurrentInterviewAtom } from "../../../state/tagging";
import { spanListForInterview } from "../../../ipc/tagging";
import { TranscriptViewer } from "./TranscriptViewer";
import { TagPopover } from "./TagPopover";
import { SpeakerList } from "./SpeakerList";
import styles from "./CenterPane.module.css";

export const CenterPane = () => {
  const { t } = useTranslation();
  const interviewId = useAtomValue(selectedInterviewIdAtom);
  const setSpans = useSetAtom(spansForCurrentInterviewAtom);

  useEffect(() => {
    if (interviewId === null) {
      setSpans([]);
      return;
    }
    void spanListForInterview(interviewId).then(setSpans);
  }, [interviewId, setSpans]);

  return (
    <section className={styles.pane}>
      {interviewId === null ? (
        <p className={styles.empty}>{t("workspace.selectInterview")}</p>
      ) : (
        <>
          <SpeakerList interviewId={interviewId} />
          <TranscriptViewer interviewId={interviewId} />
        </>
      )}
      <TagPopover />
    </section>
  );
};
