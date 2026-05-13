import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { segmentListForInterview, type SegmentDTO } from "../../../ipc/segment";
import { transcriptionRunsAtom } from "../../../state/transcription";
import styles from "./TranscriptViewer.module.css";

type Props = { interviewId: number };

const formatTimestamp = (seconds: number): string => {
  const totalMs = Math.round(seconds * 1000);
  const totalS = Math.floor(totalMs / 1000);
  const h = Math.floor(totalS / 3600);
  const rem = totalS - h * 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
};

export const TranscriptViewer = ({ interviewId }: Props) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const runs = useAtomValue(transcriptionRunsAtom);
  const lastProgress = runs[interviewId]?.lastProgress;

  useEffect(() => {
    void segmentListForInterview(interviewId).then(setSegments);
  }, [interviewId, lastProgress?.stage]);

  if (segments.length === 0) {
    return <p className={styles.empty}>{t("workspace.noSegments")}</p>;
  }

  return (
    <div className={styles.transcript}>
      {segments.map((s) => (
        <div key={s.id} className={styles.segment} data-segment-id={s.id}>
          <span className={styles.timestamp}>[{formatTimestamp(s.startSec)}]</span>
          <span className={styles.speaker}>
            {t("workspace.speaker")} {s.speakerDisplayName ?? s.speakerLabelRaw}:
          </span>
          <span className={styles.text}>{s.text}</span>
        </div>
      ))}
    </div>
  );
};
