import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { selectedInterviewIdAtom } from "../../../state/interview";
import { TranscriptViewer } from "./TranscriptViewer";
import styles from "./CenterPane.module.css";

export const CenterPane = () => {
  const { t } = useTranslation();
  const interviewId = useAtomValue(selectedInterviewIdAtom);
  return (
    <section className={styles.pane}>
      {interviewId === null ? (
        <p className={styles.empty}>{t("workspace.selectInterview")}</p>
      ) : (
        <TranscriptViewer interviewId={interviewId} />
      )}
    </section>
  );
};
